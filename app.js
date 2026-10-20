const API_URL = "https://script.google.com/macros/s/AKfycbw_b9xybad6ylP9ARxTHyAf1r54mY-p-K2Tv8FmtniJ7U90tjQFbRvNLhh2iNBlA1-T/exec";

let currentJudge = null;
let currentPass = null; // 紀錄密碼以供手動與自動同步查詢
let assignedTeams = [];
let scoresCache = {}; 
let currentTeam = null;

// 記錄每一隊的顯示狀態 ('visible' | 'hidden')
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
let syncTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  setupSelectionHandlers();

  document.getElementById("btn-login").addEventListener("click", handleLogin);
  document.getElementById("btn-logout").addEventListener("click", () => location.reload());
  document.getElementById("btn-back").addEventListener("click", () => switchPage("summary"));
  document.getElementById("btn-clear-sign").addEventListener("click", clearCanvas);
  document.getElementById("btn-submit").addEventListener("click", submitScore);

  document.getElementById("btn-hide-all").addEventListener("click", hideAllScores);
  document.getElementById("btn-show-all").addEventListener("click", showAllScores);

  const btnSync = document.getElementById("btn-sync-cloud");
  if (btnSync) {
    btnSync.addEventListener("click", () => {
      fetchLatestScores(true);
    });
  }

  window.addEventListener("resize", () => {
    if (pageScoring.classList.contains("active")) {
      resizeCanvas(hasSignature);
    }
  });
  window.addEventListener("orientationchange", () => {
    setTimeout(() => {
      if (pageScoring.classList.contains("active")) {
        resizeCanvas(hasSignature);
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
    const res = await fetch(`${API_URL}?action=login&username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&_t=${Date.now()}`);
    const data = await res.json();

    if (data.success) {
      currentJudge = data.judgeName;
      currentPass = pass;
      assignedTeams = data.teams || [];
      scoresCache = data.existingScores || {};

      assignedTeams.forEach(t => {
        if (!teamDisplayState[t.teamId]) {
          teamDisplayState[t.teamId] = "visible";
        }
      });

      judgeDisplay.textContent = `評審：${currentJudge}`;
      loginView.style.display = "none";

      renderTeamList();

      // 每 15 秒定時同步試算表成績
      if (syncTimer) clearInterval(syncTimer);
      syncTimer = setInterval(() => {
        if (pageSummary.classList.contains("active") && currentJudge) {
          fetchLatestScores(false);
        }
      }, 15000);

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

// 核心同步函式：向 Google 試算表反向讀取最新成績
async function fetchLatestScores(showNotice = false) {
  if (!currentJudge) return;

  const btnSync = document.getElementById("btn-sync-cloud");
  if (showNotice && btnSync) {
    btnSync.disabled = true;
    btnSync.textContent = "同步中...";
  }

  try {
    const fetchUrl = `${API_URL}?action=getScores&judgeName=${encodeURIComponent(currentJudge)}&password=${encodeURIComponent(currentPass || "")}&_t=${Date.now()}`;
    const res = await fetch(fetchUrl);
    const data = await res.json();

    if (data.success) {
      scoresCache = data.existingScores || data.scores || {};
      renderTeamList();
      if (showNotice) {
        alert("【同步成功】已重新取得試算表最新成績！\n若後台剛清空資料，總表已全數歸零。");
      }
    } else {
      if (showNotice) alert("同步失敗：" + (data.message || "伺服器未回傳有效成績"));
    }
  } catch (e) {
    console.error("同步失敗", e);
    if (showNotice) {
      alert("連線後端同步失敗，請檢查網路連線或稍後再試！");
    }
  } finally {
    if (showNotice && btnSync) {
      btnSync.disabled = false;
      btnSync.textContent = "🔄 同步雲端成績";
    }
  }
}

function formatScoreVal(val) {
  if (val === undefined || val === null || val === "" || val === "-") {
    return "";
  }
  return String(val);
}

function getDisplayScore(valStr, isHidden) {
  if (!valStr && valStr !== "0") return "";
  return isHidden ? "***" : valStr;
}

// 渲染總表
function renderTeamList() {
  teamListBody.innerHTML = "";

  if (assignedTeams.length === 0) {
    teamListBody.innerHTML = `<tr><td colspan="12" style="color:#d32f2f; padding: 24px;">查無可評分的隊伍，請確認《評審名單》是否有填入正確的隊伍編號！</td></tr>`;
    return;
  }

  // 排序：未評分在前 (綠色)，已評分在後 (紅色)
  const sortedTeams = [...assignedTeams].sort((a, b) => {
    const aScore = scoresCache[a.teamId];
    const bScore = scoresCache[b.teamId];
    const aScored = aScore && aScore.totalScore !== undefined && aScore.totalScore !== "";
    const bScored = bScore && bScore.totalScore !== undefined && bScore.totalScore !== "";

    if (aScored === bScored) return 0;
    return aScored ? 1 : -1;
  });

  sortedTeams.forEach(team => {
    const tr = document.createElement("tr");
    tr.id = `team-row-${team.teamId}`;

    const score = scoresCache[team.teamId] || {};
    const isScored = (score.totalScore !== undefined && score.totalScore !== null && score.totalScore !== "");

    // 規範分數鍵名完整防呆支援
    let stdRaw = score.stdScore;
    if (stdRaw === undefined || stdRaw === null || stdRaw === "") {
      stdRaw = score.missionStdScore !== undefined ? score.missionStdScore : (score.ruleScore !== undefined ? score.ruleScore : score.std);
    }

    const stageVal = formatScoreVal(score.stageScore);
    const fluencyVal = formatScoreVal(score.fluencyScore);
    const taskVal = formatScoreVal(score.taskScore);
    const stdVal = formatScoreVal(stdRaw);
    const missionVal = formatScoreVal(score.missionScore);
    const totalVal = formatScoreVal(score.totalScore);

    const isHidden = (teamDisplayState[team.teamId] === "hidden");

    tr.innerHTML = `
      <td>${team.group}</td>
      <td style="font-weight:bold;">${team.teamId}</td>
      <td>${team.school}</td>
      <td>${team.teamName}</td>
      <td class="score-col" data-val="${stageVal}">${getDisplayScore(stageVal, isHidden)}</td>
      <td class="score-col" data-val="${fluencyVal}">${getDisplayScore(fluencyVal, isHidden)}</td>
      <td class="score-col" data-val="${taskVal}">${getDisplayScore(taskVal, isHidden)}</td>
      <td class="score-col" data-val="${stdVal}">${getDisplayScore(stdVal, isHidden)}</td>
      <td class="score-col" data-val="${missionVal}">${getDisplayScore(missionVal, isHidden)}</td>
      <td class="score-col" data-val="${totalVal}" style="font-weight:bold; color:var(--primary);">${getDisplayScore(totalVal, isHidden)}</td>
      <td>
        <button class="btn ${isHidden ? "btn-primary" : "btn-secondary"}" 
                style="padding: 4px 6px; font-size:11px;" 
                id="btn-toggle-${team.teamId}"
                onclick="toggleScoreState('${team.teamId}')">
          ${isHidden ? "顯示" : "隱藏"}
        </button>
      </td>
      <td>
        <button class="btn ${isScored ? "btn-danger" : "btn-success"}" 
                style="padding: 5px 8px; font-size:12px;" 
                onclick="openScoring('${team.teamId}')">
          ${isScored ? "重評" : "評分"}
        </button>
      </td>
    `;
    teamListBody.appendChild(tr);
  });
}

// 單一隊伍切換隱藏/顯示
window.toggleScoreState = function(teamId) {
  const currentState = teamDisplayState[teamId];
  if (currentState === "hidden") {
    teamDisplayState[teamId] = "visible";
  } else {
    teamDisplayState[teamId] = "hidden";
  }
  updateRowDisplay(teamId);
};

function updateRowDisplay(teamId) {
  const row = document.getElementById(`team-row-${teamId}`);
  if (!row) return;

  const isHidden = (teamDisplayState[teamId] === "hidden");
  const scoreCells = row.querySelectorAll(".score-col");
  const btn = document.getElementById(`btn-toggle-${teamId}`);

  scoreCells.forEach(cell => {
    const rawVal = cell.dataset.val || "";
    cell.textContent = getDisplayScore(rawVal, isHidden);
  });

  if (btn) {
    btn.textContent = isHidden ? "顯示" : "隱藏";
    btn.className = `btn ${isHidden ? "btn-primary" : "btn-secondary"}`;
  }
}

function hideAllScores() {
  assignedTeams.forEach(team => {
    teamDisplayState[team.teamId] = "hidden";
    updateRowDisplay(team.teamId);
  });
}

function showAllScores() {
  assignedTeams.forEach(team => {
    teamDisplayState[team.teamId] = "visible";
    updateRowDisplay(team.teamId);
  });
}

// 開啟評分頁面
window.openScoring = function(teamId) {
  currentTeam = assignedTeams.find(t => t.teamId === teamId);
  document.getElementById("current-team-info").textContent = 
    `評分對象：[${currentTeam.teamId}] ${currentTeam.school} - ${currentTeam.teamName}`;

  resetFormToDefaults();
  calculateAllScores();
  switchPage("scoring");

  // 清除前一隊的簽名畫布狀態
  hasSignature = false;
  isDrawing = false;
  canvas.width = 0;
  canvas.height = 0;

  setTimeout(() => {
    resizeCanvas(false);
    clearCanvas();
  }, 120);
};

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
    fetchLatestScores(false);
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

  // 4. 指定任務 - 規範 (滿分 21)
  let stdSum = 0;
  document.querySelectorAll("#row-mission-std .selectable.active").forEach(cell => {
    stdSum += parseFloat(cell.dataset.val);
  });
  const stdTotal = Math.round(stdSum);
  document.getElementById("score-mission-std-sum").textContent = stdTotal;

  // 4. 指定任務 - 得分 (滿分 33)
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

// 簽名板縮放校正
function resizeCanvas(preserveExisting = false) {
  const container = canvas.parentElement;
  if (!container || container.offsetParent === null) return;

  let tempImg = null;
  if (preserveExisting && hasSignature) {
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

// 送出成績
async function submitScore() {
  if (!hasSignature) {
    alert("請評審完成下方簽名後再行送出！");
    return;
  }

  const btn = document.getElementById("btn-submit");
  btn.disabled = true;
  btn.textContent = "傳送成績中...";

  const stageScore = parseFloat(document.getElementById("score-stage").textContent) || 0;
  const fluencyScore = parseFloat(document.getElementById("score-fluency-weighted").textContent) || 0;
  const taskScore = parseFloat(document.getElementById("score-task-total").textContent) || 0;
  const stdScore = parseFloat(document.getElementById("score-mission-std-sum").textContent) || 0;
  const missionScore = parseFloat(document.getElementById("score-mission-total").textContent) || 0;
  const totalScore = parseFloat(document.getElementById("final-total-score").textContent) || 0;
  const signatureData = canvas.toDataURL("image/png");

  // 產生格式化評分時間：YYYY/MM/DD HH:mm:ss
  const now = new Date();
  const timestamp = now.getFullYear() + "/" +
    String(now.getMonth() + 1).padStart(2, "0") + "/" +
    String(now.getDate()).padStart(2, "0") + " " +
    String(now.getHours()).padStart(2, "0") + ":" +
    String(now.getMinutes()).padStart(2, "0") + ":" +
    String(now.getSeconds()).padStart(2, "0");

  // 按照指定的 13 個欄位順序打包傳遞
  const payload = {
    group: currentTeam.group || "",          // 1. 組別
    teamId: currentTeam.teamId,              // 2. 隊伍編號
    school: currentTeam.school,              // 3. 學校名稱
    teamName: currentTeam.teamName,          // 4. 隊伍名稱
    stageScore: stageScore,                  // 5. 關卡(16)
    fluencyScore: fluencyScore,              // 6. 流暢度(20)
    taskScore: taskScore,                    // 7. 內容(10)
    stdScore: stdScore,                      // 8. 規範(21)
    missionStdScore: stdScore,               // 雙向相容鍵
    ruleScore: stdScore,
    missionScore: missionScore,              // 9. 任務(33)
    totalScore: totalScore,                  // 10. 總分(100)
    judgeName: currentJudge,                 // 11. 評分者
    timestamp: timestamp,                    // 12. 評分時間
    signature: signatureData                 // 13. 簽名檔案
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
      
      // 更新本機快取
      scoresCache[currentTeam.teamId] = payload;
      teamDisplayState[currentTeam.teamId] = "visible";

      // 銷毀當前簽名
      clearCanvas();
      hasSignature = false;
      canvas.width = 0;
      canvas.height = 0;

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
