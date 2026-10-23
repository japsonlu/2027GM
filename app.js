const API_URL = "https://script.google.com/macros/s/AKfycbzhbWmJzRP0qwuxyKdxETuvooZ6WwAO_fYT8NfpRNlU1uOHFOY0qS0AwojlAluhUlNr/exec";

let currentJudge = null;
let currentPass = null;
let currentUsername = null;
let isAdminUser = false;
let currentAssignedSheets = []; // 預設為空，由試算表指派設定決定
let currentDivision = "basic";
let currentSheetId = "";
let currentTournamentName = "";
let currentSortMode = "scoreDesc";
let currentGroupFilter = "E"; // E: 國小, J: 國中, H: 高中

let assignedTeams = [];
let scoresCache = {}; 
let currentTeam = null;

let allTournamentsList = [];
let cachedAdminJudges = [];
let cachedAdminAllTeams = [];

const teamDisplayState = {};

const loginView = document.getElementById("login-view");
const pageAdminTournaments = document.getElementById("page-admin-tournaments");
const pageSummary = document.getElementById("page-summary");
const pageScoring = document.getElementById("page-scoring");

const judgeDisplay = document.getElementById("judge-display");
const regionTag = document.getElementById("region-tag");
const divisionTag = document.getElementById("division-tag");
const roleTag = document.getElementById("role-tag");
const teamListBody = document.getElementById("team-list-body");
const summaryThead = document.getElementById("summary-thead");

const modalAddRegion = document.getElementById("modal-add-region");
const modalAssignJudge = document.getElementById("modal-assign-judge");
const selectAssignJudge = document.getElementById("select-assign-judge");
const assignTeamsContainer = document.getElementById("assign-teams-container");

const canvas = document.getElementById("sign-pad");
const ctx = canvas ? canvas.getContext("2d") : null;
let isDrawing = false;
let hasSignature = false;
let syncTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  setupSelectionHandlers();
  loadInitialActiveTournament();

  safeBindClick("btn-login", handleLogin);
  safeBindClick("btn-logout", () => location.reload());
  safeBindClick("btn-back", () => switchPage("summary"));
  safeBindClick("btn-back-to-tournaments", () => {
    switchPage("adminTournaments");
    loadAdminTournamentsLobby();
  });

  safeBindClick("btn-clear-sign", clearCanvas);
  safeBindClick("btn-submit", submitScore);

  safeBindClick("btn-hide-all", hideAllScores);
  safeBindClick("btn-show-all", showAllScores);

  // 年段篩選按鈕 (支援 GAE/GBE, GAJ/GBJ, GAH/GBH)
  document.querySelectorAll(".btn-filter-group").forEach(btn => {
    btn.addEventListener("click", function() {
      currentGroupFilter = this.dataset.filter; // "E" 或 "J" 或 "H"
      document.querySelectorAll(".btn-filter-group").forEach(b => {
        b.className = "btn btn-secondary btn-filter-group";
      });
      this.className = "btn btn-primary btn-filter-group";
      renderTeamList();
    });
  });

  // 排序
  safeBindClick("btn-sort-teamid", () => {
    currentSortMode = "teamId";
    renderTeamList();
  });
  safeBindClick("btn-sort-score", () => {
    currentSortMode = "scoreDesc";
    renderTeamList();
  });

  // 匯出 PDF
  safeBindClick("btn-export-pdf", exportSummaryToPdf);

  // 同步成績
  document.querySelectorAll(".btn-sync-cloud").forEach(btn => {
    btn.addEventListener("click", () => fetchLatestScores(true));
  });

  // 新增賽事
  safeBindClick("btn-open-add-region-lobby", () => {
    if (modalAddRegion) modalAddRegion.style.display = "flex";
  });
  safeBindClick("btn-cancel-add-region", () => {
    if (modalAddRegion) modalAddRegion.style.display = "none";
  });
  safeBindClick("btn-confirm-add-region", submitCreateTournament);

  // 評審指派視窗
  safeBindClick("btn-open-assign-modal", openAssignModal);
  safeBindClick("btn-cancel-assign", () => {
    if (modalAssignJudge) modalAssignJudge.style.display = "none";
  });
  safeBindClick("btn-save-assign", submitSaveJudgeAssignment);
  if (selectAssignJudge) selectAssignJudge.addEventListener("change", onAssignJudgeSelectChange);

  // 隊伍批次勾選（自動依據基礎組 GA 或進階組 GB 對應）
  safeBindClick("btn-team-select-all", () => setAllTeamCheckboxes(true));
  safeBindClick("btn-team-clear", () => setAllTeamCheckboxes(false));
  safeBindClick("btn-team-select-gae", () => filterTeamCheckboxesByLevel("E"));
  safeBindClick("btn-team-select-gaj", () => filterTeamCheckboxesByLevel("J"));
  safeBindClick("btn-team-select-gah", () => filterTeamCheckboxesByLevel("H"));

  window.addEventListener("resize", () => {
    if (pageScoring && pageScoring.classList.contains("active")) resizeCanvas(hasSignature);
  });
});

function safeBindClick(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", handler);
}

async function loadInitialActiveTournament() {
  const el = document.getElementById("login-active-tour-name");
  try {
    const res = await fetch(`${API_URL}?action=getTournaments&_t=${Date.now()}`);
    const data = await res.json();
    if (data.success && data.config) {
      allTournamentsList = data.config.tournaments || [];
      const active = data.config.activeTournament;
      if (active && el) el.textContent = active.name;
    }
  } catch (e) {
    if (el) el.textContent = "連線中...";
  }
}

async function handleLogin() {
  const user = document.getElementById("login-user") ? document.getElementById("login-user").value.trim() : "";
  const pass = document.getElementById("login-pass") ? document.getElementById("login-pass").value.trim() : "";

  if (!user || !pass) {
    alert("請輸入評審帳號與密碼！");
    return;
  }

  const btn = document.getElementById("btn-login");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "登入中...";
  }

  try {
    const res = await fetch(`${API_URL}?action=login&username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&_t=${Date.now()}`);
    const data = await res.json();

    if (data.success) {
      currentUsername = user;
      currentJudge = data.judgeName;
      currentPass = pass;
      isAdminUser = (user.toLowerCase() === "admin") || !!data.isAdmin;
      
      const curTour = data.currentTournament;
      currentSheetId = curTour ? curTour.sheetId : "";
      currentTournamentName = curTour ? curTour.name : "";
      currentDivision = curTour ? curTour.division : "basic";

      currentAssignedSheets = data.assignedSheets || [];
      assignedTeams = data.teams || [];
      scoresCache = data.existingScores || {};

      assignedTeams.forEach(t => { teamDisplayState[t.teamId] = "visible"; });

      if (loginView) loginView.style.display = "none";
      updateUserDisplayInfo();

      const btnBackLobby = document.getElementById("btn-back-to-tournaments");
      if (isAdminUser) {
        if (btnBackLobby) btnBackLobby.style.display = "inline-block";
        switchPage("adminTournaments");
        loadAdminTournamentsLobby();
      } else {
        if (btnBackLobby) btnBackLobby.style.display = "none";
        applyUserRoleUI();
        switchPage("summary");
        renderTeamList();
      }

      if (syncTimer) clearInterval(syncTimer);
      syncTimer = setInterval(() => {
        if (pageSummary && pageSummary.classList.contains("active") && currentJudge) {
          fetchLatestScores(false);
        }
      }, 60000);

    } else {
      alert("登入失敗：" + (data.message || "帳號密碼不正確"));
    }
  } catch (err) {
    alert("連線後端錯誤，請確認網路或 API 部署：" + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "登入系統";
    }
  }
}

async function loadAdminTournamentsLobby() {
  const container = document.getElementById("tournaments-cards-container");
  if (!container) return;
  container.innerHTML = "<div style='color:#666;'>載入所有賽事中...</div>";

  try {
    const res = await fetch(`${API_URL}?action=getTournaments&_t=${Date.now()}`);
    const data = await res.json();

    if (data.success && data.config) {
      allTournamentsList = data.config.tournaments || [];
      const activeTour = data.config.activeTournament;
      container.innerHTML = "";

      if (allTournamentsList.length === 0) {
        container.innerHTML = "<div style='color:#999;'>尚無任何賽事，請點擊上方按鈕新增！</div>";
        return;
      }

      allTournamentsList.forEach(t => {
        const isLocked = activeTour && (activeTour.sheetId === t.sheetId);
        const card = document.createElement("div");
        card.className = `tournament-card ${isLocked ? "active-tour" : ""}`;

        const divBadge = (t.division === "basic")
          ? `<span style="background:#e8f5e9; color:#2e7d32; padding:3px 8px; border-radius:4px; font-weight:bold; font-size:12px;">🟢 基礎組</span>`
          : `<span style="background:#e3f2fd; color:#1565c0; padding:3px 8px; border-radius:4px; font-weight:bold; font-size:12px;">🔵 進階組</span>`;

        card.innerHTML = `
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              ${divBadge}
              ${isLocked ? '<span style="color:#2e7d32; font-weight:bold; font-size:12px;">🔒 現場鎖定中</span>' : ''}
            </div>
            <h3 style="margin:0 0 10px 0; font-size:17px; color:#222;">${t.name}</h3>
          </div>
          <div style="display:flex; gap:8px; margin-top:14px;">
            <button class="btn btn-secondary" style="flex:1; padding:6px 8px; font-size:12px;" onclick="adminLockTournament('${t.sheetId}')">
              ${isLocked ? "重新鎖定" : "🔒 鎖定此場"}
            </button>
            <button class="btn btn-primary" style="flex:1; padding:6px 8px; font-size:12px;" onclick="adminEnterTournament('${t.sheetId}', '${t.name}', '${t.division}')">
              📊 查看成績
            </button>
          </div>
        `;
        container.appendChild(card);
      });
    }
  } catch (e) {
    container.innerHTML = "<div style='color:#d32f2f;'>載入賽事失敗，請檢查網路連線！</div>";
  }
}

async function adminLockTournament(sheetId) {
  if (!confirm("確定要將現場所有評審端鎖定到這個場次嗎？")) return;
  try {
    const res = await fetch(`${API_URL}?action=lockTournament`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ adminUser: "admin", sheetId: sheetId })
    });
    const result = await res.json();
    if (result.success) {
      alert(result.message);
      loadAdminTournamentsLobby();
    } else {
      alert("鎖定失敗：" + result.message);
    }
  } catch (e) {
    alert("鎖定失敗：" + e.message);
  }
}

async function adminEnterTournament(sheetId, name, division) {
  currentSheetId = sheetId;
  currentTournamentName = name;
  currentDivision = division;

  updateUserDisplayInfo();
  applyUserRoleUI();

  const titleEl = document.getElementById("admin-current-view-title");
  if (titleEl) titleEl.textContent = `【${currentTournamentName}】成績總表`;

  switchPage("summary");
  await fetchLatestScores(true);
}

function updateUserDisplayInfo() {
  if (judgeDisplay) {
    judgeDisplay.textContent = isAdminUser ? `系統管理員：${currentJudge}` : `評審：${currentJudge}`;
  }
  
  if (regionTag) {
    if (currentTournamentName) {
      regionTag.textContent = currentTournamentName;
      regionTag.style.display = "inline-block";
    } else {
      regionTag.style.display = "none";
    }
  }

  if (divisionTag) {
    divisionTag.textContent = (currentDivision === "basic") ? "基礎組" : "進階組";
    divisionTag.style.display = "inline-block";
  }

  if (roleTag) {
    if (currentDivision === "advanced" && !isAdminUser) {
      const sheetLabels = currentAssignedSheets.map(s => {
        if (s === "sheet1") return "表1";
        if (s === "sheet2") return "表2";
        if (s === "sheet3") return "表3";
        if (s === "sheet4") return "表4";
        return s;
      });
      roleTag.textContent = sheetLabels.length > 0 ? `負責：${sheetLabels.join("+")}` : "未指派向度";
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

async function submitCreateTournament() {
  const inputName = document.getElementById("input-new-region-name");
  const inputDate = document.getElementById("input-new-region-date");
  const regionName = inputName ? inputName.value.trim() : "";
  const rawDate = inputDate ? inputDate.value.trim() : "";

  if (!regionName || !rawDate) {
    alert("請填寫賽事名稱與日期！");
    return;
  }

  const eventDate = rawDate.replace(/-/g, "");
  const btn = document.getElementById("btn-confirm-add-region");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "正在建立兩組表單...";
  }

  try {
    const res = await fetch(`${API_URL}?action=createTournament`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ adminUser: "admin", regionName: regionName, eventDate: eventDate })
    });
    const result = await res.json();

    if (result.success) {
      alert(`【建立成功！】\n基礎組：${result.basicName}\n進階組：${result.advancedName}`);
      if (modalAddRegion) modalAddRegion.style.display = "none";
      if (inputName) inputName.value = "";
      if (inputDate) inputDate.value = "";
      loadAdminTournamentsLobby();
    } else {
      alert("建立失敗：" + result.message);
    }
  } catch (err) {
    alert("建立新賽事發生錯誤：" + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "建立賽事";
    }
  }
}

async function openAssignModal() {
  if (!modalAssignJudge) return;
  modalAssignJudge.style.display = "flex";
  if (selectAssignJudge) selectAssignJudge.innerHTML = "<option>載入評審中...</option>";
  if (assignTeamsContainer) assignTeamsContainer.innerHTML = "<div style='color:#666;'>載入隊伍清單中...</div>";

  try {
    const res = await fetch(`${API_URL}?action=getJudgeAssignments&sheetId=${encodeURIComponent(currentSheetId)}&_t=${Date.now()}`);
    const data = await res.json();

    if (data.success) {
      cachedAdminJudges = data.judges || [];
      cachedAdminAllTeams = data.allTeams || [];

      if (selectAssignJudge) {
        selectAssignJudge.innerHTML = "";
        cachedAdminJudges.forEach(j => {
          const opt = document.createElement("option");
          opt.value = j.username;
          opt.textContent = `${j.name} (${j.username})`;
          selectAssignJudge.appendChild(opt);
        });
      }

      renderTeamAssignmentCheckboxes();
      onAssignJudgeSelectChange();
    } else {
      alert("載入指派資料失敗：" + data.message);
    }
  } catch (e) {
    alert("載入評審指派設定連線錯誤！");
  }
}

function renderTeamAssignmentCheckboxes() {
  if (!assignTeamsContainer) return;
  assignTeamsContainer.innerHTML = "";
  cachedAdminAllTeams.forEach(t => {
    const lbl = document.createElement("label");
    lbl.style.display = "flex";
    lbl.style.alignItems = "center";
    lbl.style.gap = "4px";
    lbl.style.fontSize = "13px";
    lbl.innerHTML = `<input type="checkbox" class="chk-assign-team" value="${t.teamId}"> ${t.teamId}`;
    assignTeamsContainer.appendChild(lbl);
  });
}

// 評審工作分配：預設不勾選向度，依試算表實際值回填
function onAssignJudgeSelectChange() {
  if (!selectAssignJudge) return;
  const selectedUser = selectAssignJudge.value;
  const judgeObj = cachedAdminJudges.find(j => j.username === selectedUser);
  if (!judgeObj) return;

  const groupSheets = document.getElementById("group-assign-sheets");
  if (currentDivision === "advanced") {
    if (groupSheets) groupSheets.style.display = "block";
    const rawSheets = String(judgeObj.assignedSheets || "").toLowerCase().trim();

    // 核心調整：預設不要全勾。僅當試算表有明確記錄時才勾選
    const activeSheets = rawSheets.split(/[\s,，、]+/);
    document.querySelectorAll(".chk-assign-sheet").forEach(chk => {
      chk.checked = (rawSheets === "all") || (activeSheets.indexOf(chk.value) !== -1);
    });
  } else {
    if (groupSheets) groupSheets.style.display = "none";
  }

  const assignedTeamTokens = parseLocalTeamRange(judgeObj.teams);
  document.querySelectorAll(".chk-assign-team").forEach(chk => {
    chk.checked = assignedTeamTokens.indexOf(chk.value) !== -1;
  });
}

function parseLocalTeamRange(rawStr) {
  if (!rawStr) return [];
  const tokens = String(rawStr).split(/[\s,，、]+/).filter(t => t.length > 0);
  const result = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].trim();
    const rangeMatch = token.match(/^([A-Za-z]+)(\d+)[~～\-－]([A-Za-z]+)(\d+)$/);
    if (rangeMatch) {
      const prefixStart = rangeMatch[1].toUpperCase();
      const numStart = parseInt(rangeMatch[2], 10);
      const prefixEnd = rangeMatch[3].toUpperCase();
      const numEnd = parseInt(rangeMatch[4], 10);
      const padLen = rangeMatch[2].length;

      if (prefixStart === prefixEnd && numStart <= numEnd) {
        for (let n = numStart; n <= numEnd; n++) {
          let paddedNum = String(n);
          while (paddedNum.length < padLen) paddedNum = "0" + paddedNum;
          result.push(prefixStart + paddedNum);
        }
      } else {
        result.push(token);
      }
    } else {
      result.push(token);
    }
  }
  return result;
}

function setAllTeamCheckboxes(checked) {
  document.querySelectorAll(".chk-assign-team").forEach(c => c.checked = checked);
}

// 支援基礎組 (GA) 與進階組 (GB) 年段代碼快速勾選
function filterTeamCheckboxesByLevel(levelCode) {
  const prefix = (currentDivision === "advanced") ? `GB${levelCode}` : `GA${levelCode}`;
  document.querySelectorAll(".chk-assign-team").forEach(c => {
    c.checked = c.value.toUpperCase().startsWith(prefix);
  });
}

async function submitSaveJudgeAssignment() {
  if (!selectAssignJudge) return;
  const targetUser = selectAssignJudge.value;
  if (!targetUser) return;

  const btn = document.getElementById("btn-save-assign");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "儲存中...";
  }

  const checkedSheets = [];
  document.querySelectorAll(".chk-assign-sheet:checked").forEach(c => checkedSheets.push(c.value));
  const assignedSheetsStr = checkedSheets.join(",");

  const checkedTeams = [];
  document.querySelectorAll(".chk-assign-team:checked").forEach(c => checkedTeams.push(c.value));
  const assignedTeamsStr = checkedTeams.join(",");

  try {
    const res = await fetch(`${API_URL}?action=updateJudgeAssignments`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        adminUser: "admin",
        sheetId: currentSheetId,
        division: currentDivision,
        targetUsername: targetUser,
        assignedSheetsStr: assignedSheetsStr,
        assignedTeamsStr: assignedTeamsStr
      })
    });
    const result = await res.json();
    if (result.success) {
      alert("【儲存成功】評審指派設定已更新！");
      if (modalAssignJudge) modalAssignJudge.style.display = "none";
      await fetchLatestScores(false);
    } else {
      alert("儲存失敗：" + result.message);
    }
  } catch (e) {
    alert("儲存指派錯誤：" + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "儲存指派";
    }
  }
}

async function fetchLatestScores(showNotice = false) {
  if (!currentJudge) return;

  const syncBtns = document.querySelectorAll(".btn-sync-cloud");
  if (showNotice) syncBtns.forEach(b => { b.disabled = true; b.textContent = "同步中..."; });

  try {
    const fetchUrl = `${API_URL}?action=getScores&judgeName=${encodeURIComponent(currentJudge)}&username=${encodeURIComponent(currentUsername || "")}&sheetId=${encodeURIComponent(currentSheetId)}&_t=${Date.now()}`;
    const res = await fetch(fetchUrl);
    const data = await res.json();

    if (data.success) {
      if (isAdminUser && data.teams) {
        assignedTeams = data.teams;
      } else if (data.teams && assignedTeams.length === 0) {
        assignedTeams = data.teams;
      }
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

// 支援 GAE/GBE(國小)、GAJ/GBJ(國中)、GAH/GBH(高中) 年段篩選
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
          ${isAdminUser ? "<th>名次</th>" : '<th class="th-hide-score">隱藏</th><th>操作</th>'}
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
          ${isAdminUser ? "<th>名次</th>" : '<th class="th-hide-score">隱藏</th><th>操作</th>'}
        </tr>
      `;
    }
  }

  if (!teamListBody) return;
  teamListBody.innerHTML = "";

  if (assignedTeams.length === 0) {
    teamListBody.innerHTML = `<tr><td colspan="15" style="color:#d32f2f; padding: 24px;">查無可評分的隊伍，請確認該組別試算表！</td></tr>`;
    return;
  }

  let filteredTeams = assignedTeams;
  if (isAdminUser) {
    // 依據目前組別 (GA/GB) 與選擇的年段 (E/J/H) 篩選
    const targetPrefix = isAdv ? `GB${currentGroupFilter}` : `GA${currentGroupFilter}`;
    filteredTeams = assignedTeams.filter(t => String(t.teamId).toUpperCase().startsWith(targetPrefix));
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

    let endColsHtml = "";
    if (isAdminUser) {
      endColsHtml = `<td style="font-weight:bold; color:#d32f2f;">${rankMap[team.teamId] || "-"}</td>`;
    } else {
      endColsHtml = `
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
    }

    tr.innerHTML = `
      <td>${team.group}</td>
      <td style="font-weight:bold;">${team.teamId}</td>
      <td>${team.school}</td>
      <td>${team.teamName}</td>
      ${midColsHtml}
      ${endColsHtml}
    `;

    teamListBody.appendChild(tr);
  });
}

function exportSummaryToPdf() {
  let groupName = "國小組";
  if (currentGroupFilter === "J") groupName = "國中組";
  else if (currentGroupFilter === "H") groupName = "高中組";

  const fullTitle = `${currentTournamentName}${groupName}`;

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
  const infoEl = document.getElementById("current-team-info");
  if (infoEl) {
    infoEl.textContent = `評分對象：【${currentTournamentName}】[${currentTeam.teamId}] ${currentTeam.school} - ${currentTeam.teamName}`;
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
    const sheets = currentAssignedSheets;
    const hasS1 = isAdminUser || sheets.indexOf("sheet1") !== -1;
    const hasS2 = isAdminUser || sheets.indexOf("sheet2") !== -1;
    const hasS3 = isAdminUser || sheets.indexOf("sheet3") !== -1;
    const hasS4 = isAdminUser || sheets.indexOf("sheet4") !== -1;

    const bS1 = document.getElementById("adv-block-sheet1");
    const bS2 = document.getElementById("adv-block-sheet2");
    const bS3 = document.getElementById("adv-block-sheet3");
    const bS4 = document.getElementById("adv-block-sheet4");

    if (bS1) bS1.style.display = hasS1 ? "block" : "none";
    if (bS2) bS2.style.display = hasS2 ? "block" : "none";
    if (bS3) bS3.style.display = hasS3 ? "block" : "none";
    if (bS4) bS4.style.display = hasS4 ? "block" : "none";

    const needSign = hasS1 || hasS2;
    if (needSign) {
      if (signWrapper) signWrapper.style.display = "block";
      if (roleHint) roleHint.textContent = "第一張或第二張評分表規範選手需簽名確認。";
    } else {
      if (signWrapper) signWrapper.style.display = "none";
      if (roleHint) roleHint.textContent = "第三張與第四張評分表規範選手免簽名，點擊送出即可同步成績。";
    }
  }

  const existingScore = scoresCache[teamId];
  if (existingScore && existingScore.totalScore !== undefined && existingScore.totalScore !== "") {
    loadExistingScoresToForm(existingScore);
  } else {
    resetFormToDefaults();
  }

  calculateAllScores();
  switchPage("scoring");

  hasSignature = false;
  isDrawing = false;
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }

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
  if (pageAdminTournaments) pageAdminTournaments.classList.remove("active");
  if (pageSummary) pageSummary.classList.remove("active");
  if (pageScoring) pageScoring.classList.remove("active");

  if (page === "adminTournaments") {
    if (pageAdminTournaments) pageAdminTournaments.classList.add("active");
  } else if (page === "summary") {
    if (pageSummary) pageSummary.classList.add("active");
    renderTeamList();
  } else if (page === "scoring") {
    if (pageScoring) pageScoring.classList.add("active");
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
  const sheets = currentAssignedSheets;
  const hasS1 = isAdminUser || sheets.indexOf("sheet1") !== -1;
  const hasS2 = isAdminUser || sheets.indexOf("sheet2") !== -1;
  const hasS3 = isAdminUser || sheets.indexOf("sheet3") !== -1;
  const hasS4 = isAdminUser || sheets.indexOf("sheet4") !== -1;

  if (hasS1) subtotal += (stageScore + fluencyWeighted);
  if (hasS2) subtotal += (greenTotal + sciScore);
  if (hasS3) subtotal += creativeTotal;
  if (hasS4) subtotal += designTotal;

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
  const sheets = currentAssignedSheets;
  const hasS1 = isAdminUser || sheets.indexOf("sheet1") !== -1;
  const hasS2 = isAdminUser || sheets.indexOf("sheet2") !== -1;
  const needSign = !isAdv || hasS1 || hasS2;

  if (needSign && !hasSignature) {
    alert("第一張或第二張評分表規範選手需完成簽名確認後再行送出！");
    return;
  }

  const btn = document.getElementById("btn-submit");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "傳送成績中...";
  }

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
    sheetId: currentSheetId,
    group: currentTeam.group || "",
    teamId: currentTeam.teamId,
    school: currentTeam.school,
    teamName: currentTeam.teamName,
    judgeName: currentJudge,
    username: currentUsername,
    sheetTagsStr: isAdv ? currentAssignedSheets.join(",") : "basic",
    timestamp: timestamp,
    signature: signatureData
  };

  if (isAdv) {
    const hasS3 = isAdminUser || sheets.indexOf("sheet3") !== -1;
    const hasS4 = isAdminUser || sheets.indexOf("sheet4") !== -1;

    if (hasS1) {
      const st = document.getElementById("score-adv-stage");
      const fl = document.getElementById("score-adv-fluency-weighted");
      payload.stageCountScore = st ? parseFloat(st.textContent) || 0 : 0;
      payload.fluencyWeighted = fl ? parseFloat(fl.textContent) || 0 : 0;
    }
    if (hasS2) {
      const g1 = document.getElementById("score-adv-green1");
      const g2 = document.getElementById("score-adv-green2");
      const g3 = document.getElementById("score-adv-green3");
      const sc = document.getElementById("score-adv-science");
      payload.green1Score = g1 ? parseFloat(g1.textContent) || 0 : 0;
      payload.green2Score = g2 ? parseFloat(g2.textContent) || 0 : 0;
      payload.green3Score = g3 ? parseFloat(g3.textContent) || 0 : 0;
      payload.scienceScore = sc ? parseFloat(sc.textContent) || 0 : 0;
    }
    if (hasS3) {
      const cr = document.getElementById("score-adv-creative-total");
      payload.creativeScore = cr ? parseFloat(cr.textContent) || 0 : 0;
    }
    if (hasS4) {
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
    if (btn) {
      btn.disabled = false;
      btn.textContent = "確認並送出成績";
    }
  }
}
