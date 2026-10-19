/**
 * 競賽評分系統核心邏輯 (GAS 雲端自動同步版)
 */
const CompetitionGrader = (function () {
  // 您已部署完成的 Google Apps Script Web App 網址
  const GAS_URL = "https://script.google.com/macros/s/AKfycbzIg6Yr_CgIZySCRuu_J_4QVxNnzDms_I5e0g4hfLcGO8MhrDb7YfwuW-plvoY3MuTK/exec";

  let teams = [];
  let currentTeamIndex = 0;
  let isMasked = false;
  let syncTimer = null; // 防抖自動上傳計時器

  // 手寫簽名板相關
  let canvas, ctx;
  let isDrawing = false;

  async function init() {
    initCanvas();

    // 優先讀取本機快取以利瞬間開盤
    const cached = localStorage.getItem("LOCAL_COMPETITION_TEAMS");
    if (cached) {
      teams = JSON.parse(cached);
      renderSummary();
      updateStatusBadge("🟢 載入本機快取名單");
    }

    // 背景連線至 Google 試算表同步最新隊伍名單
    await fetchTeamsFromCloud();
  }

  // 1. GET 請求：從 Google 試算表抓取隊伍名單
  async function fetchTeamsFromCloud() {
    updateStatusBadge("🟡 正在同步試算表名單...");
    try {
      const res = await fetch(GAS_URL);
      const data = await res.json();

      if (data.teams && data.teams.length > 0) {
        // 保留原有的打分紀錄，比對更新名單
        const merged = data.teams.map(cloudTeam => {
          const existing = teams.find(t => String(t.id).trim() === String(cloudTeam.id).trim());
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
            submitted: false
          };
        });

        teams = merged;
        saveToStorage();
        renderSummary();
        updateStatusBadge(`🟢 雲端同步完成 (${new Date().toLocaleTimeString('zh-TW')})`);
      } else {
        updateStatusBadge("⚠️ 試算表中尚無隊伍資料");
      }
    } catch (err) {
      console.warn("無法取得雲端名單，保持離線快取運作：", err);
      updateStatusBadge("🔴 雲端離線中 (使用快取)");
    }
  }

  // 2. POST 請求：背景自動上傳隊伍成績至「成績總表」
  function triggerAutoSync(team) {
    setGradingStatus("🟡 正在上傳成績至雲端...");
    clearTimeout(syncTimer);

    // 防抖 1.2 秒：停止輸入後自動送出
    syncTimer = setTimeout(async () => {
      await sendScoreToCloud(team);
    }, 1200);
  }

  async function sendScoreToCloud(team) {
    const s = calcTeamScores(team);
    const payload = {
      action: "saveScore",
      judgeName: "iPad評審員",
      data: {
        region: team.region || "北區",
        category: team.category || "國小組",
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
      setGradingStatus(`🟢 雲端已同步 (${new Date().toLocaleTimeString('zh-TW')})`);
    } catch (err) {
      console.error("成績自動上傳失敗：", err);
      setGradingStatus("🔴 上傳失敗 (已暫存本機)");
    }
  }

  // 計算分數
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

  // 渲染總表
  function renderSummary() {
    const tbody = document.getElementById("summaryTableBody");
    if (teams.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="padding: 24px; color:#888;">尚未抓取到隊伍名單，請確認試算表設定。</td></tr>`;
      return;
    }

    tbody.innerHTML = teams.map((t, idx) => {
      const s = calcTeamScores(t);
      const display = val => isMasked ? `<span class="masked-score">•••</span>` : val;
      const statusBadge = t.submitted ? `<span style="color:var(--success); font-weight:bold;">已簽名</span>` : `<span style="color:#888;">未完成</span>`;
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
    setGradingStatus(t.submitted ? "🟢 已完成簽名送出" : "🟡 評分中 (即時同步)");
  }

  function updateMainScores() {
    const t = teams[currentTeamIndex];
    t.stageCount = document.getElementById("inputStageCount").value;
    t.fluencyRaw = document.getElementById("inputFluencyRaw").value;
    t.c1 = document.getElementById("inputContent1").value;
    t.c2 = document.getElementById("inputContent2").value;

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

    const s = calcTeamScores(t);
    document.getElementById("labelTaskTotalScore").innerText = s.task;
    document.getElementById("labelTaskSubTotal").innerText = `${s.task} / 54 分`;

    saveToStorage();
    triggerAutoSync(t);
  }

  // 畫面切換
  function navigate(viewId) {
    document.querySelectorAll(".view-screen").forEach(el => el.classList.remove("active"));
    document.getElementById(viewId).classList.add("active");
    if (viewId === "pageTeamGrading") {
      resizeCanvas();
      loadTeamToGradingPage();
    }
  }

  function toggleMask() {
    isMasked = !isMasked;
    renderSummary();
  }

  // 手寫簽名板控制
  function initCanvas() {
    canvas = document.getElementById("signaturePad");
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
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = 180;
  }

  function clearSignature() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // 完成簽名並立即強制同步
  function saveAndReturn() {
    const t = teams[currentTeamIndex];
    t.signature = canvas.toDataURL();
    t.submitted = true;
    saveToStorage();

    clearTimeout(syncTimer);
    sendScoreToCloud(t); // 立即上傳

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

  function exportCSV() {
    let csv = "\uFEFF編號,賽區,組別,學校,隊伍名稱,關卡數量(16),流暢度加權(20),關卡內容(10),指定任務(54),總分(100),完成狀態\n";
    teams.forEach(t => {
      const s = calcTeamScores(t);
      csv += `"${t.id}","${t.region || ''}","${t.category || ''}","${t.school}","${t.name}",${s.stage},${s.fluency},${s.content},${s.task},${s.total},"${t.submitted ? '已簽名' : '未完成'}"\n`;
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
    exportCSV
  };
})();
