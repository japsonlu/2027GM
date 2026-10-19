const SPREADSHEET_ID = "https://script.google.com/macros/s/AKfycbzIg6Yr_CgIZySCRuu_J_4QVxNnzDms_I5e0g4hfLcGO8MhrDb7YfwuW-plvoY3MuTK/exec"; // 若由試算表擴充功能點入，可用 SpreadsheetApp.getActiveSpreadsheet()

function getSS() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

// 1. GET 請求：抓取隊伍名單
function doGet(e) {
  var ss = getSS();
  var sheet = ss.getSheetByName("隊伍名單");
  
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ error: "找不到「隊伍名單」分頁" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var data = sheet.getDataRange().getValues();
  var teams = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[2]) {
      teams.push({
        region: String(row[0] || "").trim(),
        category: String(row[1] || "").trim(),
        id: String(row[2] || "").trim(),
        school: String(row[3] || "").trim(),
        name: String(row[4] || "").trim()
      });
    }
  }

  return ContentService.createTextOutput(JSON.stringify({ teams: teams }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 2. POST 請求：處理「登入驗證」與「成績儲存」
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    var ss = getSS();
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;

    // 功能 A：登入驗證（後台比對帳號密碼，保護安全）
    if (action === "login") {
      var judgeSheet = ss.getSheetByName("評審名單");
      if (!judgeSheet) {
        return ContentService.createTextOutput(JSON.stringify({ status: "fail", message: "找不到「評審名單」分頁" }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      var judges = judgeSheet.getDataRange().getValues();
      var foundJudgeName = null;

      // 第 1 欄是姓名(index 0)、第 2 欄是帳號(index 1)、第 3 欄是密碼(index 2)
      for (var j = 1; j < judges.length; j++) {
        var name = String(judges[j][0]).trim();
        var u = String(judges[j][1]).trim();
        var p = String(judges[j][2]).trim();

        if (u === String(payload.username).trim() && p === String(payload.password).trim()) {
          foundJudgeName = name;
          break;
        }
      }

      if (foundJudgeName) {
        return ContentService.createTextOutput(JSON.stringify({ status: "success", judgeName: foundJudgeName }))
          .setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({ status: "fail", message: "帳號或密碼錯誤！" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // 功能 B：即時上傳成績並記錄評審姓名
    if (action === "saveScore") {
      var scoreSheet = ss.getSheetByName("成績總表");
      if (!scoreSheet) scoreSheet = ss.insertSheet("成績總表");

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
        teamData.submitted ? "已簽名完成" : "評分中",
        judgeName
      ];

      var allRows = scoreSheet.getDataRange().getValues();
      var targetRowIndex = -1;

      // 以隊伍編號 (第 4 欄，index 3) 比對覆寫
      for (var r = 1; r < allRows.length; r++) {
        if (String(allRows[r][3]).trim() === String(teamData.id).trim()) {
          targetRowIndex = r + 1;
          break;
        }
      }

      if (targetRowIndex > 0) {
        scoreSheet.getRange(targetRowIndex, 1, 1, rowData.length).setValues([rowData]);
      } else {
        scoreSheet.appendRow(rowData);
      }

      return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
