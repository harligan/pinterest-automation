const KEEP_DAYS = 3;     // keep posted images this long (counted from upload)
const DRY_RUN = false;    // true = only log what WOULD be trashed; false = really trash

function cleanupPosted() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB_NAME);
  const last = sheet.getLastRow();
  if (last < 2) return;

  const rows = sheet.getRange(2, 1, last - 1, 5).getValues();   // columns A:E
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  let n = 0;

  rows.forEach(r => {
    if (String(r[3]).trim().toLowerCase() !== "posted" || !r[4]) return;
    try {
      const f = DriveApp.getFileById(r[4]);
      if (!f.isTrashed() && f.getDateCreated().getTime() < cutoff) {
        if (DRY_RUN) {
          Logger.log("Would trash: " + f.getName());
        } else {
          f.setTrashed(true);
        }
        n++;
      }
    } catch (e) { /* file already gone */ }
  });
  Logger.log(`${DRY_RUN ? "Would trash" : "Trashed"} ${n} posted file(s).`);
}

// Run once to make it automatic (daily, around 3 am)
function installCleanup() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "cleanupPosted") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("cleanupPosted").timeBased().everyDays(1).atHour(3).create();
}