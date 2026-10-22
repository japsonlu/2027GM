const API_URL = "https://script.google.com/macros/s/AKfycbzhbWmJzRP0qwuxyKdxETuvooZ6WwAO_fYT8NfpRNlU1uOHFOY0qS0AwojlAluhUlNr/exec";

let currentJudge = null;
let currentPass = null;
let currentUsername = null;
let isAdminUser = false;
let currentDivision = "advanced"; // 預設或當前模式 ("basic" | "advanced")
let currentSortMode = "scoreDesc"; // "teamId" | "scoreDesc"
let currentGroupFilter = "GAE"; // "GAE" | "GAJ" | "GAH"
let currentRegionName = "";

let assignedTeams = [];
let scoresCache = {}; 
let currentTeam = null;

const teamDisplayState = {};

const loginView = document.getElementById("login-view");
const pageSummary = document.getElementById("page-summary");
const pageScoring = document.getElementById("page-scoring");
const judgeDisplay = document.getElementById("judge-display");
const regionTag = document.getElementById("region-tag");
const divisionTag = document.getElementById("division-tag");
const teamListBody = document.getElementById("team-list-body");
const summaryThead = document.getElementById("summary-thead");

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

  document.getElementById("btn-hide-all").addEventListener("click", hideAllScores);
  document.getElementById("btn-show-all").addEventListener("click", showAllScores);

  // 組別切換按鈕
  document.querySelectorAll(".btn-division-toggle").forEach(btn => {
    btn.addEventListener("click", function() {
      currentDivision = this.dataset.division;
      document.querySelectorAll(".btn-division-toggle").forEach(b => {
        b.className = "btn btn-secondary btn-division-toggle";
      });
      this.className = "btn btn-primary btn-division-toggle";
      updateDivisionBadge();
      fetchLatestScores(true);
    });
  });

  // 年段篩選
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

  // 排序
  document.getElementById("btn-sort-teamid").addEventListener("click", () => {
    currentSortMode = "teamId";
    renderTeamList();
  });
  document.getElementById("btn-sort-score").addEventListener("click", () => {
    currentSortMode = "scoreDesc";
    renderTeamList();
  });

  // 匯出 PDF
  const btnExportPdf = document.getElementById("btn-export-pdf");
  if (btnExportPdf) {
    btnExportPdf.addEventListener("click", exportSummaryToPdf);
  }

  // 同步成績
  document.querySelectorAll(".btn-sync-cloud").forEach(btn => {
    btn.addEventListener("click", () => fetchLatestScores(true));
  });

  // 賽事新增與切換
  document.getElementById("btn-open-add-region").addEventListener("click", () => {
    modalAddRegion.style.display = "flex";
  });
  document.getElementById("btn-cancel-add-region").addEventListener("click", () => {
    modalAddRegion.style.display = "none";
  });
  document.getElementById("btn-confirm-add-region").addEventListener("click", submitCreateTournament);
  document.getElementById("btn-switch-region").addEventListener("click", submitSwitchRegion);

  window.addEventListener("resize", () => {
    if (pageScoring.classList.contains("active")) resizeCanvas(hasSignature);
  });
});

function updateDivisionBadge() {
  divisionTag.textContent = (currentDivision === "basic") ? "基礎組" : "進階組";
  divisionTag.style.display = "inline-block";
}

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
    const res = await fetch(`${API_URL}?action=login&username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&division=${encodeURIComponent(currentDivision)}&_t=${Date.now()}`);
    const data = await res.json();

    if (data.success) {
      currentUsername = user;
      currentJudge = data.judgeName;
      currentPass = pass;
      isAdminUser = (user.toLowerCase() === "admin") || !!data.isAdmin;
      currentRegionName = data.regionName || "";
      
      assignedTeams = data.teams || [];
      scoresCache = data.existingScores || {};

      assignedTeams.forEach(t => { teamDisplayState[t.teamId] = "visible"; });

      judgeDisplay.textContent = isAdminUser ? `系統管理員：${currentJudge}` : `評審：${currentJudge}`;
      if (currentRegionName) {
        regionTag.textContent = currentRegionName;
        regionTag.style.display = "inline-block";
      }
      updateDivisionBadge();

      loginView.style.display = "none";
      applyUserRoleUI();

      if (isAdminUser) loadRegionsList();
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
  const adminActionsBar = document.getElementById("admin-actions-bar");

  if (isAdminUser) {
    judgeActions.style.display = "none";
    adminActionsBar.style.display = "flex";
  } else {
    judgeActions.style.display = "flex";
    adminActionsBar.style.display = "none";
  }
}

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
        currentRegionName = data.config.activeRegion.name;
        regionTag.textContent = currentRegionName;
      }
    }
  } catch (e) {
    console.error("載入賽事清單失敗", e);
  }
}

async function submitCreateTournament() {
  const regionName = document.getElementById("input-new-region-name").value.trim();
  const rawDate = document.getElementById("input-new-region-date").value.trim();

  if (!regionName || !rawDate) {
    alert("請填寫賽事名稱與日期！");
    return;
  }

  const eventDate = rawDate.replace(/-/g, "");
  const btn = document.getElementById("btn-confirm-add-region");
  btn.disabled = true;
  btn.textContent = "正在建立兩組表單...";

  try {
    const res = await fetch(`${API_URL}?action=createTournament`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ adminUser: "admin", regionName: regionName, eventDate: eventDate })
    });
    const result = await res.json();

    if (result.success) {
      alert(`【建立成功！】\n基礎組表單：${result.basicName}\n進階組表單：${result.advancedName}\n已全數建立至指定雲端資料夾。`);
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

async function submitSwitchRegion() {
  const targetRegion = selectActiveRegion.value;
  if (!targetRegion) return;
  if (!confirm(`確定要將系統賽事鎖定為「${targetRegion}」嗎？`)) return;

  try {
    const res = await fetch(`${API_URL}?action=switchRegion`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ adminUser: "admin", regionName: targetRegion })
    });
    const result = await res.json();
    if (result.success) {
      alert(result.message);
      location.reload();
    } else {
      alert("切換失敗：" + result.message);
    }
  } catch (err) {
    alert("切換賽事錯誤：" + err.message);
  }
}

async function fetchLatestScores(showNotice = false) {
  if (!currentJudge) return;

  const syncBtns = document.querySelectorAll(".btn-sync-cloud");
  if (showNotice) syncBtns.forEach(b => { b.disabled = true; b.textContent = "同步中..."; });

  try {
    const fetchUrl = `${API_URL}?action=getScores&judgeName=${encodeURIComponent(currentJudge)}&username=${encodeURIComponent(currentUsername || "")}&division=${encodeURIComponent(currentDivision)}&_t=${Date.now()}`;
    const res = await fetch(fetchUrl);
    const data = await res.json();

    if (data.success) {
      assignedTeams = data.teams || assignedTeams;
      scoresCache = data.existingScores || data.scores || {};
      renderTeamList();
      if (showNotice) alert("【同步成功】已重新取得最新評分數據！");
    } else {
      if (showNotice) alert("同步失敗：" + (data.message || "伺服器未回傳成績"));
    }
  } catch (e) {
    console.error("同步失敗", e);
    if (showNotice) alert("連線同步失敗，請檢查網路連線！");
  } finally {
    if (showNotice) syncBtns.forEach(b => { b.disabled = false; b.textContent = "🔄 同步雲端成績"; });
  }
}

function formatScoreVal(val) {
  if (val === undefined || val === null || val === "" || val === "-") return "";
  return String(val);
}

function getDisplayScore(valStr, isHidden) {
  if (!valStr && valStr !== "0") return "";
  if (isAdminUser) return valStr;
  return isHidden ? "***" : valStr;
}

// 渲染總表表頭與隊伍列表 (依據 PDF 指定欄位動態產生)
function renderTeamList() {
  const isAdv = (currentDivision === "advanced");

  // 渲染表頭
  if (isAdv) {
    summaryThead.innerHTML = `
      <tr>
        <th>組別</th>
        <th>隊伍<br>編號</th>
        <th>學校名稱</th>
        <th>隊伍名稱</th>
        <th>關卡<br>數量</th>
        <th>流暢<br>加權</th>
        <th>科學<br>概念</th>
        <th>綠能<br>一</th>
        <th>綠能<br>二</th>
        <th>綠能<br>三</th>
        <th>創意<br>關卡</th>
        <th>整體<br>機構設計</th>
        <th>總分</th>
        ${isAdminUser ? "<th>名次</th>" : '<th class="th-hide-score">隱藏</th>'}
        <th id="th-last-action">${isAdminUser ? "評分評審" : "操作"}</th>
      </tr>
    `;
  } else {
    summaryThead.innerHTML = `
      <tr>
        <th>組別</th>
        <th>隊伍<br>編號</th>
        <th>學校名稱</th>
        <th>隊伍名稱</th>
        <th>關卡<br>(16)</th>
        <th>流暢度<br>(20)</th>
        <th>內容<br>(10)</th>
        <th>規範<br>(21)</th>
        <th>任務<br>(33)</th>
        <th>總分<br>(100)</th>
        ${isAdminUser ? "<th>名次</th>" : '<th class="th-hide-score">隱藏</th>'}
        <th id="th-last-action">${isAdminUser ? "評審" : "操作"}</th>
      </tr>
    `;
  }

  teamListBody.innerHTML = "";

  if (assignedTeams.length === 0) {
    teamListBody.innerHTML = `<tr><td colspan="15" style="color:#d32f2f; padding: 24px;">查無【${isAdv ? "進階組" : "基礎組"}】可評分的隊伍，請確認該組別試算表！</td></tr>`;
    return;
  }

  let filteredTeams = assignedTeams;
  if (isAdminUser) {
    filteredTeams = assignedTeams.filter(t => String(t.teamId).toUpperCase().startsWith(currentGroupFilter));
  }

  if (filteredTeams.length === 0) {
    teamListBody.innerHTML = `<tr><td colspan="15" style="color:#666; padding: 24px;">查無此年段之隊伍！</td></tr>`;
    return;
  }

  // 排序
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
      if (aScored === bScored) return a.teamId.localeCompare(b.teamId, undefined, { numeric: true });
      return aScored ? 1 : -1;
    }
  });

  // 計算名次 (依總分降冪分配名次，同分同名次)
  const rankMap = {};
  const scoredTeamsForRank = [...sortedTeams]
    .map(t => ({ teamId: t.teamId, total: (scoresCache[t.teamId] && scoresCache[t.teamId].totalScore !== undefined && scoresCache[t.teamId].totalScore !== "") ? parseFloat(scoresCache[t.teamId].totalScore) : null }))
    .filter(t => t.total !== null)
    .sort((a, b) => b.total - a.total);

  scoredTeamsForRank.forEach((item, idx) => {
    if (idx > 0 && item.total === scoredTeamsForRank[idx - 1].total) {
      rankMap[item.teamId] = rankMap[scoredTeamsForRank[idx - 1].teamId];
    } else {
      rankMap[item.teamId] = idx + 1;
    }
  });

  sortedTeams.forEach(team => {
    const tr = document.createElement("tr");
    tr.id = `team-row-${team.teamId}`;

    const score = scoresCache[team.teamId] || {};
    const isScored = (score.totalScore !== undefined && score.totalScore !== null && score.totalScore !== "");
    const isHidden = (teamDisplayState[team.teamId] === "hidden");

    let midColsHtml = "";

    if (isAdv) {
      const stageVal = formatScoreVal(score.stageCountScore);
      const fluVal = formatScoreVal(score.fluencyWeighted);
      const sciVal = formatScoreVal(score.scienceScore);
      const g1Val = formatScoreVal(score.green1Score);
      const g2Val = formatScoreVal(score.green2Score);
      const g3Val = formatScoreVal(score.green3Score);
      const crVal = formatScoreVal(score.creativeScore);
      const dsVal = formatScoreVal(score.designScore);
      const totVal = formatScoreVal(score.totalScore);

      midColsHtml = `
        <td class="score-col" data-val="${stageVal}">${getDisplayScore(stageVal, isHidden)}</td>
        <td class="score-col" data-val="${fluVal}">${getDisplayScore(fluVal, isHidden)}</td>
        <td class="score-col" data-val="${sciVal}">${getDisplayScore(sciVal, isHidden)}</td>
        <td class="score-col" data-val="${g1Val}">${getDisplayScore(g1Val, isHidden)}</td>
        <td class="score-col" data-val="${g2Val}">${getDisplayScore(g2Val, isHidden)}</td>
        <td class="score-col" data-val="${g3Val}">${getDisplayScore(g3Val, isHidden)}</td>
        <td class="score-col" data-val="${crVal}">${getDisplayScore(crVal, isHidden)}</td>
        <td class="score-col" data-val="${dsVal}">${getDisplayScore(dsVal, isHidden)}</td>
        <td class="score-col" data-val="${totVal}" style="font-weight:bold; color:var(--primary);">${getDisplayScore(totVal, isHidden)}</td>
      `;
    } else {
      let stdRaw = score.stdScore;
      if (stdRaw === undefined || stdRaw === null || stdRaw === "") {
        stdRaw = score.missionStdScore !== undefined ? score.missionStdScore : score.ruleScore;
      }
      const stageVal = formatScoreVal(score.stageScore);
      const fluVal = formatScoreVal(score.fluencyScore);
      const taskVal = formatScoreVal(score.taskScore);
      const stdVal = formatScoreVal(stdRaw);
      const misVal = formatScoreVal(score.missionScore);
      const totVal = formatScoreVal(score.totalScore);

      midColsHtml = `
        <td class="score-col" data-val="${stageVal}">${getDisplayScore(stageVal, isHidden)}</td>
        <td class="score-col" data-val="${fluVal}">${getDisplayScore(fluVal, isHidden)}</td>
        <td class="score-col" data-val="${taskVal}">${getDisplayScore(taskVal, isHidden)}</td>
        <td class="score-col" data-val="${stdVal}">${getDisplayScore(stdVal, isHidden)}</td>
        <td class="score-col" data-val="${misVal}">${getDisplayScore(misVal, isHidden)}</td>
        <td class="score-col" data-val="${totVal}" style="font-weight:bold; color:var(--primary);">${getDisplayScore(totVal, isHidden)}</td>
      `;
    }

    const rankOrHideCol = isAdminUser 
      ? `<td style="font-weight:bold; color:#d32f2f;">${rankMap[team.teamId] || "-"}</td>`
      : `
        <td>
          <button class="btn ${isHidden ? "btn-primary" : "btn-secondary"}" 
                  style="padding: 4px 6px; font-size:11px;" 
                  id="btn-toggle-${team.teamId}" 
                  onclick="toggleScoreState('${team.teamId}')">
            ${isHidden ? "顯示" : "隱藏"}
          </button>
        </td>
      `;

    let lastCol = "";
    if (isAdminUser) {
      const judgeName = score.judgeName || "未評分";
      const isMulti = score.judgeCount && score.judgeCount > 1;
      lastCol = `<td style="font-size:12px; color:${isMulti ? '#1565c0' : '#444'}; font-weight:${isMulti ? 'bold' : 'normal'};">${judgeName}</td>`;
    } else {
      lastCol = `
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
      ${midColsHtml}
      ${rankOrHideCol}
      ${lastCol}
    `;

    teamListBody.appendChild(tr);
  });
}

function exportSummaryToPdf() {
  let groupName = "國小組";
  if (currentGroupFilter === "GAJ") groupName = "國中組";
  else if (currentGroupFilter === "GAH") groupName = "高中組";

  const divName = (currentDivision === "basic") ? "基礎組" : "進階組";
  const tourName = currentRegionName || (regionTag.textContent || "賽事");
  const fullTitle = `${tourName}${divName}${groupName}`;

  const banner = document.getElementById("print-header-banner");
  banner.textContent = fullTitle;

  const originalDocTitle = document.title;
  document.title = fullTitle;

  const rows = document.querySelectorAll("#team-list-body tr");
  const count = rows.length;
  const table = document.getElementById("summary-table");

  let scale = 1.0;
  if (count > 15 && count <= 25) scale = 0.85;
  else if (count > 25 && count <= 35) scale = 0.72;
  else if (count > 35) scale = 0.60;

  table.style.zoom = scale;
  window.print();
  table.style.zoom = "";
  document.title = originalDocTitle;
}

window.toggleScoreState = function(teamId) {
  if (isAdminUser) return;
  teamDisplayState[teamId] = (teamDisplayState[teamId] === "hidden") ? "visible" : "hidden";
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
  const divName = (currentDivision === "basic") ? "基礎組" : "進階組";
  document.getElementById("current-team-info").textContent = 
    `評分對象：【${divName}】[${currentTeam.teamId}] ${currentTeam.school} - ${currentTeam.teamName}`;

  const isBasic = (currentDivision === "basic");
  document.getElementById("division-basic-section").style.display = isBasic ? "block" : "none";
  document.getElementById("division-advanced-section").style.display = isBasic ? "none" : "block";

  const existing = scoresCache[teamId];
  if (existing && existing.totalScore !== undefined && existing.totalScore !== "") {
    loadExistingScoresToForm(existing);
  } else {
    resetFormToDefaults();
  }

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
  document.querySelectorAll(".selectable").forEach(c => c.classList.remove("active"));
  document.querySelectorAll(".toggleable").forEach(c => c.classList.remove("active"));

  if (currentDivision === "basic") {
    const stEl = document.querySelector('#row-stage-basic .selectable[data-val="8"]');
    if (stEl) stEl.classList.add("active");

    const flEl = document.querySelector('#row-fluency-basic .selectable[data-val="0"]');
    if (flEl) flEl.classList.add("active");

    ["row-task-1", "row-task-2"].forEach(rowId => {
      const row = document.getElementById(rowId);
      if (row) {
        row.querySelector('.selectable[data-val="3"]').classList.add("active");
        row.querySelector('.selectable[data-val="2"]').classList.add("active");
      }
    });

    document.querySelectorAll('#row-mission-std-basic .selectable[data-val="2.3333"], #row-mission-std-basic .selectable[data-val="2.3334"]').forEach(c => c.classList.add("active"));

  } else {
    const advSt = document.querySelector('#row-adv-stage .selectable[data-val="8"]');
    if (advSt) advSt.classList.add("active");

    const advFl = document.querySelector('#row-adv-fluency .selectable[data-val="0"]');
    if (advFl) advFl.classList.add("active");

    ["row-adv-green1", "row-adv-green2", "row-adv-green3"].forEach(rowId => {
      const row = document.getElementById(rowId);
      if (row) {
        const stdCell = row.querySelector('.selectable[data-val="3"]');
        const runCell = row.querySelector('.selectable[data-val="5"]');
        if (stdCell) stdCell.classList.add("active");
        if (runCell) runCell.classList.add("active");
      }
    });

    const advSci = document.querySelector('#row-adv-science .selectable[data-val="16"]');
    if (advSci) advSci.classList.add("active");

    ["row-adv-c1", "row-adv-c2", "row-adv-c3", "row-adv-c4"].forEach(rowId => {
      const row = document.getElementById(rowId);
      if (row) row.querySelector('.selectable[data-val="4"]').classList.add("active");
    });

    const d1 = document.querySelector('#row-adv-d1 .selectable[data-val="6"]');
    if (d1) d1.classList.add("active");
    const d2 = document.querySelector('#row-adv-d2 .selectable[data-val="2"]');
    if (d2) d2.classList.add("active");
  }
}

// 支援重評時回填前次評分
function loadExistingScoresToForm(score) {
  resetFormToDefaults();

  function selectVal(rowId, val) {
    if (val === undefined || val === null || val === "") return;
    const row = document.getElementById(rowId);
    if (!row) return;
    const target = row.querySelector(`.selectable[data-val="${val}"]`);
    if (target) {
      row.querySelectorAll(".selectable").forEach(c => c.classList.remove("active"));
      target.classList.add("active");
    }
  }

  if (currentDivision === "advanced") {
    if (score.stageCountScore) {
      const count = Number(score.stageCountScore) / 2;
      selectVal("row-adv-stage", count);
    }
    if (score.scienceScore) selectVal("row-adv-science", score.scienceScore);
  }
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
  if (currentDivision === "basic") {
    calculateBasicScores();
  } else {
    calculateAdvancedScores();
  }
}

function calculateBasicScores() {
  const stageEl = document.querySelector("#row-stage-basic .selectable.active");
  const stageCount = stageEl ? parseFloat(stageEl.dataset.val) : 8;
  const stageScore = stageCount * 2;
  document.getElementById("score-stage-basic").textContent = stageScore;

  const fluencyEl = document.querySelector("#row-fluency-basic .selectable.active");
  let fluencyRaw = 20;
  let fluencyWeighted = 20;
  if (fluencyEl) {
    const drops = parseFloat(fluencyEl.dataset.val);
    fluencyRaw = Math.max(0, 20 - drops * 2);
    fluencyWeighted = Number(((fluencyRaw * stageCount) / 8).toFixed(2));
  }
  document.getElementById("score-fluency-raw-basic").textContent = fluencyRaw;
  document.getElementById("score-fluency-weighted-basic").textContent = fluencyWeighted;

  let taskTotal = 0;
  ["row-task-1", "row-task-2"].forEach(rowId => {
    const row = document.getElementById(rowId);
    let sub = 0;
    row.querySelectorAll(".selectable.active").forEach(c => sub += parseFloat(c.dataset.val));
    row.querySelector(".task-row-total").textContent = sub;
    taskTotal += sub;
  });
  document.getElementById("score-task-total").textContent = taskTotal;

  let stdSum = 0;
  document.querySelectorAll("#row-mission-std-basic .selectable.active").forEach(c => stdSum += parseFloat(c.dataset.val));
  const stdTotal = Math.round(stdSum);
  document.getElementById("score-mission-std-sum-basic").textContent = stdTotal;

  let zoneSum = 0;
  ["row-zone-basic-1", "row-zone-basic-2", "row-zone-basic-3"].forEach(rowId => {
    const row = document.getElementById(rowId);
    let rowScore = 0;
    row.querySelectorAll(".selectable.active").forEach(c => rowScore += parseFloat(c.dataset.val));
    row.querySelector(".zone-row-total-basic").textContent = rowScore;
    zoneSum += rowScore;
  });
  const missionScoreTotal = Number(zoneSum.toFixed(2));
  document.getElementById("score-mission-total-basic").textContent = missionScoreTotal;

  const total = Number((stageScore + fluencyWeighted + taskTotal + stdTotal + missionScoreTotal).toFixed(2));
  document.getElementById("final-total-score").textContent = total;
}

// 進階組計分邏輯 (對齊 2027GM 評分標準)
function calculateAdvancedScores() {
  // 1. 關卡數量 (16分)
  const stageEl = document.querySelector("#row-adv-stage .selectable.active");
  const stageCount = stageEl ? parseFloat(stageEl.dataset.val) : 8;
  const stageScore = stageCount * 2;
  document.getElementById("score-adv-stage").textContent = stageScore;

  // 2. 流暢度加權 (20分)
  const flEl = document.querySelector("#row-adv-fluency .selectable.active");
  let flDrops = flEl ? parseFloat(flEl.dataset.val) : 0;
  let flRaw = Math.max(0, 20 - flDrops * 2);
  let fluencyWeighted = Number(((flRaw * stageCount) / 8).toFixed(2));
  document.getElementById("score-adv-fluency-raw").textContent = flRaw;
  document.getElementById("score-adv-fluency-weighted").textContent = fluencyWeighted;

  // 3. 綠能 1, 2, 3 (24分)
  function getRowScore(rowId) {
    const r = document.getElementById(rowId);
    let s = 0;
    r.querySelectorAll(".selectable.active").forEach(c => s += parseFloat(c.dataset.val));
    return s;
  }
  const g1 = getRowScore("row-adv-green1");
  const g2 = getRowScore("row-adv-green2");
  const g3 = getRowScore("row-adv-green3");
  document.getElementById("score-adv-green1").textContent = g1;
  document.getElementById("score-adv-green2").textContent = g2;
  document.getElementById("score-adv-green3").textContent = g3;
  const greenTotal = g1 + g2 + g3;
  document.getElementById("score-adv-green-total").textContent = greenTotal;

  // 4. 科學概念 (16分)
  const sciEl = document.querySelector("#row-adv-science .selectable.active");
  const sciScore = sciEl ? parseFloat(sciEl.dataset.val) : 16;
  document.getElementById("score-adv-science").textContent = sciScore;

  // 5. 創意關卡 (16分)
  function getSingleVal(rowId) {
    const el = document.querySelector(`#${rowId} .selectable.active`);
    return el ? parseFloat(el.dataset.val) : 0;
  }
  const c1 = getSingleVal("row-adv-c1");
  const c2 = getSingleVal("row-adv-c2");
  const c3 = getSingleVal("row-adv-c3");
  const c4 = getSingleVal("row-adv-c4");
  document.getElementById("score-adv-c1").textContent = c1;
  document.getElementById("score-adv-c2").textContent = c2;
  document.getElementById("score-adv-c3").textContent = c3;
  document.getElementById("score-adv-c4").textContent = c4;
  const creativeTotal = Number((c1 + c2 + c3 + c4).toFixed(2));
  document.getElementById("score-adv-creative-total").textContent = creativeTotal;

  // 6. 整體機構設計 (8分)
  const d1 = getSingleVal("row-adv-d1");
  const d2 = getSingleVal("row-adv-d2");
  document.getElementById("score-adv-d1").textContent = d1;
  document.getElementById("score-adv-d2").textContent = d2;
  const designTotal = Number((d1 + d2).toFixed(2));
  document.getElementById("score-adv-design-total").textContent = designTotal;

  // 總分 (100分)
  const finalTotal = Number((stageScore + fluencyWeighted + greenTotal + sciScore + creativeTotal + designTotal).toFixed(2));
  document.getElementById("final-total-score").textContent = finalTotal;
}

function resizeCanvas(preserveExisting = false) {
  const container = canvas.parentElement;
  if (!container || container.offsetParent === null) return;

  let tempImg = null;
  if (preserveExisting && hasSignature) tempImg = canvas.toDataURL();

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
    img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
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
  return { x: clientX - rect.left, y: clientY - rect.top };
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

function stopDrawing() { isDrawing = false; }

canvas.addEventListener("touchstart", startDrawing, { passive: false });
canvas.addEventListener("touchmove", draw, { passive: false });
canvas.addEventListener("touchend", stopDrawing);
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

  const now = new Date();
  const timestamp = now.getFullYear() + "/" +
    String(now.getMonth() + 1).padStart(2, "0") + "/" +
    String(now.getDate()).padStart(2, "0") + " " +
    String(now.getHours()).padStart(2, "0") + ":" +
    String(now.getMinutes()).padStart(2, "0") + ":" +
    String(now.getSeconds()).padStart(2, "0");

  const signatureData = canvas.toDataURL("image/png");
  const isAdv = (currentDivision === "advanced");

  let payload = {
    division: currentDivision,
    group: currentTeam.group || "",
    teamId: currentTeam.teamId,
    school: currentTeam.school,
    teamName: currentTeam.teamName,
    judgeName: currentJudge,
    username: currentUsername,
    timestamp: timestamp,
    signature: signatureData
  };

  if (isAdv) {
    payload.stageCountScore = parseFloat(document.getElementById("score-adv-stage").textContent) || 0;
    payload.fluencyWeighted = parseFloat(document.getElementById("score-adv-fluency-weighted").textContent) || 0;
    payload.scienceScore = parseFloat(document.getElementById("score-adv-science").textContent) || 0;
    payload.green1Score = parseFloat(document.getElementById("score-adv-green1").textContent) || 0;
    payload.green2Score = parseFloat(document.getElementById("score-adv-green2").textContent) || 0;
    payload.green3Score = parseFloat(document.getElementById("score-adv-green3").textContent) || 0;
    payload.creativeScore = parseFloat(document.getElementById("score-adv-creative-total").textContent) || 0;
    payload.designScore = parseFloat(document.getElementById("score-adv-design-total").textContent) || 0;
    payload.totalScore = parseFloat(document.getElementById("final-total-score").textContent) || 0;
  } else {
    payload.stageScore = parseFloat(document.getElementById("score-stage-basic").textContent) || 0;
    payload.fluencyScore = parseFloat(document.getElementById("score-fluency-weighted-basic").textContent) || 0;
    payload.taskScore = parseFloat(document.getElementById("score-task-total").textContent) || 0;
    payload.stdScore = parseFloat(document.getElementById("score-mission-std-sum-basic").textContent) || 0;
    payload.missionScore = parseFloat(document.getElementById("score-mission-total-basic").textContent) || 0;
    payload.totalScore = parseFloat(document.getElementById("final-total-score").textContent) || 0;
  }

  try {
    const res = await fetch(`${API_URL}?action=submitScore`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success) {
      alert("成績已成功同步至試算表！");
      scoresCache[currentTeam.teamId] = payload;
      teamDisplayState[currentTeam.teamId] = "visible";

      clearCanvas();
      hasSignature = false;
      canvas.width = 0;
      canvas.height = 0;

      switchPage("summary");
      renderTeamList();
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
