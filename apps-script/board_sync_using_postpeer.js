
function fetchPostpeerBoards() {
  const key = PropertiesService
    .getScriptProperties()
    .getProperty("POSTPEER_KEY");

  if (!key) throw new Error("PostPeer API key missing");

  const response = UrlFetchApp.fetch(
    "https://api.postpeer.dev/v1/pinterest/boards",
    {
      method: "get",
      muteHttpExceptions: true,
      headers: { "x-access-key": key }
    }
  );

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status !== 200) {
    throw new Error("PostPeer API error (" + status + "): " + body.slice(0, 300));
  }

  const data = JSON.parse(body);

  if (!data.success || !Array.isArray(data.boards)) {
    throw new Error("Unexpected PostPeer response");
  }

  return data.boards;
}


// Sync PostPeer boards into Sheets and Drive
function syncBoards() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = ss.getSheetByName(BOARDS_TAB_NAME);

    if (!sh) throw new Error("Boards sheet not found");

    const last = sh.getLastRow();

    const existing = last < 2
      ? []
      : sh.getRange(2, 1, last - 1, 2).getDisplayValues();

    const ids = new Set(
      existing.map(row => String(row[1]).trim())
    );

    const boards = fetchPostpeerBoards();

    const fresh = boards
      .filter(b =>
        b.id &&
        b.name &&
        !ids.has(String(b.id).trim())
      )
      .map(b => [
        String(b.name).trim(),
        String(b.id).trim()
      ]);

    const folderErrors = [];

    if (fresh.length) {
      const startRow = Math.max(2, last + 1);
      const range = sh.getRange(startRow, 1, fresh.length, 2);

      range.setNumberFormat("@");
      range.setValues(fresh);

      fresh.forEach(([name]) => {
        try {
          getBoardFolder(name);
        } catch (err) {
          folderErrors.push(name + ": " + err.message);
        }
      });
    }

    return {
      ok: true,
      added: fresh.length,
      total: boards.length,
      names: fresh.map(b => b[0]),
      folderErrors: folderErrors
    };

  } finally {
    lock.releaseLock();
  }
}
