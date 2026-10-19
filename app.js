/**
 * 競賽評分系統核心邏輯
 * 整合 Google Apps Script Web App 與專屬分頁規則
 */
const CompetitionGrader = (function () {
  // 部署完成之最新 Google Apps Script Web App 網址
  const GAS_URL = "https://script.google.com/macros/s/AKfycbzHYtYQf3x6-MT70CXcOlo3_wlb1QCIMqOXqnkR9crnM_bOtHv17r2Dp3vmLgbjaKFG/exec";

  let currentJudgeName = sessionStorage.getItem("ASSIGN_JUDGE_NAME") || null;
  let currentAssignedRule = sessionStorage.getItem("ASSIGN_JUDGE_RULE") || "ALL";

  let teams = [];
  let currentTeamIndex = 0;
  let isMasked = false;
  let syncTimer = null;

  let canvas, ctx;
  let isDrawing = false;

  async function init() {
    initCanvas();

    if (currentJudgeName) {
      onLoginSuccess(currentJudgeName, currentAssignedRule);
    } else {
      navigate("pageLogin");
    }
  }

  // 1. 評審登入驗證
  async function handleLogin() {
    const u = document.getElementById("loginUsername").value.trim();
    const p = document.getElementById("loginPassword").value.trim();
    const err = document.getElementById("loginErrorMsg");
    const btn = document.getElementById("btnLogin");

    if (!u || !p) {
      err.innerText = "請輸入帳號與密碼！";
      err.style.display = "block";
      return;
    }

    btn.disabled = true;
    btn.innerText = "正在連線驗證...";
    err.style.display = "none";

    try {
      // 透過 GET 帶參呼叫避免 302 重新導向跨域問題
      const loginUrl = `${GAS_URL}?action=login&username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}`;
      const res = await fetch(loginUrl, { method: "GET" });
      const data = await res.json();

      if (data && data.status === "success") {
        currentJudgeName = data.judgeName;
        currentAssignedRule = data.assignedRule || "ALL";

        sessionStorage.setItem("ASSIGN_JUDGE_NAME", currentJudgeName);
        sessionStorage.setItem("ASSIGN_JUDGE_RULE", currentAssignedRule);

        onLoginSuccess(currentJudgeName, currentAssignedRule);
      } else {
        err.innerText = data.message || "帳號或密碼錯誤，請重新確認！";
        err.style.display = "block";
      }
    } catch (e) {
      console.error("登入錯誤：", e);
      err.innerText = "連線失敗，請檢查網路或 Apps Script 部署設定！";
      err.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.innerText = "登入系統";
    }
  }

  function onLoginSuccess(name, rule) {
    document.getElementById("judgeNameBadge").innerText = `評審：${name}`;
    document.getElementById("judgeRuleBadge").innerText = `負責隊伍：${rule}`;
    document.getElementById("gradingJudgeBadge").innerText = `評審：${name}`;
    navigate("pageSummary");

    // 載入本地快取後同步拉取雲端指派名單
    const cached = localStorage.getItem(`TEAMS_CACHE_${name}`);
    if (cached) {
      teams = JSON.parse(cached);
      renderSummary();
    }
    fetchTeamsFromCloud();
  }

  function handleLogout() {
    if (confirm("確定要登出系統嗎？")) {
      sessionStorage.removeItem("ASSIGN_JUDGE_NAME");
      sessionStorage.removeItem("ASSIGN_JUDGE_RULE");
      currentJudgeName = null;
      currentAssignedRule = "ALL";
      document.getElementById("loginUsername").value = "";
      document.getElementById("loginPassword").value = "";
      document.getElementById("loginErrorMsg").style.display = "none";
      navigate("pageLogin");
    }
  }

  // 2. 依「評分隊伍」規則向雲端索取指定隊伍
  async function fetchTeamsFromCloud() {
    updateStatusBadge("🟡 同步隊伍名單中...");
    try {
      const fetchUrl = `${GAS_URL}?assignedRule=${encodeURIComponent(currentAssignedRule)}`;
      const res = await fetch(fetchUrl);
      const data = await res.json();

      if (data.teams && data.teams.length > 0) {
        // 比對合併既有成績紀錄
        const merged = data.teams.map(cloudTeam => {
          const existing = teams.find(t => String(t.id).trim().toUpperCase() === String(cloudTeam.id).trim().toUpperCase());
          return existing ? { ...cloudTeam, ...existing } : {
            ...cloudTeam,
            stageCount: 0,
            fluencyRaw: 0,
            c1: 0,
            c2: 0,
            taskSub1: 0,
            taskSub2: 0,
            taskSub3: 0,
            signature: null,
            submitted: false,
            judgeName: ""
          };
        });

        teams = merged;
        saveToStorage();
        renderSummary();
        updateStatusBadge(`🟢 名單已同步 (共 ${teams.length} 隊)`);
      } else {
        teams = [];
        renderSummary();
        updateStatusBadge("⚠️ 查無指派給您的隊伍");
      }
    } catch (err) {
      console.warn("抓取名單失敗：", err);
      updateStatusBadge("🔴 離線模式 (使用暫存)");
    }
  }

  // 3. 背景自動同步成績 (防抖 1.2 秒)
  function triggerAutoSync(team) {
    setGradingStatus("🟡 上傳成績中...");
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      await sendScoreToCloud(team);
    }, 1200);
  }

  async function sendScoreToCloud(team) {
    const s = calcTeamScores(team);
    team.judgeName = currentJudgeName || "未具名評審";

    const payload = {
      action: "saveScore",
      judgeName: team.judgeName,
      data: {
        category: team.category || "",
        id: team.id,
        school: team.school,
        name: team.name,
        stageCount: team.stageCount,
        fluencyRaw: team.fluencyRaw,
        fluencyWeighted: s.fluency,
        contentTotal: s.content,
        taskTotal: s.task,
        total: s.total,
        submitted: team.submitted
      }
    };

    try {
      await fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      setGradingStatus(`🟢 雲端已記錄 (評審：${team.judgeName})`);
      renderSummary();
    } catch (err) {
      console.error("成績上傳失敗：", err);
      setGradingStatus("🔴 上傳失敗 (已暫存本機)");
    }
  }

  // 4. 計算隊伍得分
  function calcTeamScores(t) {
    const stage = Math.min(16, Math.max(0, Number(t.stageCount) || 0));
    const fluencyWeighted = (Math.min(100, Math.max(0, Number(t.fluencyRaw) || 0)) * 0.20);
    const content = Math.min(5, Math.max(0, Number(t.c1) || 0)) + Math.min(5, Math.max(0, Number(t.c2) || 0));
    const task = Math.min(18, Math.max(0, Number(t.taskSub1) || 0)) +
                 Math.min(18, Math.max(0, Number(t.taskSub2) || 0)) +
                 Math.min(18, Math.max(0, Number(t.taskSub3) || 0));
    const total = stage + fluencyWeighted + content + task;
    return {
      stage: stage.toFixed(1),
      fluency: fluencyWeighted.toFixed(1),
      content: content.toFixed(1),
      task: task.toFixed(1),
      total: total.toFixed(1)
    };
  }

  // 5. 渲染總表頁面
  function renderSummary() {
    const tbody = document.getElementById("summaryTableBody");
    if (!tbody) return;
    if (teams.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="padding: 24px; color:#888;">查無分配給您的評分隊伍。</td></tr>`;
      return;
    }

    tbody.innerHTML = teams.map((t, idx) => {
      const s = calcTeamScores(t);
      const display = val => isMasked ? `<span class="masked-score">•••</span>` : val;
      const statusBadge = t.submitted ? `<span style="color:var(--success); font-weight:bold;">已完成</span>` : `<span style="color:#888;">評分中</span>`;
      const judgeDisplay = t.judgeName ? `<span style="font-weight:600; color:#333;">${t.judgeName}</span>` : `<span style="color:#aaa;">-</span>`;

      return `
        <tr class="clickable-row" onclick="CompetitionGrader.openTeam(${idx})">
          <td>${t.category || "-"}</td>
          <td><strong>${t.id}</strong></td>
          <td>${t.school}</td>
          <td><strong>${t.name}</strong></td>
          <td>${display(s.stage)}</td>
          <td>${display(s.fluency)}</td>
          <td>${display(s.content)}</td>
          <td>${display(s.task)}</td>
          <td style="color:var(--primary); font-weight:800; font-size:16px;">${display(s.total)}</td>
          <td>${judgeDisplay}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join("");
  }

  function openTeam(idx) {
    currentTeamIndex = idx;
    navigate("pageTeamGrading");
  }

  function loadTeamToGradingPage() {
    const t = teams[currentTeamIndex];
    document.getElementById("gradingTeamTitle").innerText = `【${t.id}】${t.name}`;
    document.getElementById("gradingTeamMeta").innerText = `${t.category || ''} ｜ 學校：${t.school}`;

    document.getElementById("inputStageCount").value = t.stageCount;
    document.getElementById("inputFluencyRaw").value = t.fluencyRaw;
    document.getElementById("inputContent1").value = t.c1;
    document.getElementById("inputContent2").value = t.c2;

    document.getElementById("taskSub1").value = t.taskSub1;
    document.getElementById("taskSub2").value = t.taskSub2;
    document.getElementById("taskSub3").value = t.taskSub3;

    updateMainScores();
    updateTaskScores();

    clearSignature();
    if (t.signature) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = t.signature;
    }
    setGradingStatus(t.submitted ? `🟢 已簽名完成 (評審：${t.judgeName || currentJudgeName})` : "🟡 評分中 (即時同步)");
  }

  function updateMainScores() {
    const t = teams[currentTeamIndex];
    t.stageCount = document.getElementById("inputStageCount").value;
    t.fluencyRaw = document.getElementById("inputFluencyRaw").value;
    t.c1 = document.getElementById("inputContent1").value;
    t.c2 = document.getElementById("inputContent2").value;
    t.judgeName = currentJudgeName;

    const s = calcTeamScores(t);
    document.getElementById("labelFluencyWeighted").innerText = `${s.fluency} 分`;
    document.getElementById("labelContentTotal").innerText = `${s.content} 分`;

    saveToStorage();
    triggerAutoSync(t);
  }

  function updateTaskScores() {
    const t = teams[currentTeamIndex];
    t.taskSub1 = document.getElementById("taskSub1").value;
    t.taskSub2 = document.getElementById("taskSub2").value;
    t.taskSub3 = document.getElementById("taskSub3").value;
    t.judgeName = currentJudgeName;

    const s = calcTeamScores(t);
    document.getElementById("labelTaskTotalScore").innerText = s.task;
    document.getElementById("labelTaskSubTotal").innerText = `${s.task} / 54 分`;

    saveToStorage();
    triggerAutoSync(t);
  }

  function navigate(viewId) {
    document.querySelectorAll(".view-screen").forEach(el => el.classList.remove("active"));
    const target = document.getElementById(viewId);
    if (target) target.classList.add("active");

    if (viewId === "pageTeamGrading") {
      resizeCanvas();
      loadTeamToGradingPage();
    }
  }

  function toggleMask() {
    isMasked = !isMasked;
    renderSummary();
  }

  // 6. 手寫簽名板控制
  function initCanvas() {
    canvas = document.getElementById("signaturePad");
    if (!canvas) return;
    ctx = canvas.getContext("2d");

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function startDraw(e) {
      isDrawing = true;
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      e.preventDefault();
    }
    function draw(e) {
      if (!isDrawing) return;
      const pos = getPos(e);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#000";
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      e.preventDefault();
    }
    function stopDraw() { isDrawing = false; }

    canvas.addEventListener("touchstart", startDraw, { passive: false });
    canvas.addEventListener("touchmove", draw, { passive: false });
    canvas.addEventListener("touchend", stopDraw);

    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", draw);
    canvas.addEventListener("mouseup", stopDraw);
  }

  function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = 180;
  }

  function clearSignature() {
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function saveAndReturn() {
    const t = teams[currentTeamIndex];
    t.signature = canvas.toDataURL();
    t.submitted = true;
    t.judgeName = currentJudgeName;
    saveToStorage();

    clearTimeout(syncTimer);
    sendScoreToCloud(t);

    renderSummary();
    navigate("pageSummary");
  }

  function saveToStorage() {
    if (currentJudgeName) {
      localStorage.setItem(`TEAMS_CACHE_${currentJudgeName}`, JSON.stringify(teams));
    }
  }

  function updateStatusBadge(txt) {
    const el = document.getElementById("cloudStatusBadge");
    if (el) el.innerText = txt;
  }

  function setGradingStatus(txt) {
    const el = document.getElementById("gradingSyncStatus");
    if (el) el.innerText = txt;
  }

  async function reloadFromCloud() {
    await fetchTeamsFromCloud();
  }

  // 7. 匯出 CSV 報表
  function exportCSV() {
    let csv = "\uFEFF組別,隊伍編號,學校名稱,隊伍名稱,關卡數量(16),流暢度加權(20),關卡內容(10),指定任務(54),總分(100),評審姓名,狀態\n";
    teams.forEach(t => {
      const s = calcTeamScores(t);
      csv += `"${t.category || ''}","${t.id}","${t.school}","${t.name}",${s.stage},${s.fluency},${s.content},${s.task},${s.total},"${t.judgeName || currentJudgeName || ''}","${t.submitted ? '已完成' : '評分中'}"\n`;
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `評分報表_${currentJudgeName || '匯出'}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  }

  window.addEventListener("DOMContentLoaded", init);

  return {
    navigate,
    openTeam,
    toggleMask,
    updateMainScores,
    updateTaskScores,
    clearSignature,
    saveAndReturn,
    reloadFromCloud,
    handleLogin,
    handleLogout,
    exportCSV
  };
})();
