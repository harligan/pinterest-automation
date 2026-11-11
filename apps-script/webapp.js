// TOKEN lives in config.js (kept out of git)

const out = o => ContentService.createTextOutput(JSON.stringify(o))
  .setMimeType(ContentService.MimeType.JSON);

function boardNames() {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(BOARDS_TAB_NAME);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
    .map(r => String(r[0])).filter(Boolean);
}

function getBoardFolder(name) {
  const root = DriveApp.getFolderById(MAIN_FOLDER_ID);
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

// Run this ONCE from the editor to create all missing board folders
function createMissingFolders() {
  boardNames().forEach(getBoardFolder);
}

function doGet(e) {
  if (e.parameter.token !== TOKEN) return out({ error: "auth" });
  return out(boardNames());
}

function fetchJson(url) {
  const r = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const code = r.getResponseCode();
  if (code !== 200) throw new Error(code + " from " + url.split("/")[2]);
  return JSON.parse(r.getContentText());
}

function getTweet(user, id) {
  const errs = [];
  try {
    const t = fetchJson(`https://api.fxtwitter.com/${user}/status/${id}`).tweet;
    return {
      handle: t.author.screen_name,
      photos: ((t.media && t.media.photos) || []).map(p => p.url)
    };
  } catch (e) { errs.push(String(e.message)); }
  try {
    const t = fetchJson(`https://api.vxtwitter.com/${user}/status/${id}`);
    return {
      handle: t.user_screen_name,
      photos: (t.media_extended || []).filter(x => x.type === "image").map(x => x.url)
    };
  } catch (e) { errs.push(String(e.message)); }
  throw new Error(errs.join(" | "));
}

function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  if (d.token !== TOKEN) return out({ error: "auth" });

  if (d.action === "syncBoards") {
  try {
    return out(syncBoards());
  } catch (err) {
    return out({ error: "Board sync failed: " + err.message });
  }
  }

  if (d.action === "addBoard") {
    try { return out(addBoard(d.url, d.name)); }
    catch (err) { return out({ error: err.message }); }
  }

  if (d.action === "saveIG") {
    try { return out(saveIG(d)); }
    catch (err) { return out({ error: err.message }); }
  }

  const m = d.url.match(/x\.com\/([^\/]+)\/status\/(\d+)/);
  if (!m) return out({ error: "bad url" });
  if (boardNames().indexOf(d.board) < 0) return out({ error: "unknown board" });

  let t;
  try {
    t = getTweet(m[1], m[2]);
  } catch (err) {
    return out({ error: "fetch failed: " + err.message });
  }
  if (!t.photos.length) return out({ error: "no images" });

  const plain = d.plain === true;
  const atMode = d.mode === "at";   // "@" button: pin description = "<handle> in x.com"
  const folder = getBoardFolder(d.board);
  let saved = 0;
  try {
    t.photos.forEach((url, i) => {
      if (d.index && d.index !== i + 1) return;   // single-image mode
      const base = `${m[2]}_${i + 1}.jpg`;
      const creditedName = `@${t.handle}_${base}`;
      // The scanner reads Description from the filename after "~",
      // so the @ button just names the file "~ <handle> in x.com.jpg".
      const name = atMode ? `~ ${t.handle} in x.com.jpg` : (plain ? base : creditedName);
      // skip if already saved by the ➕ or ⬇ buttons
      if (folder.getFilesByName(creditedName).hasNext() ||
          folder.getFilesByName(base).hasNext()) return;
      const f = folder.createFile(UrlFetchApp.fetch(url).getBlob().setName(name));
      if (!plain) f.setDescription(`https://x.com/${m[1]}/status/${m[2]}`);   // Source URL column
      saved++;
    });
  } catch (err) {
    return out({ error: "download failed: " + err.message });
  }
  return out({ ok: true, saved });
}

// Instagram: the userscript downloads the image and sends it as base64.
// "@" button -> "~ <user> on IG.jpg" (scanner puts "<user> on IG" in Description)
// plain      -> "ig_<imgId>.jpg" (no title, no description, no link)
function saveIG(d) {
  if (boardNames().indexOf(d.board) < 0) return { error: "unknown board" };
  if (!d.data) return { error: "no image data" };

  const user = String(d.user || "").replace(/[^A-Za-z0-9._]/g, "");
  const id = String(d.img || "img").replace(/[^A-Za-z0-9_-]/g, "");
  const mime = /^image\/(jpeg|png|webp)$/.test(d.mime) ? d.mime : "image/jpeg";
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mime];
  const atMode = d.mode === "at";
  if (atMode && !user) return { error: "no username" };

  const name = atMode ? `~ ${user} on IG.${ext}` : `ig_${id}.${ext}`;
  const folder = getBoardFolder(d.board);
  // same-named "@" files are fine (the scanner tracks File IDs); only plain files are de-duplicated
  if (!atMode && folder.getFilesByName(name).hasNext()) return { ok: true, saved: 0 };

  folder.createFile(Utilities.newBlob(Utilities.base64Decode(d.data), mime, name));
  return { ok: true, saved: 1 };
}

function authorize() {
  UrlFetchApp.fetch("https://api.fxtwitter.com/");
}

function addBoard(url, nameOverride) {
  url = String(url || "").split("?")[0].split("#")[0];
  if (!/pinterest\.[a-z.]+\/(?!pin\/)(?!_)[^\/]+\/(?!_)[^\/]+\/?$/.test(url))
    return { error: "not a board URL" };

  const boards = SpreadsheetApp.openById(SHEET_ID).getSheetByName(BOARDS_TAB_NAME);
  const html = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true, followRedirects: true, headers: HEADERS
  }).getContentText();

  const id = boardIdFromHtml(html);
  if (!id) return { error: "board ID not found" };
  const name = String(nameOverride || "").trim() || boardNameFromHtml(html, url);

  const last = boards.getLastRow();
  const have = last < 2 ? [] : boards.getRange(2, 1, last - 1, 2).getValues();
  if (have.some(r => String(r[1]).trim() === id || String(r[0]) === name))
    return { ok: true, name, id, existed: true };

  const r = boards.getRange(last + 1, 1, 1, 2);
  r.setNumberFormat("@");
  r.setValues([[name, id]]);
  getBoardFolder(name);
  return { ok: true, name, id };
}