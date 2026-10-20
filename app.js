// Google Apps Script Web App URL
const API_URL = "https://script.google.com/macros/s/AKfycbxUEJnBa0psphBP_soqpnSXg66ZetsevRUrkRqLKGuJ3WHy97fYzbhMX9ZFYWO2hhvY/exec";

// 全域狀態
let currentJudge = null;
let assignedTeams = [];
let scoresCache = {};
let currentTeam = null;

// DOM 元素
const loginView = document.getElementById("login-view");
const pageSummary = document.getElementById("page-summary");
const pageScoring = document.getElementById("page-scoring");
const judgeDisplay = document.getElementById("judge-display");
const teamListBody = document.getElementById("team-list-body");

// 簽名畫布狀態
const canvas = document.getElementById("sign-pad");
const ctx = canvas.getContext("2d");
let isDrawing = false;
let hasSignature = false;

// ---------------------------
// 1. 初始化與登入流程
// ---------------------------
document.addEventListener("DOMContentLoaded", () => {
  initCanvas();
  setupSelectionHandlers();

  // 登入按鈕
  document.getElementById("btn-login").addEventListener("click", handleLogin);
  document.getElementById("btn-logout").addEventListener("click", () => location.reload());
  document.getElementById("btn-back").addEventListener("click", () => switchPage("summary"));
  document.getElementById("btn-clear-sign").addEventListener("click", clearCanvas);
  document.getElementById("btn-submit").addEventListener("click", submitScore);
});

async function handleLogin() {
  const user = document.getElementById("login-user").value.trim();
  const pass = document.getElementById("login-pass").value.trim();

  if (!user || !pass) {
    alert("請輸入評審帳號與密碼！");
    return;
  }

  const btn = document.getElementById("btn-login");
  btn.disabled = true;
  btn.textContent = "驗證中...";

  try {
    const res = await fetch(`${API_URL}?action=login&username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`);
    const data = await res.json();

    if (data.success) {
      currentJudge = data.judgeName;
      assignedTeams = data.teams;
      scoresCache = data.existingScores || {};

      judgeDisplay.textContent = `評審：${currentJudge}`;
      loginView.style.display = "none";
      renderTeamList();
    } else {
      alert(data.message || "登入失敗");
    }
  } catch (err) {
    alert("連線後端錯誤，請確認網路或 API 部署：" + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "登入系統";
  }
}

// ---------------------------
// 2. 總表渲染 (含個別隱藏成績功能)
// ---------------------------
function renderTeamList() {
  teamListBody.innerHTML = "";

  assignedTeams.forEach(team => {
    const tr = document.createElement("tr");
    const score = scoresCache[team.teamId] || {};

    const stageVal = score.stageScore ?? "-";
    const fluencyVal = score.fluencyScore ?? "-";
    const taskVal = score.taskScore ?? "-";
    const missionVal = score.missionScore ?? "-";
    const totalVal = score.totalScore ?? "-";

    tr.innerHTML = `
      <td>${team.group}</td>
      <td style="font-weight:bold;">${team.teamId}</td>
      <td>${team.school}</td>
      <td>${team.teamName}</td>
      <td class="score-col">${stageVal}</td>
      <td class="score-col">${fluencyVal}</td>
      <td class="score-col">${taskVal}</td>
      <td class="score-col">${missionVal}</td>
      <td class="score-col" style="font-weight:bold; color:var(--primary);">${totalVal}</td>
      <td>
        <button class="btn btn-secondary" style="padding: 4px 8px; font-size:12px;" onclick="toggleRowScore(this)">隱藏</button>
      </td>
      <td>
        <button class="btn btn-primary" style="padding: 6px 12px;" onclick="openScoring('${team.teamId}')">
          ${score.totalScore !== undefined ? "重新評分" : "評分"}
        </button>
      </td>
    `;
    teamListBody.appendChild(tr);
  });
}

// 個別隱藏 / 顯示成績切換
window.toggleRowScore = function(btn) {
  const row = btn.closest("tr");
  const scoreCells = row.querySelectorAll(".score-col");
  const isHidden = btn.dataset.hidden === "true";

  scoreCells.forEach(cell => {
    if (!isHidden) {
      cell.dataset.realText = cell.textContent;
      cell.textContent = "***";
    } else {
      cell.textContent = cell.dataset.realText || cell.textContent;
    }
  });

  btn.dataset.hidden = !isHidden;
  btn.textContent = !isHidden ? "顯示" : "隱藏";
};

// ---------------------------
// 3. 評分頁面切換與動態計算
// ---------------------------
window.openScoring = function(teamId) {
  currentTeam = assignedTeams.find(t => t.teamId === teamId);
  document.getElementById("current-team-info").textContent = 
    `評分對象：[${currentTeam.teamId}] ${currentTeam.school} - ${currentTeam.teamName}`;

  clearCanvas();
  calculateAllScores();
  switchPage("scoring");
};

function switchPage(page) {
  if (page === "summary") {
    pageSummary.classList.add("active");
    pageScoring.classList.remove("active");
    document.getElementById("page-title").textContent = "總評分表";
    renderTeamList();
  } else {
    pageSummary.classList.remove("active");
    pageScoring.classList.add("active");
    document.getElementById("page-title").textContent = "隊伍評分表";
  }
}

// 監聽表格單元格點選
function setupSelectionHandlers() {
  document.querySelectorAll(".selectable").forEach(cell => {
    cell.addEventListener("click", function() {
      const parentRow = this.closest("tr");
      const group = this.dataset.group;

      if (group) {
        // 群組單選 (例如任務一內容、區域分數等)
        parentRow.querySelectorAll(`.selectable[data-group="${group}"]`).forEach(c => c.classList.remove("active"));
      } else {
        // 整行單選 (例如關卡數量、流暢度)
        parentRow.querySelectorAll(".selectable").forEach(c => c.classList.remove("active"));
      }

      this.classList.add("active");
      calculateAllScores();
    });
  });
}

// 核心計分邏輯
function calculateAllScores() {
  // 1. 關卡數量 (滿分 16)
  const stageEl = document.querySelector("#row-stage .selectable.active");
  const stageCount = stageEl ? parseFloat(stageEl.dataset.val) : 8;
  const stageScore = stageCount * 2;
  document.getElementById("score-stage").textContent = stageScore;

  // 2. 流暢度與加權 (滿分 20)
  // 公式：若手動或掉落次數為 X，關卡數量為 N，加權得分為 (20 - X*2) * N / 8
  const fluencyEl = document.querySelector("#row-fluency .selectable.active");
  const fluencyDrops = fluencyEl ? parseFloat(fluencyEl.dataset.val) : 0;
  const fluencyRaw = Math.max(0, 20 - fluencyDrops * 2);
  const fluencyWeighted = Number(((fluencyRaw * stageCount) / 8).toFixed(2));

  document.getElementById("score-fluency-raw").textContent = fluencyRaw;
  document.getElementById("score-fluency-weighted").textContent = fluencyWeighted;

  // 3. 關卡內容 / 任務 (滿分 10)
  let taskTotal = 0;
  ["row-task-1", "row-task-2"].forEach(rowId => {
    const row = document.getElementById(rowId);
    let subTotal = 0;
    row.querySelectorAll(".selectable.active").forEach(cell => {
      subTotal += parseFloat(cell.dataset.val);
    });
    row.querySelector(".task-row-total").textContent = subTotal;
    taskTotal += subTotal;
  });
  document.getElementById("score-task-total").textContent = taskTotal;

  // 4. 指定任務 (滿分 54)
  // 4.1 標準規範 (27分)
  let stdSum = 0;
  document.querySelectorAll("#row-mission-std .selectable.active").forEach(cell => {
    stdSum += parseFloat(cell.dataset.val);
  });
  document.getElementById("score-mission-std-sum").textContent = stdSum;

  // 4.2 區域分數與加分 (27分)
  let zoneSum = 0;
  ["row-zone-1", "row-zone-2", "row-zone-3"].forEach(rowId => {
    const row = document.getElementById(rowId);
    let rowScore = 0;
    row.querySelectorAll(".selectable.active").forEach(cell => {
      rowScore += parseFloat(cell.dataset.val);
    });
    row.querySelector(".zone-row-total").textContent = rowScore;
    zoneSum += rowScore;
  });

  const missionTotal = stdSum + zoneSum;
  document.getElementById("score-mission-total").textContent = missionTotal;

  // 5. 總分結算 (滿分 100)
  const totalScore = Number((stageScore + fluencyWeighted + taskTotal + missionTotal).toFixed(2));
  document.getElementById("final-total-score").textContent = totalScore;
}

// ---------------------------
// 4. iPad 觸控簽名板
// ---------------------------
function initCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#000";

  function getPos(e) {
    const cRect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - cRect.left, y: clientY - cRect.top };
  }

  function start(e) {
    isDrawing = true;
    hasSignature = true;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  }

  function move(e) {
    if (!isDrawing) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    e.preventDefault();
  }

  function end() {
    isDrawing = false;
  }

  canvas.addEventListener("touchstart", start, { passive: false });
  canvas.addEventListener("touchmove", move, { passive: false });
  canvas.addEventListener("touchend", end);

  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", move);
  canvas.addEventListener("mouseup", end);
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  hasSignature = false;
}

// ---------------------------
// 5. 成績送出與防衝突覆寫
// ---------------------------
async function submitScore() {
  if (!hasSignature) {
    alert("請評審完成下方簽名後再行送出！");
    return;
  }

  const btn = document.getElementById("btn-submit");
  btn.disabled = true;
  btn.textContent = "傳送成績中...";

  const stageScore = parseFloat(document.getElementById("score-stage").textContent);
  const fluencyScore = parseFloat(document.getElementById("score-fluency-weighted").textContent);
  const taskScore = parseFloat(document.getElementById("score-task-total").textContent);
  const missionScore = parseFloat(document.getElementById("score-mission-total").textContent);
  const totalScore = parseFloat(document.getElementById("final-total-score").textContent);
  const signatureData = canvas.toDataURL("image/png");

  const payload = {
    judgeName: currentJudge,
    teamId: currentTeam.teamId,
    school: currentTeam.school,
    teamName: currentTeam.teamName,
    stageScore,
    fluencyScore,
    taskScore,
    missionScore,
    totalScore,
    signature: signatureData
  };

  try {
    const res = await fetch(`${API_URL}?action=submitScore`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success) {
      alert("成績已成功同步覆寫至試算表！");
      // 更新本地快取
      scoresCache[currentTeam.teamId] = payload;
      switchPage("summary");
    } else {
      alert("儲存失敗：" + result.message);
    }
  } catch (err) {
    alert("傳輸發生錯誤，請檢查網路：" + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "確認並送出成績";
  }
}
