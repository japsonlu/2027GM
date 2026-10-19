/**
 * iPad 競賽評分系統核心邏輯
 */
const CompetitionGrader = (function () {
  const CSV_FILE_PATH = './teams.csv';
  let teams = [];
  let currentTeamIndex = 0;
  let isMasked = false;

  let canvas, ctx;
  let isDrawing = false;

  async function init() {
    initCanvas();
    const saved = localStorage.getItem("COMPETITION_TEAMS_DATA");
    if (saved) {
      teams = JSON.parse(saved);
      renderSummary();
    } else {
      await loadTeamsFromCSV();
    }
  }

  // 透過相對路徑讀取同資料夾下的 teams.csv
  async function loadTeamsFromCSV() {
    try {
      const response = await fetch(CSV_FILE_PATH, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`無法讀取檔案，狀態碼：${response.status}`);
      }
      const text = await response.text();
      parseCSVData(text);
    } catch (err) {
      console.error("載入 CSV 失敗：", err);
      alert("無法自動載入 teams.csv，請確認檔案與 index.html 位於同一資料夾下。");
    }
  }

  function parseCSVData(csvText) {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== "");
    let validLines = lines;
    if (lines[0].includes("編號") || lines[0].includes("學校")) {
      validLines = lines.slice(1);
    }

    const parsed = validLines.map(line => {
      const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ''));
      return {
        id: cols[0] || "",
        school: cols[1] || "",
        name: cols[2] || "",
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
    }).filter(t => t.id && t.name);

    if (parsed.length > 0) {
      teams = parsed;
      saveToStorage();
      renderSummary();
    }
  }

  async function reloadCSV() {
    if (confirm("重新載入 teams.csv 將清空當前未匯出的評分與簽名記錄，確定執行嗎？")) {
      localStorage.removeItem("COMPETITION_TEAMS_DATA");
      await loadTeamsFromCSV();
    }
  }

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

  function renderSummary() {
    const tbody = document.getElementById("summaryTableBody");
    tbody.innerHTML = teams.map((t, idx) => {
      const s = calcTeamScores(t);
      const display = val => isMasked ? `<span class="masked-score">•••</span>` : val;
      const statusBadge = t.submitted ? `<span style="color:var(--success); font-weight:bold;">已完成</span>` : `<span style="color:#888;">未完成</span>`;
      return `
        <tr class="clickable-row" onclick="CompetitionGrader.openTeam(${idx})">
          <td><strong>${t.id}</strong></td>
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
    document.getElementById("gradingTeamSchool").innerText = `參賽學校：${t.school}`;

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
  }

  function updateTaskScores() {
    const t = teams[currentTeamIndex];
    t.taskSub1 = document.getElementById("taskSub1").value;
    t.taskSub2 = document.getElementById("taskSub2").value;
    t.taskSub3 = document.getElementById("taskSub3").value;

    const s = calcTeamScores(t);
    document.getElementById("labelTaskTotalScore").innerText = s.task;
    document.getElementById("labelTaskSubTotal").innerText = `${s.task} / 54 分`;
  }

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

  function saveAndReturn() {
    const t = teams[currentTeamIndex];
    t.signature = canvas.toDataURL();
    t.submitted = true;
    saveToStorage();
    renderSummary();
    navigate("pageSummary");
  }

  function saveToStorage() {
    localStorage.setItem("COMPETITION_TEAMS_DATA", JSON.stringify(teams));
  }

  function exportCSV() {
    let csv = "\uFEFF編號,學校,隊伍名稱,關卡數量(16),流暢度加權(20),關卡內容(10),指定任務(54),總分(100),完成狀態\n";
    teams.forEach(t => {
      const s = calcTeamScores(t);
      csv += `"${t.id}","${t.school}","${t.name}",${s.stage},${s.fluency},${s.content},${s.task},${s.total},"${t.submitted ? '已簽名' : '未完成'}"\n`;
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
    reloadCSV,
    exportCSV
  };
})();