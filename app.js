const API_URL = "https://script.google.com/macros/s/AKfycbzhbWmJzRP0qwuxyKdxETuvooZ6WwAO_fYT8NfpRNlU1uOHFOY0qS0AwojlAluhUlNr/exec";

let currentJudge = null;
let currentPass = null;
let isAdminUser = false;
let currentSortMode = "teamId"; // "teamId" | "scoreDesc"
let currentGroupFilter = "GAE"; // 預設國小組 (GAE)
let assignedTeams = [];
let scoresCache = {}; 
let currentTeam = null;

const teamDisplayState = {};

const loginView = document.getElementById("login-view");
const pageSummary = document.getElementById("page-summary");
const pageScoring = document.getElementById("page-scoring");
const judgeDisplay = document.getElementById("judge-display");
const regionTag = document.getElementById("region-tag");
const teamListBody = document.getElementById("team-list-body");

const modalAddRegion = document.getElementById("modal-add-region");
const selectActiveRegion = document.getElementById("select-active-region");

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

  // 一般評審按鈕
  document.getElementById("btn-hide-all").addEventListener("click", hideAllScores);
  document.getElementById("btn-show-all").addEventListener("click", showAllScores);

  // admin 排序按鈕
  document.getElementById("btn-sort-teamid").addEventListener("click", () => {
    currentSortMode = "teamId";
    renderTeamList();
  });
  document.getElementById("btn-sort-score").addEventListener("click", () => {
    currentSortMode = "scoreDesc";
    renderTeamList();
  });

  // admin 組別篩選按鈕 (國小 / 國中 / 高中)
  document.querySelectorAll(".btn-filter-group").forEach(btn => {
    btn.addEventListener("click", function() {
      currentGroupFilter = this.dataset.filter;
      document.querySelectorAll(".btn-filter-group").forEach(b => {
        b.className = "btn btn-secondary btn-filter-group";
      });
      this.className = "btn btn-primary btn-filter-group";
      renderTeamList();
    });
  });

  // admin 匯出 PDF 按鈕
  const btnExportPdf = document.getElementById("btn-export-pdf");
  if (btnExportPdf) {
    btnExportPdf.addEventListener("click", exportSummaryToPdf);
  }

  // 同步雲端成績按鈕
  document.querySelectorAll(".btn-sync-cloud").forEach(btn => {
    btn.addEventListener("click", () => {
      fetchLatestScores(true);
    });
  });

  // admin 手動新增賽事彈窗控制
  document.getElementById("btn-open-add-region").addEventListener("click", () => {
    modalAddRegion.style.display = "flex";
  });
  document.getElementById("btn-cancel-add-region").addEventListener("click", () => {
    modalAddRegion.style.display = "none";
  });
  document.getElementById("btn-confirm-add-region").addEventListener("click", submitCreateTournament);
  document.getElementById("btn-switch-region").addEventListener("click", submitSwitchRegion);

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
      isAdminUser = (user.toLowerCase() === "admin") || !!data.isAdmin;
      
      assignedTeams = data.teams || [];
      scoresCache = data.existingScores || {};

      assignedTeams.forEach(t => {
        teamDisplayState[t.teamId] = "visible";
      });

      judgeDisplay.textContent = isAdminUser ? `系統管理員：${currentJudge}` : `評審：${currentJudge}`;
      if (data.regionName) {
        regionTag.textContent = data.regionName;
        regionTag.style.display = "inline-block";
      }

      loginView.style.display = "none";

      applyUserRoleUI();

      if (isAdminUser) {
        loadRegionsList();
      }

      renderTeamList();

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

function applyUserRoleUI() {
  const judgeActions = document.getElementById("judge-actions");
  const adminActions = document.getElementById("admin-actions");
  const thHideScore = document.querySelector(".th-hide-score");
  const thLastAction = document.getElementById("th-last-action");

  if (isAdminUser) {
    judgeActions.style.display = "none";
    adminActions.style.display = "flex";
    if (thHideScore) thHideScore.style.display = "none";
    if (thLastAction) thLastAction.textContent = "評分者";
  } else {
    judgeActions.style.display = "flex";
    adminActions.style.display = "none";
    if (thHideScore) thHideScore.style.display = "";
    if (thLastAction) thLastAction.textContent = "操作";
  }
}

// 取得所有賽事清單 (admin)
async function loadRegionsList() {
  try {
    const res = await fetch(`${API_URL}?action=getRegions&_t=${Date.now()}`);
    const data = await res.json();
    if (data.success && data.config) {
      selectActiveRegion.innerHTML = "";
      data.config.regions.forEach(r => {
        const opt = document.createElement("option");
        opt.value = r.name;
        opt.textContent = r.name;
        if (r.active) opt.selected = true;
        selectActiveRegion.appendChild(opt);
      });
      if (data.config.activeRegion) {
        regionTag.textContent = data.config.activeRegion.name;
      }
    }
  } catch (e) {
    console.error("載入賽事清單失敗", e);
  }
}

// 手動送出建立新賽事
async function submitCreateTournament() {
  const regionName = document.getElementById("input-new-region-name").value.trim();
  const rawDate = document.getElementById("input-new-region-date").value.trim();

  if (!regionName) {
    alert("請填寫賽事區域名稱（例如：桃園賽、台北賽）！");
    return;
  }
  if (!rawDate) {
    alert("請選擇比賽日期！");
    return;
  }

  // 將 2026-10-31 格式化為 20261031
  const eventDate = rawDate.replace(/-/g, "");

  const btn = document.getElementById("btn-confirm-add-region");
  btn.disabled = true;
  btn.textContent = "建立雲端表單中...";

  try {
    const res = await fetch(`${API_URL}?action=createTournament`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        adminUser: "admin",
        regionName: regionName,
        eventDate: eventDate
      })
    });
    const result = await res.json();

    if (result.success) {
      alert(`【建立成功！】\n表單名稱：${result.tournamentName}\n已自動移至指定雲端資料夾並取得表單 ID！`);
      modalAddRegion.style.display = "none";
      document.getElementById("input-new-region-name").value = "";
      document.getElementById("input-new-region-date").value = "";
      await loadRegionsList();
    } else {
      alert("建立失敗：" + result.message);
    }
  } catch (err) {
    alert("建立新賽事發生錯誤：" + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "建立賽事表單";
  }
}

// 鎖定切換賽事
async function submitSwitchRegion() {
  const targetRegion = selectActiveRegion.value;
  if (!targetRegion) return;

  if (!confirm(`確定要將系統賽事切換鎖定為「${targetRegion}」嗎？\n鎖定後，所有評審登入將直接進入此賽事的評分表！`)) {
    return;
  }

  try {
    const res = await fetch(`${API_URL}?action=switchRegion`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ adminUser: "admin", regionName: targetRegion })
    });
    const result = await res.json();
    if (result.success) {
      alert(result.message);
      location.reload(); // 重新載入以讀取新鎖定賽事名單
    } else {
      alert("切換失敗：" + result.message);
    }
  } catch (err) {
    alert("切換賽事發生錯誤：" + err.message);
  }
}

async function fetchLatestScores(showNotice = false) {
  if (!currentJudge) return;

  const syncBtns = document.querySelectorAll(".btn-sync-cloud");
  if (showNotice) {
    syncBtns.forEach(b => { b.disabled = true; b.textContent = "同步中..."; });
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
    if (showNotice) {
      syncBtns.forEach(b => { b.disabled = false; b.textContent = "🔄 同步雲端成績"; });
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
  if (isAdminUser) return valStr;
  return isHidden ? "***" : valStr;
}

// 渲染總表隊伍清單
function renderTeamList() {
  teamListBody.innerHTML = "";

  if (assignedTeams.length === 0) {
    teamListBody.innerHTML = `<tr><td colspan="12" style="color:#d32f2f; padding: 24px;">查無可評分的隊伍，請確認當前賽事試算表的《隊伍名單》是否有填寫！</td></tr>`;
    return;
  }

  let filteredTeams = assignedTeams;
  if (isAdminUser) {
    filteredTeams = assignedTeams.filter(t => {
      const idUpper = String(t.teamId).toUpperCase();
      return idUpper.startsWith(currentGroupFilter);
    });
  }

  if (filteredTeams.length === 0) {
    teamListBody.innerHTML = `<tr><td colspan="12" style="color:#666; padding: 24px;">查無此組別之隊伍！</td></tr>`;
    return;
  }

  const sortedTeams = [...filteredTeams].sort((a, b) => {
    const aScore = scoresCache[a.teamId];
    const bScore = scoresCache[b.teamId];
    const aTotal = (aScore && aScore.totalScore !== undefined && aScore.totalScore !== "") ? parseFloat(aScore.totalScore) : null;
    const bTotal = (bScore && bScore.totalScore !== undefined && bScore.totalScore !== "") ? parseFloat(bScore.totalScore) : null;

    if (isAdminUser) {
      if (currentSortMode === "scoreDesc") {
        if (aTotal !== null && bTotal !== null) return bTotal - aTotal;
        if (aTotal !== null && bTotal === null) return -1;
        if (aTotal === null && bTotal !== null) return 1;
        return a.teamId.localeCompare(b.teamId, undefined, { numeric: true });
      } else {
        return a.teamId.localeCompare(b.teamId, undefined, { numeric: true });
      }
    } else {
      const aScored = (aTotal !== null);
      const bScored = (bTotal !== null);
      if (aScored === bScored) {
        return a.teamId.localeCompare(b.teamId, undefined, { numeric: true });
      }
      return aScored ? 1 : -1;
    }
  });

  sortedTeams.forEach(team => {
    const tr = document.createElement("tr");
    tr.id = `team-row-${team.teamId}`;

    const score = scoresCache[team.teamId] || {};
    const isScored = (score.totalScore !== undefined && score.totalScore !== null && score.totalScore !== "");

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

    const hideBtnColumn = isAdminUser ? "" : `
      <td>
        <button class="btn ${isHidden ? "btn-primary" : "btn-secondary"}" 
                style="padding: 4px 6px; font-size:11px;" 
                id="btn-toggle-${team.teamId}"
                onclick="toggleScoreState('${team.teamId}')">
          ${isHidden ? "顯示" : "隱藏"}
        </button>
      </td>
    `;

    let lastColumnHtml = "";
    if (isAdminUser) {
      const judgeName = score.judgeName || "";
      lastColumnHtml = `<td style="font-weight: 500; color: #333;">${judgeName}</td>`;
    } else {
      lastColumnHtml = `
        <td>
          <button class="btn ${isScored ? "btn-danger" : "btn-success"}" 
                  style="padding: 5px 8px; font-size:12px;" 
                  onclick="openScoring('${team.teamId}')">
            ${isScored ? "重評" : "評分"}
          </button>
        </td>
      `;
    }

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
      ${hideBtnColumn}
      ${lastColumnHtml}
    `;
    teamListBody.appendChild(tr);
  });
}

function exportSummaryToPdf() {
  let groupName = "國小組";
  if (currentGroupFilter === "GAJ") groupName = "國中組";
  else if (currentGroupFilter === "GAH") groupName = "高中組";

  const originalTitle = document.title;
  const today = new Date();
  const dateStr = today.getFullYear() + String(today.getMonth() + 1).padStart(2, "0") + String(today.getDate()).padStart(2, "0");
  
  const currentTourName = regionTag.textContent ? `_${regionTag.textContent}` : "";
  document.title = `機關王評分總表${currentTourName}_${groupName}_${dateStr}`;

  const rows = document.querySelectorAll("#team-list-body tr");
  const count = rows.length;
  const table = document.getElementById("summary-table");

  let scale = 1.0;
  if (count > 15 && count <= 25) {
    scale = 0.85;
  } else if (count > 25 && count <= 35) {
    scale = 0.72;
  } else if (count > 35) {
    scale = 0.60;
  }

  table.style.zoom = scale;
  window.print();
  table.style.zoom = "";
  document.title = originalTitle;
}

window.toggleScoreState = function(teamId) {
  if (isAdminUser) return;
  const currentState = teamDisplayState[teamId];
  teamDisplayState[teamId] = (currentState === "hidden") ? "visible" : "hidden";
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
  if (isAdminUser) return;
  assignedTeams.forEach(team => {
    teamDisplayState[team.teamId] = "hidden";
    updateRowDisplay(team.teamId);
  });
}

function showAllScores() {
  if (isAdminUser) return;
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
  const stageEl = document.querySelector("#row-stage .selectable.active");
  const stageCount = stageEl ? parseFloat(stageEl.dataset.val) : 8;
  const stageScore = stageCount * 2;
  document.getElementById("score-stage").textContent = stageScore;

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

  const totalScore = Number((stageScore + fluencyWeighted + taskTotal + stdTotal + missionScoreTotal).toFixed(2));
  document.getElementById("final-total-score").textContent = totalScore;
}

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

  const now = new Date();
  const timestamp = now.getFullYear() + "/" +
    String(now.getMonth() + 1).padStart(2, "0") + "/" +
    String(now.getDate()).padStart(2, "0") + " " +
    String(now.getHours()).padStart(2, "0") + ":" +
    String(now.getMinutes()).padStart(2, "0") + ":" +
    String(now.getSeconds()).padStart(2, "0");

  const payload = {
    group: currentTeam.group || "",
    teamId: currentTeam.teamId,
    school: currentTeam.school,
    teamName: currentTeam.teamName,
    stageScore: stageScore,
    fluencyScore: fluencyScore,
    taskScore: taskScore,
    stdScore: stdScore,
    missionStdScore: stdScore,
    ruleScore: stdScore,
    missionScore: missionScore,
    totalScore: totalScore,
    judgeName: currentJudge,
    timestamp: timestamp,
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
      teamDisplayState[currentTeam.teamId] = "visible";

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
