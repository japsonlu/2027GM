/**
 * 競賽評分系統核心邏輯 (修正即時跳轉、錯誤提示、總表帶入評審姓名)
 */
const CompetitionGrader = (function () {
  const GAS_URL = "https://script.google.com/macros/s/AKfycbw4komcpTZy_HsaGxKwmurc_EQwljB4bCPup8vswuEryHqPAM_PauEEftN-1Qc3OmZS/exec";

  let currentJudgeName = sessionStorage.getItem("CURRENT_JUDGE_NAME") || null;
  let teams = [];
  let currentTeamIndex = 0;
  let isMasked = false;
  let syncTimer = null;

  let canvas, ctx;
  let isDrawing = false;

  async function init() {
    initCanvas();

    if (currentJudgeName) {
      onLoginSuccess(currentJudgeName);
    } else {
      navigate("pageLogin");
    }
  }

  // 1. 登入函式：改用 GET 傳遞驗證參數，徹底解決跨域 302 卡住不跳轉問題
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
    btn.innerText = "驗證中，請稍候...";
    err.style.display = "none";

    try {
      const loginUrl = `${GAS_URL}?action=login&username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}`;
      const res = await fetch(loginUrl, { method: "GET" });
      const data = await res.json();

      if (data && data.status === "success") {
        currentJudgeName = data.judgeName;
        sessionStorage.setItem("CURRENT_JUDGE_NAME", currentJudgeName);
        onLoginSuccess(currentJudgeName);
      } else {
        err.innerText = data.message || "帳號或密碼錯誤，請重新確認！";
        err.style.display = "block";
        alert(data.message || "帳號或密碼錯誤，請重新確認！");
      }
    } catch (e) {
      console.error("登入錯誤：", e);
      err.innerText = "連線失敗，請檢查網路連線或 Apps Script 部署設定！";
      err.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.innerText = "登入系統";
    }
  }

  function onLoginSuccess(name) {
    document.getElementById("judgeNameBadge").innerText = `評審：${name}`;
    document.getElementById("gradingJudgeBadge").innerText = `評審：${name}`;
    
    // 立即跳轉至總表
    navigate("pageSummary");

    // 載入暫存並向雲端拉取隊伍
    const cached = localStorage.getItem("LOCAL_COMPETITION_TEAMS");
    if (cached) {
      teams = JSON.parse(cached);
      renderSummary();
    }
    fetchTeamsFromCloud();
  }

  function handleLogout() {
    if (confirm("確定要登出系統嗎？")) {
      sessionStorage.removeItem("CURRENT_JUDGE_NAME");
      currentJudgeName = null;
      document.getElementById("loginUsername").value = "";
      document.getElementById("loginPassword").value = "";
      document.getElementById("loginErrorMsg").style.display = "none";
      navigate("pageLogin");
    }
  }

  // 2. 抓取隊伍名單
  async function fetchTeamsFromCloud() {
    updateStatusBadge("🟡 同步隊伍名單中...");
    try {
      const res = await fetch(GAS_URL);
      const data = await res.json();

      if (data.teams && data.teams.length > 0) {
        const merged = data.teams.map(cloudTeam => {
          const existing = teams.find(t => String(t.id).trim() === String(cloudTeam.id).trim());
          return existing ? { ...cloudTeam, ...existing } : {
            ...cloudTeam,
            stageCount: 0, fluencyRaw: 0, c1: 0, c2: 0,
            taskSub1: 0, taskSub2: 0, taskSub3: 0,
            signature: null, submitted: false,
            judgeName: ""
          };
        });

        teams = merged;
        saveToStorage();
        renderSummary();
        updateStatusBadge(`🟢 名單已同步 (${new Date().toLocaleTimeString('zh-TW')})`);
      }
    } catch (err) {
      updateStatusBadge("🔴 離線模式 (使用暫存)");
    }
  }

  // 3. 上傳成績至 Google 試算表（帶入評審姓名）
  function triggerAutoSync(team) {
    setGradingStatus("🟡 正在上傳至成績總表...");
    clearTimeout(syncTimer);

    syncTimer = setTimeout(async () => {
      await sendScoreToCloud(team);
    }, 1200);
  }

  async function sendScoreToCloud(team) {
    const s = calcTeamScores(team);
    team.judgeName = currentJudgeName || "未具名評審"; // 綁定評審姓名到隊伍物件

    const payload = {
      action: "saveScore",
      judgeName: team.judgeName,
      data: {
        region: team.region || "",
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
      renderSummary(); // 同步更新總表畫面上的評審姓名
    } catch (err) {
      setGradingStatus("🔴 上傳失敗，已暫存本機");
    }
  }

  // 分數計算
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

  // 4. 渲染總表（包含評審姓名欄位）
  function renderSummary() {
    const tbody = document.getElementById("summaryTableBody");
    if (!tbody) return;
    if (teams.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" style="padding: 24px; color:#888;">尚未載入隊伍名單...</td></tr>`;
      return;
    }

    tbody.innerHTML = teams.map((t, idx) => {
      const s = calcTeamScores(t);
      const display = val => isMasked ? `<span class="masked-score">•••</span>` : val;
      const statusBadge = t.submitted ? `<span style="color:var(--success); font-weight:bold;">已簽名</span>` : `<span style="color:#888;">評分中</span>`;
      const judgeDisplay = t.judgeName ? `<span style="font-weight:600; color:#333;">${t.judgeName}</span>` : `<span style="color:#aaa;">-</span>`;

      return `
        <tr class="clickable-row" onclick="CompetitionGrader.openTeam(${idx})">
          <td><strong>${t.id}</strong></td>
          <td>${t.region || "-"}</td>
          <td>${t.category || "-"}</td>
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
    document.getElementById("gradingTeamMeta").innerText = `${t.region || ''} ｜ ${t.category || ''} ｜ 學校：${t.school}`;

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
    setGradingStatus(t.submitted ? `🟢 已簽名 (評審：${t.judgeName || currentJudgeName})` : "🟡 評分中 (即時同步)");
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

  // 觸控手寫板
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

  // 簽名完成送出
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
    localStorage.setItem("LOCAL_COMPETITION_TEAMS", JSON.stringify(teams));
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

  // 匯出 CSV 報表（包含評審姓名欄位）
  function exportCSV() {
    let csv = "\uFEFF編號,賽區,組別,學校,隊伍名稱,關卡數量(16),流暢度加權(20),關卡內容(10),指定任務(54),總分(100),評審姓名,完成狀態\n";
    teams.forEach(t => {
      const s = calcTeamScores(t);
      csv += `"${t.id}","${t.region || ''}","${t.category || ''}","${t.school}","${t.name}",${s.stage},${s.fluency},${s.content},${s.task},${s.total},"${t.judgeName || currentJudgeName || ''}","${t.submitted ? '已簽名' : '評分中'}"\n`;
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `競賽評分總報表_${new Date().toISOString().slice(0,10)}.csv`;
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
