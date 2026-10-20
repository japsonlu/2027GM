const API_URL = "https://script.google.com/macros/s/AKfycbytvMTqujIoe4T-e5JrpSYr7Yf_X_4E3wlxwXq5ZqwEIh-KUDz1EQwbCHlel62m_P6G/exec";

let currentJudge = null;
let assignedTeams = [];
let scoresCache = {};
let currentTeam = null;

// 關鍵狀態記錄表：記錄每一隊的顯示狀態 ('visible' | 'hidden')
const teamDisplayState = {};

const loginView = document.getElementById("login-view");
const pageSummary = document.getElementById("page-summary");
const pageScoring = document.getElementById("page-scoring");
const judgeDisplay = document.getElementById("judge-display");
const teamListBody = document.getElementById("team-list-body");

const canvas = document.getElementById("sign-pad");
const ctx = canvas.getContext("2d");
let isDrawing = false;
let hasSignature = false;

document.addEventListener("DOMContentLoaded", () => {
  setupSelectionHandlers();

  document.getElementById("btn-login").addEventListener("click", handleLogin);
  document.getElementById("btn-logout").addEventListener("click", () => location.reload());
  document.getElementById("btn-back").addEventListener("click", () => switchPage("summary"));
  document.getElementById("btn-clear-sign").addEventListener("click", clearCanvas);
  document.getElementById("btn-submit").addEventListener("click", submitScore);

  // 全部隱藏 / 全部顯示事件綁定
  document.getElementById("btn-hide-all").addEventListener("click", hideAllScores);
  document.getElementById("btn-show-all").addEventListener("click", showAllScores);

  // 螢幕尺寸改變或橫豎向旋轉時校正畫板
  window.addEventListener("resize", () => {
    if (pageScoring.classList.contains("active")) {
      resizeCanvas();
    }
  });
  window.addEventListener("orientationchange", () => {
    setTimeout(() => {
      if (pageScoring.classList.contains("active")) {
        resizeCanvas();
      }
    }, 200);
  });
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
  btn.textContent = "登入中...";

  try {
    const res = await fetch(`${API_URL}?action=login&username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`);
    const data = await res.json();

    if (data.success) {
      currentJudge = data.judgeName;
      assignedTeams = data.teams || [];
      scoresCache = data.existingScores || {};

      // 初始化所有隊伍的顯示狀態，預設若沒有設定過則為 'visible'
      assignedTeams.forEach(t => {
        if (!teamDisplayState[t.teamId]) {
          teamDisplayState[t.teamId] = "visible";
        }
      });

      judgeDisplay.textContent = `評審：${currentJudge}`;
      loginView.style.display = "none";

      if (assignedTeams.length === 0) {
        alert(
          `【登入成功，但未比對到隊伍】\n\n` +
          `1. 評審名單 D 欄設定文字：\n「${data.rawInputTeams || "(空白)"}」\n\n` +
          `2. 解析出代號：\n${data.parsedTeams.join(", ") || "(無)"}\n\n` +
          `3. 隊伍名單 B 欄代號樣例：\n${data.sampleTeamsInSheet.join(", ") || "(無)"}`
        );
      }

      renderTeamList();
    } else {
      alert("登入失敗：" + (data.message || "帳號密碼不正確"));
    }
  } catch (err) {
    alert("連線後端錯誤，請確認網路或 API 部署：" + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "登入系統";
  }
}

// 根據 teamDisplayState 狀態渲染隊伍清單
function renderTeamList() {
  teamListBody.innerHTML = "";

  if (assignedTeams.length === 0) {
    teamListBody.innerHTML = `<tr><td colspan="12" style="color:#d32f2f; padding: 24px;">查無可評分的隊伍，請確認《評審名單》D 欄是否有填入正確的隊伍編號！</td></tr>`;
    return;
  }

  assignedTeams.forEach(team => {
    const tr = document.createElement("tr");
    tr.id = `team-row-${team.teamId}`;

    const score = scoresCache[team.teamId] || {};

    const stageVal = score.stageScore !== undefined ? score.stageScore : "-";
    const fluencyVal = score.fluencyScore !== undefined ? score.fluencyScore : "-";
    const taskVal = score.taskScore !== undefined ? score.taskScore : "-";
    const stdVal = score.stdScore !== undefined ? score.stdScore : "-";
    const missionVal = score.missionScore !== undefined ? score.missionScore : "-";
    const totalVal = score.totalScore !== undefined ? score.totalScore : "-";

    // 嚴格依照該隊伍目前的記錄狀態決定是否隱藏
    const isHidden = (teamDisplayState[team.teamId] === "hidden");

    tr.innerHTML = `
      <td>${team.group}</td>
      <td style="font-weight:bold;">${team.teamId}</td>
      <td>${team.school}</td>
      <td>${team.teamName}</td>
      <td class="score-col" data-val="${stageVal}">${isHidden ? "***" : stageVal}</td>
      <td class="score-col" data-val="${fluencyVal}">${isHidden ? "***" : fluencyVal}</td>
      <td class="score-col" data-val="${taskVal}">${isHidden ? "***" : taskVal}</td>
      <td class="score-col" data-val="${stdVal}">${isHidden ? "***" : stdVal}</td>
      <td class="score-col" data-val="${missionVal}">${isHidden ? "***" : missionVal}</td>
      <td class="score-col" data-val="${totalVal}" style="font-weight:bold; color:var(--primary);">${isHidden ? "***" : totalVal}</td>
      <td>
        <button class="btn ${isHidden ? "btn-primary" : "btn-secondary"}" 
                style="padding: 4px 6px; font-size:11px;" 
                id="btn-toggle-${team.teamId}"
                onclick="toggleScoreState('${team.teamId}')">
          ${isHidden ? "顯示" : "隱藏"}
        </button>
      </td>
      <td>
        <button class="btn btn-primary" style="padding: 5px 8px; font-size:12px;" onclick="openScoring('${team.teamId}')">
          ${score.totalScore !== undefined ? "重評" : "評分"}
        </button>
      </td>
    `;
    teamListBody.appendChild(tr);
  });
}

// 單一隊伍點擊隱藏/顯示按鈕切換
window.toggleScoreState = function(teamId) {
  const currentState = teamDisplayState[teamId];
  if (currentState === "hidden") {
    teamDisplayState[teamId] = "visible";
  } else {
    teamDisplayState[teamId] = "hidden";
  }
  updateRowDisplay(teamId);
};

// 更新單列畫面，避免重刷整張表影響其他行
function updateRowDisplay(teamId) {
  const row = document.getElementById(`team-row-${teamId}`);
  if (!row) return;

  const isHidden = (teamDisplayState[teamId] === "hidden");
  const scoreCells = row.querySelectorAll(".score-col");
  const btn = document.getElementById(`btn-toggle-${teamId}`);

  scoreCells.forEach(cell => {
    cell.textContent = isHidden ? "***" : cell.dataset.val;
  });

  if (btn) {
    btn.textContent = isHidden ? "顯示" : "隱藏";
    btn.className = `btn ${isHidden ? "btn-primary" : "btn-secondary"}`;
  }
}

// 全部隱藏按鈕：強制將所有隊伍設為 hidden
function hideAllScores() {
  assignedTeams.forEach(team => {
    teamDisplayState[team.teamId] = "hidden";
    updateRowDisplay(team.teamId);
  });
}

// 全部顯示按鈕：強制將所有隊伍設為 visible
function showAllScores() {
  assignedTeams.forEach(team => {
    teamDisplayState[team.teamId] = "visible";
    updateRowDisplay(team.teamId);
  });
}

window.openScoring = function(teamId) {
  currentTeam = assignedTeams.find(t => t.teamId === teamId);
  document.getElementById("current-team-info").textContent = 
    `評分對象：[${currentTeam.teamId}] ${currentTeam.school} - ${currentTeam.teamName}`;

  resetFormToDefaults();
  calculateAllScores();
  switchPage("scoring");

  setTimeout(() => {
    resizeCanvas();
    clearCanvas();
  }, 100);
};

// 只有任務得分加總（區域分數與加分）重設為白色，其他區塊恢復預設值
function resetFormToDefaults() {
  document.querySelectorAll(".toggleable").forEach(cell => {
    cell.classList.remove("active");
  });

  document.querySelectorAll("#row-stage .selectable").forEach(c => c.classList.remove("active"));
  document.querySelector('#row-stage .selectable[data-val="8"]').classList.add("active");

  document.querySelectorAll("#row-fluency .selectable").forEach(c => c.classList.remove("active"));
  document.querySelector('#row-fluency .selectable[data-val="0"]').classList.add("active");

  ["row-task-1", "row-task-2"].forEach(rowId => {
    const row = document.getElementById(rowId);
    row.querySelectorAll(".selectable").forEach(c => c.classList.remove("active"));
    row.querySelector('.selectable[data-val="3"]').classList.add("active");
    row.querySelector('.selectable[data-val="2"]').classList.add("active");
  });

  document.querySelectorAll("#row-mission-std .selectable").forEach(c => c.classList.remove("active"));
  document.querySelectorAll('#row-mission-std .selectable[data-val="2.3333"], #row-mission-std .selectable[data-val="2.3334"]').forEach(c => c.classList.add("active"));
}

function switchPage(page) {
  if (page === "summary") {
    pageSummary.classList.add("active");
    pageScoring.classList.remove("active");
    document.getElementById("page-title").textContent = "總評分表";
    // 返回總表時重新渲染，嚴格依照各隊伍各自的 teamDisplayState 狀態決定維持隱藏或維持顯示
    renderTeamList();
  } else {
    pageSummary.classList.remove("active");
    pageScoring.classList.add("active");
    document.getElementById("page-title").textContent = "隊伍評分表";
  }
}

function setupSelectionHandlers() {
  document.querySelectorAll(".selectable").forEach(cell => {
    cell.addEventListener("click", function() {
      const parentRow = this.closest("tr");
      const group = this.dataset.group;
      const isToggleable = this.classList.contains("toggleable");

      if (isToggleable) {
        if (this.classList.contains("active")) {
          this.classList.remove("active");
        } else {
          parentRow.querySelectorAll(`.selectable[data-group="${group}"]`).forEach(c => c.classList.remove("active"));
          this.classList.add("active");
        }
      } else {
        if (group) {
          parentRow.querySelectorAll(`.selectable[data-group="${group}"]`).forEach(c => c.classList.remove("active"));
        } else {
          parentRow.querySelectorAll(".selectable").forEach(c => c.classList.remove("active"));
        }
        this.classList.add("active");
      }

      calculateAllScores();
    });
  });
}

function calculateAllScores() {
  // 1. 關卡數量
  const stageEl = document.querySelector("#row-stage .selectable.active");
  const stageCount = stageEl ? parseFloat(stageEl.dataset.val) : 8;
  const stageScore = stageCount * 2;
  document.getElementById("score-stage").textContent = stageScore;

  // 2. 流暢度
  const fluencyEl = document.querySelector("#row-fluency .selectable.active");
  let fluencyRaw = 20;
  let fluencyWeighted = 20;

  if (fluencyEl) {
    const drops = parseFloat(fluencyEl.dataset.val);
    fluencyRaw = Math.max(0, 20 - drops * 2);
    fluencyWeighted = Number(((fluencyRaw * stageCount) / 8).toFixed(2));
  }

  document.getElementById("score-fluency-raw").textContent = fluencyRaw;
  document.getElementById("score-fluency-weighted").textContent = fluencyWeighted;

  // 3. 關卡任務
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

  // 4. 指定任務
  let stdSum = 0;
  document.querySelectorAll("#row-mission-std .selectable.active").forEach(cell => {
    stdSum += parseFloat(cell.dataset.val);
  });
  const stdTotal = Math.round(stdSum);
  document.getElementById("score-mission-std-sum").textContent = stdTotal;

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
  const missionScoreTotal = Number(zoneSum.toFixed(2));
  document.getElementById("score-mission-total").textContent = missionScoreTotal;

  // 5. 總分結算
  const totalScore = Number((stageScore + fluencyWeighted + taskTotal + stdTotal + missionScoreTotal).toFixed(2));
  document.getElementById("final-total-score").textContent = totalScore;
}

// ---------------------------
// 簽名板 (支援 Retina 解析度與旋轉保留筆跡)
// ---------------------------
function resizeCanvas() {
  const container = canvas.parentElement;
  if (!container || container.offsetParent === null) return;

  let tempImg = null;
  if (hasSignature) {
    tempImg = canvas.toDataURL();
  }

  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#000000";

  if (tempImg) {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, rect.width, rect.height);
    };
    img.src = tempImg;
  }
}

function getEventPos(e) {
  const rect = canvas.getBoundingClientRect();
  let clientX, clientY;

  if (e.touches && e.touches.length > 0) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

function startDrawing(e) {
  isDrawing = true;
  hasSignature = true;
  const pos = getEventPos(e);
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  e.preventDefault();
}

function draw(e) {
  if (!isDrawing) return;
  const pos = getEventPos(e);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
  e.preventDefault();
}

function stopDrawing() {
  isDrawing = false;
}

canvas.addEventListener("touchstart", startDrawing, { passive: false });
canvas.addEventListener("touchmove", draw, { passive: false });
canvas.addEventListener("touchend", stopDrawing);
canvas.addEventListener("touchcancel", stopDrawing);

canvas.addEventListener("mousedown", startDrawing);
canvas.addEventListener("mousemove", draw);
canvas.addEventListener("mouseup", stopDrawing);
canvas.addEventListener("mouseleave", stopDrawing);

function clearCanvas() {
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  hasSignature = false;
}

// ---------------------------
// 送出成績
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
  const stdScore = parseFloat(document.getElementById("score-mission-std-sum").textContent);
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
    stdScore,
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
      scoresCache[currentTeam.teamId] = payload;

      // 【核心修改】：只將剛評完分的這支隊伍設為顯現 (visible)，其他隊伍維持原狀態不變
      teamDisplayState[currentTeam.teamId] = "visible";

      // 返回總表，renderTeamList() 會依照各隊狀態顯示，其他原本隱藏的依然是 ***
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
