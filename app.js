const SPREADSHEET_ID = "1NfJJJDG1j5p_pZC0RnEoxYDY_Nrw31pg";

function getSS() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function doGet(e) {
  var ss = getSS();
  var params = e.parameter || {};

  // 1. 登入比對
  if (params.action === "login") {
    var sheet = ss.getSheetByName("評審名單");
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ 
        status: "fail", 
        message: "試算表找不到「評審名單」活頁，請確認分頁名稱！" 
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    var data = sheet.getDataRange().getValues();
    var inputUser = String(params.username || "").trim().toLowerCase();
    var inputPass = String(params.password || "").trim();
    var foundJudge = null;

    // A欄:姓名, B欄:帳號, C欄:密碼
    for (var i = 1; i < data.length; i++) {
      var name = String(data[i][0] || "").trim();
      var u = String(data[i][1] || "").trim().toLowerCase();
      var p = String(data[i][2] || "").trim();

      if (u === inputUser && p === inputPass) {
        foundJudge = name;
        break;
      }
    }

    if (foundJudge) {
      return ContentService.createTextOutput(JSON.stringify({ 
        status: "success", 
        judgeName: foundJudge 
      })).setMimeType(ContentService.MimeType.JSON);
    } else {
      return ContentService.createTextOutput(JSON.stringify({ 
        status: "fail", 
        message: "帳號或密碼錯誤，請重新確認！" 
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // 2. 抓取隊伍名單
  var teamSheet = ss.getSheetByName("隊伍名單");
  if (!teamSheet) {
    return ContentService.createTextOutput(JSON.stringify({ teams: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var tData = teamSheet.getDataRange().getValues();
  var teams = [];
  for (var j = 1; j < tData.length; j++) {
    if (tData[j][2]) { // 確保有隊伍編號
      teams.push({
        region: String(tData[j][0] || "").trim(),
        category: String(tData[j][1] || "").trim(),
        id: String(tData[j][2] || "").trim(),
        school: String(tData[j][3] || "").trim(),
        name: String(tData[j][4] || "").trim()
      });
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ teams: teams }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 3. 上傳至「輸出總表」
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    var ss = getSS();
    var sheet = ss.getSheetByName("輸出總表");
    if (!sheet) sheet = ss.insertSheet("輸出總表");

    var payload = JSON.parse(e.postData.contents);
    var teamData = payload.data;
    var judgeName = payload.judgeName || "未具名評審";

    var rowData = [
      new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }),
      teamData.region || "",
      teamData.category || "",
      teamData.id,
      teamData.school,
      teamData.name,
      teamData.stageCount,
      teamData.fluencyRaw,
      teamData.fluencyWeighted,
      teamData.contentTotal,
      teamData.taskTotal,
      teamData.total,
      teamData.submitted ? "已完成" : "輸入中",
      judgeName
    ];

    var rows = sheet.getDataRange().getValues();
    var rowIndex = -1;
    for (var r = 1; r < rows.length; r++) {
      if (String(rows[r][3]).trim() === String(teamData.id).trim()) {
        rowIndex = r + 1;
        break;
      }
    }

    if (rowIndex > 0) {
      sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
