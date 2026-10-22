const API_URL = "https://script.google.com/macros/s/AKfycbzhbWmJzRP0qwuxyKdxETuvooZ6WwAO_fYT8NfpRNlU1uOHFOY0qS0AwojlAluhUlNr/exec";

let currentJudge = null;
let currentPass = null;
let currentUsername = null;
let isAdminUser = false;
let currentJudgeRole = "all"; // "flow" | "green" | "creative" | "structure" | "all"
let currentDivision = "advanced"; // "basic" | "advanced"
let currentSortMode = "scoreDesc";
let currentGroupFilter = "GAE";
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
const roleTag = document.getElementById("role-tag");
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

  // 頂部常駐組別切換按鈕
  document.querySelectorAll(".btn-division-toggle").forEach(btn => {
    btn.addEventListener("click", function() {
      const targetDiv = this.dataset.division;
      if (currentDivision === targetDiv && assignedTeams.length > 0) return;
      currentDivision = targetDiv;
      updateHeaderDivisionButtons();
      if (currentUsername && currentPass) {
        reLoginDivision(targetDiv);
      }
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

function updateHeaderDivisionButtons() {
  document.querySelectorAll(".btn-division-toggle").forEach(b => {
    if (b.dataset.division === currentDivision) {
      b.className = "btn btn-primary btn-division-toggle";
    } else {
      b.className = "btn btn-secondary btn-division-toggle";
    }
  });
}

function updateDivisionBadge() {
  if (divisionTag) {
    divisionTag.textContent = (currentDivision === "basic") ? "基礎組" : "進階組";
    divisionTag.style.display = "inline-block";
  }
}

async function handleLogin() {
  const divSelect = document.getElementById("login-division") ? document.getElementById("login-division").value : currentDivision;
  const user = document.getElementById("login-user").value.trim();
  const pass = document.getElementById("login-pass").value.trim();

  if (!user || !pass) {
    alert("請輸入評審帳號與密碼！");
    return;
  }

  currentDivision = divSelect;
  updateHeaderDivisionButtons();

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
      currentJudgeRole = data.judgeRole || "all";
      currentRegionName = data.regionName || "";
      
      assignedTeams = data.teams || [];
      scoresCache = data.existingScores || {};

      assignedTeams.forEach(t => { teamDisplayState[t.teamId] = "visible"; });

      updateUserDisplayInfo();
      updateDivisionBadge();

      if (loginView) loginView.style.display = "none";
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

async function reLoginDivision(targetDivision) {
  currentDivision = targetDivision;
  updateDivisionBadge();
  try {
    const res = await fetch(`${API_URL}?action=login&username=${encodeURIComponent(currentUsername)}&password=${encodeURIComponent(currentPass)}&division=${encodeURIComponent(currentDivision)}&_t=${Date.now()}`);
    const data = await res.json();
    if (data.success) {
      currentJudgeRole = data.judgeRole || "all";
      assignedTeams = data.teams || [];
      scoresCache = data.existingScores || {};
      assignedTeams.forEach(t => { teamDisplayState[t.teamId] = "visible"; });
      updateUserDisplayInfo();
      renderTeamList();
    }
  } catch (e) {
    console.error("切換組別連線失敗", e);
  }
}

function updateUserDisplayInfo() {
  if (judgeDisplay) {
    judgeDisplay.textContent = isAdminUser ? `系統管理員：${currentJudge}` : `評審：${currentJudge}`;
  }
  
  if (regionTag) {
    if (currentRegionName) {
      regionTag.textContent = currentRegionName;
      regionTag.style.display = "inline-block";
    } else {
      regionTag.style.display = "none";
    }
  }

  if (roleTag) {
    if (currentDivision === "advanced" && !isAdminUser) {
      const roleMap = {
        flow: "關卡與流暢度",
        green: "科學與綠能",
        creative: "創意關卡",
        structure: "整體機構設計",
        all: "全向度"
      };
      roleTag.textContent = roleMap[currentJudgeRole] || "評審";
      roleTag.style.display = "inline-block";
    } else {
      roleTag.style.display = "none";
    }
  }
}

function applyUserRoleUI() {
  const judgeActions = document.getElementById("judge-actions");
  const adminActionsBar = document.getElementById("admin-actions-bar");

  if (isAdminUser) {
    if (judgeActions) judgeActions.style.display = "none";
    if (adminActionsBar) adminActionsBar.style.display = "flex";
  } else {
    if (judgeActions) judgeActions.style.display = "flex";
    if (adminActionsBar) adminActionsBar.style.display = "none";
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
        if (regionTag) {
          regionTag.textContent = currentRegionName;
          regionTag.style.display = "inline-block";
        }
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
      alert(`【建立成功！】\n基礎組表單：${result.basicName}\n進階組表單：${result.advancedName}`);
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

function renderTeamList() {
  const isAdv = (currentDivision === "advanced");

  if (summaryThead) {
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
  }

  if (!teamListBody) return;
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
  const tourName = currentRegionName || (regionTag ? regionTag.textContent : "賽事");
  const fullTitle = `${tourName}${divName}${groupName}`;

  const banner = document.getElementById("print-header-banner");
  if (banner) banner.textContent = fullTitle;

  const originalDocTitle = document.title;
  document.title = fullTitle;

  const rows = document.querySelectorAll("#team-list-body tr");
  const count = rows.length;
  const table = document.getElementById("summary-table");

  let scale = 1.0;
  if (count > 15 && count <= 25) scale = 0.85;
  else if (count > 25 && count <= 35) scale = 0.72;
  else if (count > 35) scale = 0.60;

  if (table) table.style.zoom = scale;
  window.print();
  if (table) table.style.zoom = "";
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
  const infoEl = document.getElementById("current-team-info");
  if (infoEl) {
    infoEl.textContent = `評分對象：【${divName}】[${currentTeam.teamId}] ${currentTeam.school} - ${currentTeam.teamName}`;
  }

  const isBasic = (currentDivision === "basic");
  const basicSec = document.getElementById("division-basic-section");
  const advSec = document.getElementById("division-advanced-section");
  if (basicSec) basicSec.style.display = isBasic ? "block" : "none";
  if (advSec) advSec.style.display = isBasic ? "none" : "block";

  const signWrapper = document.getElementById("sign-wrapper");
  const roleHint = document.getElementById("scoring-role-hint");

  if (isBasic) {
    if (signWrapper) signWrapper.style.display = "block";
    if (roleHint) roleHint.textContent = "請評審與選手完成簽名後送出。";
  } else {
    const r = currentJudgeRole;
    const bFlow = document.getElementById("adv-block-flow");
    const bGreen = document.getElementById("adv-block-green");
    const bCreative = document.getElementById("adv-block-creative");
    const bStructure = document.getElementById("adv-block-structure");

    if (bFlow) bFlow.style.display = (r === "flow" || r === "all" || isAdminUser) ? "block" : "none";
    if (bGreen) bGreen.style.display = (r === "green" || r === "all" || isAdminUser) ? "block" : "none";
    if (bCreative) bCreative.style.display = (r === "creative" || r === "all" || isAdminUser) ? "block" : "none";
    if (bStructure) bStructure.style.display = (r === "structure" || r === "all" || isAdminUser) ? "block" : "none";

    if (r === "creative" || r === "structure") {
      if (signWrapper) signWrapper.style.display = "none";
      if (roleHint) roleHint.textContent = "本項目依規範選手不需簽名，點擊送出即可同步成績。";
    } else {
      if (signWrapper) signWrapper.style.display = "block";
      if (roleHint) roleHint.textContent = "請評審與選手完成簽名確認後送出。";
    }
  }

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

function switchPage(page) {
  const pTitle = document.getElementById("page-title");
  if (page === "summary") {
    pageSummary.classList.add("active");
    pageScoring.classList.remove("active");
    if (pTitle) pTitle.textContent = "總評分表";
    renderTeamList();
  } else {
    pageSummary.classList.remove("active");
    pageScoring.classList.add("active");
    if (pTitle) pTitle.textContent = "隊伍評分表";
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
  const sStage = document.getElementById("score-stage-basic");
  if (sStage) sStage.textContent = stageScore;

  const fluencyEl = document.querySelector("#row-fluency-basic .selectable.active");
  let fluencyRaw = 20;
  let fluencyWeighted = 20;
  if (fluencyEl) {
    const drops = parseFloat(fluencyEl.dataset.val);
    fluencyRaw = Math.max(0, 20 - drops * 2);
    fluencyWeighted = Number(((fluencyRaw * stageCount) / 8).toFixed(2));
  }
  const flRawEl = document.getElementById("score-fluency-raw-basic");
  const flWeightEl = document.getElementById("score-fluency-weighted-basic");
  if (flRawEl) flRawEl.textContent = fluencyRaw;
  if (flWeightEl) flWeightEl.textContent = fluencyWeighted;

  let taskTotal = 0;
  ["row-task-1", "row-task-2"].forEach(rowId => {
    const row = document.getElementById(rowId);
    if (!row) return;
    let sub = 0;
    row.querySelectorAll(".selectable.active").forEach(c => sub += parseFloat(c.dataset.val));
    const rTot = row.querySelector(".task-row-total");
    if (rTot) rTot.textContent = sub;
    taskTotal += sub;
  });
  const tTotEl = document.getElementById("score-task-total");
  if (tTotEl) tTotEl.textContent = taskTotal;

  let stdSum = 0;
  document.querySelectorAll("#row-mission-std-basic .selectable.active").forEach(c => stdSum += parseFloat(c.dataset.val));
  const stdTotal = Math.round(stdSum);
  const stdSumEl = document.getElementById("score-mission-std-sum-basic");
  if (stdSumEl) stdSumEl.textContent = stdTotal;

  let zoneSum = 0;
  ["row-zone-basic-1", "row-zone-basic-2", "row-zone-basic-3"].forEach(rowId => {
    const row = document.getElementById(rowId);
    if (!row) return;
    let rowScore = 0;
    row.querySelectorAll(".selectable.active").forEach(c => rowScore += parseFloat(c.dataset.val));
    const zTot = row.querySelector(".zone-row-total-basic");
    if (zTot) zTot.textContent = rowScore;
    zoneSum += rowScore;
  });
  const missionScoreTotal = Number(zoneSum.toFixed(2));
  const misTotEl = document.getElementById("score-mission-total-basic");
  if (misTotEl) misTotEl.textContent = missionScoreTotal;

  const total = Number((stageScore + fluencyWeighted + taskTotal + stdTotal + missionScoreTotal).toFixed(2));
  const finTotEl = document.getElementById("final-total-score");
  if (finTotEl) finTotEl.textContent = total;
}

function calculateAdvancedScores() {
  const stageEl = document.querySelector("#row-adv-stage .selectable.active");
  const stageCount = stageEl ? parseFloat(stageEl.dataset.val) : 8;
  const stageScore = stageCount * 2;
  const advStEl = document.getElementById("score-adv-stage");
  if (advStEl) advStEl.textContent = stageScore;

  const flEl = document.querySelector("#row-adv-fluency .selectable.active");
  let flDrops = flEl ? parseFloat(flEl.dataset.val) : 0;
  let flRaw = Math.max(0, 20 - flDrops * 2);
  let fluencyWeighted = Number(((flRaw * stageCount) / 8).toFixed(2));
  const advFlRawEl = document.getElementById("score-adv-fluency-raw");
  const advFlWeightEl = document.getElementById("score-adv-fluency-weighted");
  if (advFlRawEl) advFlRawEl.textContent = flRaw;
  if (advFlWeightEl) advFlWeightEl.textContent = fluencyWeighted;

  function getRowScore(rowId) {
    const r = document.getElementById(rowId);
    if (!r) return 0;
    let s = 0;
    r.querySelectorAll(".selectable.active").forEach(c => s += parseFloat(c.dataset.val));
    return s;
  }
  const g1 = getRowScore("row-adv-green1");
  const g2 = getRowScore("row-adv-green2");
  const g3 = getRowScore("row-adv-green3");
  const g1El = document.getElementById("score-adv-green1");
  const g2El = document.getElementById("score-adv-green2");
  const g3El = document.getElementById("score-adv-green3");
  if (g1El) g1El.textContent = g1;
  if (g2El) g2El.textContent = g2;
  if (g3El) g3El.textContent = g3;
  const greenTotal = g1 + g2 + g3;
  const gTotEl = document.getElementById("score-adv-green-total");
  if (gTotEl) gTotEl.textContent = greenTotal;

  const sciEl = document.querySelector("#row-adv-science .selectable.active");
  const sciScore = sciEl ? parseFloat(sciEl.dataset.val) : 16;
  const advSciEl = document.getElementById("score-adv-science");
  if (advSciEl) advSciEl.textContent = sciScore;

  function getSingleVal(rowId) {
    const el = document.querySelector(`#${rowId} .selectable.active`);
    return el ? parseFloat(el.dataset.val) : 0;
  }
  const c1 = getSingleVal("row-adv-c1");
  const c2 = getSingleVal("row-adv-c2");
  const c3 = getSingleVal("row-adv-c3");
  const c4 = getSingleVal("row-adv-c4");
  const c1El = document.getElementById("score-adv-c1");
  const c2El = document.getElementById("score-adv-c2");
  const c3El = document.getElementById("score-adv-c3");
  const c4El = document.getElementById("score-adv-c4");
  if (c1El) c1El.textContent = c1;
  if (c2El) c2El.textContent = c2;
  if (c3El) c3El.textContent = c3;
  if (c4El) c4El.textContent = c4;
  const creativeTotal = Number((c1 + c2 + c3 + c4).toFixed(2));
  const cTotEl = document.getElementById("score-adv-creative-total");
  if (cTotEl) cTotEl.textContent = creativeTotal;

  const d1 = getSingleVal("row-adv-d1");
  const d2 = getSingleVal("row-adv-d2");
  const d1El = document.getElementById("score-adv-d1");
  const d2El = document.getElementById("score-adv-d2");
  if (d1El) d1El.textContent = d1;
  if (d2El) d2El.textContent = d2;
  const designTotal = Number((d1 + d2).toFixed(2));
  const dTotEl = document.getElementById("score-adv-design-total");
  if (dTotEl) dTotEl.textContent = designTotal;

  let subtotal = 0;
  const r = currentJudgeRole;
  if (r === "flow") subtotal = stageScore + fluencyWeighted;
  else if (r === "green") subtotal = greenTotal + sciScore;
  else if (r === "creative") subtotal = creativeTotal;
  else if (r === "structure") subtotal = designTotal;
  else subtotal = stageScore + fluencyWeighted + greenTotal + sciScore + creativeTotal + designTotal;

  const finTotEl = document.getElementById("final-total-score");
  if (finTotEl) finTotEl.textContent = Number(subtotal.toFixed(2));
}

function resizeCanvas(preserveExisting = false) {
  if (!canvas) return;
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

if (canvas) {
  canvas.addEventListener("touchstart", startDrawing, { passive: false });
  canvas.addEventListener("touchmove", draw, { passive: false });
  canvas.addEventListener("touchend", stopDrawing);
  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", stopDrawing);
  canvas.addEventListener("mouseleave", stopDrawing);
}

function clearCanvas() {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  hasSignature = false;
}

async function submitScore() {
  const isAdv = (currentDivision === "advanced");
  const r = currentJudgeRole;
  const needSign = !isAdv || (r === "flow" || r === "green" || r === "all" || isAdminUser);

  if (needSign && !hasSignature) {
    alert("請完成簽名確認後再行送出！");
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

  const signatureData = hasSignature ? canvas.toDataURL("image/png") : "";

  let payload = {
    division: currentDivision,
    group: currentTeam.group || "",
    teamId: currentTeam.teamId,
    school: currentTeam.school,
    teamName: currentTeam.teamName,
    judgeName: currentJudge,
    username: currentUsername,
    judgeRole: currentJudgeRole,
    timestamp: timestamp,
    signature: signatureData
  };

  if (isAdv) {
    if (r === "flow" || r === "all" || isAdminUser) {
      const st = document.getElementById("score-adv-stage");
      const fl = document.getElementById("score-adv-fluency-weighted");
      payload.stageCountScore = st ? parseFloat(st.textContent) || 0 : 0;
      payload.fluencyWeighted = fl ? parseFloat(fl.textContent) || 0 : 0;
    }
    if (r === "green" || r === "all" || isAdminUser) {
      const g1 = document.getElementById("score-adv-green1");
      const g2 = document.getElementById("score-adv-green2");
      const g3 = document.getElementById("score-adv-green3");
      const sc = document.getElementById("score-adv-science");
      payload.green1Score = g1 ? parseFloat(g1.textContent) || 0 : 0;
      payload.green2Score = g2 ? parseFloat(g2.textContent) || 0 : 0;
      payload.green3Score = g3 ? parseFloat(g3.textContent) || 0 : 0;
      payload.scienceScore = sc ? parseFloat(sc.textContent) || 0 : 0;
    }
    if (r === "creative" || r === "all" || isAdminUser) {
      const cr = document.getElementById("score-adv-creative-total");
      payload.creativeScore = cr ? parseFloat(cr.textContent) || 0 : 0;
    }
    if (r === "structure" || r === "all" || isAdminUser) {
      const ds = document.getElementById("score-adv-design-total");
      payload.designScore = ds ? parseFloat(ds.textContent) || 0 : 0;
    }
    const fin = document.getElementById("final-total-score");
    payload.sectionSubtotal = fin ? parseFloat(fin.textContent) || 0 : 0;
  } else {
    const stB = document.getElementById("score-stage-basic");
    const flB = document.getElementById("score-fluency-weighted-basic");
    const tkB = document.getElementById("score-task-total");
    const stdB = document.getElementById("score-mission-std-sum-basic");
    const misB = document.getElementById("score-mission-total-basic");
    const finB = document.getElementById("final-total-score");

    payload.stageScore = stB ? parseFloat(stB.textContent) || 0 : 0;
    payload.fluencyScore = flB ? parseFloat(flB.textContent) || 0 : 0;
    payload.taskScore = tkB ? parseFloat(tkB.textContent) || 0 : 0;
    payload.stdScore = stdB ? parseFloat(stdB.textContent) || 0 : 0;
    payload.missionScore = misB ? parseFloat(misB.textContent) || 0 : 0;
    payload.totalScore = finB ? parseFloat(finB.textContent) || 0 : 0;
  }

  try {
    const res = await fetch(`${API_URL}?action=submitScore`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success) {
      alert("成績已成功同步儲存！");
      clearCanvas();
      hasSignature = false;
      switchPage("summary");
      await fetchLatestScores(false);
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
