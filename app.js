const API_URL = "https://script.google.com/macros/s/AKfycbytvMTqujIoe4T-e5JrpSYr7Yf_X_4E3wlxwXq5ZqwEIh-KUDz1EQwbCHlel62m_P6G/exec";

let currentJudge = null;
let assignedTeams = [];
let scoresCache = {};
let currentTeam = null;

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

  // 視窗尺寸改變時重新校準 Canvas
  window.addEventListener("resize", resizeCanvas);
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

function renderTeamList() {
  teamListBody.innerHTML = "";

  if (assignedTeams.length === 0) {
    teamListBody.innerHTML = `<tr><td colspan="11" style="color:#d32f2f; padding: 24px;">查無可評分的隊伍，請確認《評審名單》D 欄是否有填入正確的隊伍編號！</td></tr>`;
    return;
  }

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

window.openScoring = function(teamId) {
  currentTeam = assignedTeams.find(t => t.teamId === teamId);
  document.getElementById("current-team-info").textContent = 
    `評分對象：[${currentTeam.teamId}] ${currentTeam.school} - ${currentTeam.teamName}`;

  resetAllFormSelections();
  calculateAllScores();
  switchPage("scoring");

  // 切換至評分頁後校準畫布
  setTimeout(() => {
    resizeCanvas();
    clearCanvas();
  }, 100);
};

// 一開始都不選取，全部重設為白色
function resetAllFormSelections() {
  document.querySelectorAll(".selectable").forEach(cell => {
    cell.classList.remove("active");
  });
}

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

// 點選變藍、再點一次取消變白（Toggle 邏輯）
function setupSelectionHandlers() {
  document.querySelectorAll(".selectable").forEach(cell => {
    cell.addEventListener("click", function() {
      const parentRow = this.closest("tr");
      const group = this.dataset.group;

      if (this.classList.contains("active")) {
        // 若已經是藍色，再點一次變回白色（取消選取）
        this.classList.remove("active");
      } else {
        // 同一組別（例如同一列或同項目）其他格取消藍色
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

// 核心計分運算
function calculateAllScores() {
  // 1. 關卡數量 (若未選則為 0 分)
  const stageEl = document.querySelector("#row-stage .selectable.active");
  const stageCount = stageEl ? parseFloat(stageEl.dataset.val) : 0;
  const stageScore = stageCount * 2;
  document.getElementById("score-stage").textContent = stageScore;

  // 2. 流暢度與加權 (若未選次數則為 0 分)
  const fluencyEl = document.querySelector("#row-fluency .selectable.active");
  let fluencyRaw = 0;
  let fluencyWeighted = 0;

  if (fluencyEl) {
    const drops = parseFloat(fluencyEl.dataset.val);
    fluencyRaw = Math.max(0, 20 - drops * 2);
    // 加權公式：(20 - 次數*2) * 關卡數量 / 8
    fluencyWeighted = stageCount > 0 ? Number(((fluencyRaw * stageCount) / 8).toFixed(2)) : 0;
  }

  document.getElementById("score-fluency-raw").textContent = fluencyRaw;
  document.getElementById("score-fluency-weighted").textContent = fluencyWeighted;

  // 3. 關卡任務 (任務一、任務二)
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
  // 4.1 標準規範 (未選為 0)
  let stdSum = 0;
  document.querySelectorAll("#row-mission-std .selectable.active").forEach(cell => {
    stdSum += parseFloat(cell.dataset.val);
  });
  document.getElementById("score-mission-std-sum").textContent = stdSum;

  // 4.2 區域分數與加分 (未選為 0)
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

  // 5. 總分結算
  const totalScore = Number((stageScore + fluencyWeighted + taskTotal + missionTotal).toFixed(2));
  document.getElementById("final-total-score").textContent = totalScore;
}

// ---------------------------
// 簽名板 (完美支援手機觸控、iPad Apple Pencil 與 Retina 高解析)
// ---------------------------
function resizeCanvas() {
  const container = canvas.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  // 解決手機高解析螢幕模糊與座標偏移
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#000000";
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

// 綁定觸控與滑鼠事件
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
