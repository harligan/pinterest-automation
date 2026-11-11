/**
 * Pinterest Drive -> Sheet sync
 *
 * What this does:
 * - Looks at every subfolder inside MAIN_FOLDER_ID (each subfolder = one Pinterest board)
 * - For every file in each subfolder that hasn't been logged yet:
 *     - Makes it "anyone with link" viewable
 *     - Builds a direct-view URL
 *     - Reads Title and Description from the filename, split on "~":
 *         "Dune ~ username on IG.jpg" -> Title "Dune", Description "username on IG"
 *         "~ username on IG.jpg"      -> no Title, Description "username on IG"
 *         "Dune ~.jpg"                -> Title "Dune", no Description
 *         "anything.jpg" (no ~)       -> no Title, no Description
 *     - Appends a row:
 *       Title | Media URL | Board | Status | File ID | Source URL | Description
 *
 * Setup:
 * 1. Open your Sheet -> Extensions -> Apps Script
 * 2. Paste this whole file in, replacing any starter code
 * 3. Run `setup` once from the toolbar (it will ask you to authorize)
 * 4. That's it - it installs the time trigger and does an immediate first run
 */

// ---- CONFIG ----
// MAIN_FOLDER_ID and SHEET_ID now live in config.js (kept out of git)
const TAB_NAME = 'Sheet1'; // change this if your tab isn't named "Sheet1"
const BOARDS_TAB_NAME = 'Boards'; // tab with columns: Board Name | Board ID
const RUN_EVERY_MINUTES = 15; // how often the trigger scans for new files

// Filename separator: text before it = Title, text after it = Description
const TAG_SEPARATOR = '~';

// Number of columns in the main sheet (A:G)
const NUM_COLUMNS = 7;

// ---- MAIN SYNC FUNCTION ----
function syncDriveToSheet() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB_NAME);
  if (!sheet) {
    throw new Error(`Tab "${TAB_NAME}" not found in the sheet. Check TAB_NAME.`);
  }

  ensureHeaderRow(sheet);

  const alreadyLoggedFileIds = getAlreadyLoggedFileIds(sheet);
  const boardNameToId = getBoardNameToIdMap();

  const mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);
  const boardFolders = mainFolder.getFolders();

  const rowsToAppend = [];
  const skippedBoards = new Set();

  while (boardFolders.hasNext()) {
    const boardFolder = boardFolders.next();
    const boardName = boardFolder.getName();
    const boardId = boardNameToId[boardName];

    if (!boardId) {
      // No matching row in the Boards tab yet - skip this folder entirely
      // so nothing gets logged with a broken board reference.
      skippedBoards.add(boardName);
      continue;
    }

    const files = boardFolder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const fileId = file.getId();

      if (alreadyLoggedFileIds.has(fileId)) {
        continue; // already logged in a previous run
      }

      // Make it publicly viewable via link
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      const mediaUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
      const { title, description } = parseName(file.getName());

      rowsToAppend.push([
        title,
        mediaUrl,
        boardId,
        'Pending',
        fileId,
        file.getDescription() || '', // Source URL
        description,
      ]);
    }
  }

  if (rowsToAppend.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet
      .getRange(startRow, 1, rowsToAppend.length, NUM_COLUMNS)
      .setValues(rowsToAppend);
    Logger.log(`Added ${rowsToAppend.length} new row(s).`);
  } else {
    Logger.log('No new files found.');
  }

  // Randomize the entire Pending queue
  shufflePendingRows(sheet);
}

// ---- HELPERS ----

function ensureHeaderRow(sheet) {
  sheet.getRange(1, 1, 1, NUM_COLUMNS).setValues([
    ['Title', 'Media URL', 'Board', 'Status', 'File ID', 'Source URL', 'Description'],
  ]);
}

function getBoardNameToIdMap() {
  const boardsSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(BOARDS_TAB_NAME);
  if (!boardsSheet) {
    throw new Error(
      `Tab "${BOARDS_TAB_NAME}" not found. Create it with columns "Board Name" and "Board ID".`
    );
  }

  const lastRow = boardsSheet.getLastRow();
  const map = {};
  if (lastRow < 2) return map; // only header row, or empty

  const values = boardsSheet.getRange(2, 1, lastRow - 1, 2).getValues();
  values.forEach(([name, id]) => {
    if (name && id) {
      map[name] = String(id).trim();
    }
  });
  return map;
}

function getAlreadyLoggedFileIds(sheet) {
  const lastRow = sheet.getLastRow();
  const ids = new Set();
  if (lastRow < 2) return ids; // only header row exists

  // File ID is column E (5th column)
  const values = sheet.getRange(2, 5, lastRow - 1, 1).getValues();
  values.forEach(([id]) => {
    if (id) ids.add(id);
  });
  return ids;
}

// Splits "Title ~ Description.jpg" on the first "~".
// No "~" in the name -> blank title and blank description.
function parseName(fileName) {
  const base = fileName.replace(/\.(png|jpe?g|webp)$/i, '');
  const i = base.indexOf(TAG_SEPARATOR);
  if (i < 0) return { title: '', description: '' };
  return {
    title: base.slice(0, i).trim(),
    description: base.slice(i + 1).trim(),
  };
}

// ---- ONE-TIME SETUP: run this once from the Apps Script editor ----
function setup() {
  // Remove any existing triggers for syncDriveToSheet to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach((t) => {
    if (t.getHandlerFunction() === 'syncDriveToSheet') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Install a fresh time-driven trigger
  ScriptApp.newTrigger('syncDriveToSheet')
    .timeBased()
    .everyMinutes(RUN_EVERY_MINUTES)
    .create();

  // Run once immediately so existing files get picked up right away
  syncDriveToSheet();

  Logger.log('Setup complete. Trigger installed and first sync run finished.');
}

function shufflePendingRows(sheet) {
  const firstDataRow = 2;
  const statusColumn = 4; // Column D
  const lastRow = sheet.getLastRow();
  const lastColumn = NUM_COLUMNS; // Columns A:G

  if (lastRow < firstDataRow) return;

  const range = sheet.getRange(
    firstDataRow,
    1,
    lastRow - firstDataRow + 1,
    lastColumn
  );

  const rows = range.getValues();

  // Find only Pending rows and their original positions
  const pendingPositions = [];
  const pendingRows = [];

  rows.forEach((row, index) => {
    if (row[statusColumn - 1] === 'Pending') {
      pendingPositions.push(index);
      pendingRows.push(row);
    }
  });

  // Fisher-Yates shuffle
  for (let i = pendingRows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pendingRows[i], pendingRows[j]] =
      [pendingRows[j], pendingRows[i]];
  }

  // Put shuffled rows back into Pending positions only
  pendingPositions.forEach((position, index) => {
    rows[position] = pendingRows[index];
  });

  range.setValues(rows);

  Logger.log(`Shuffled ${pendingRows.length} Pending rows.`);
} 