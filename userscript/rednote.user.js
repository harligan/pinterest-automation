// ==UserScript==
// @name         RedNote → Pinterest Drive
// @description  Save RedNote (Xiaohongshu) images to the Pinterest Drive folder
// @version      1.0
// @match        https://www.rednote.com/*
// @match        https://rednote.com/*
// @match        https://www.xiaohongshu.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @connect      xhscdn.com
// @connect      rednote.com
// @connect      xiaohongshu.com
// ==/UserScript==

// URL and token are NOT stored in this file (same setup as x.user.js / ig.user.js).
function cfg(key, label) {
  let v = GM_getValue(key, "");
  if (!v) {
    v = (prompt(label) || "").trim();
    if (v) GM_setValue(key, v);
  }
  return v;
}
const API = cfg("api", "Pinterest Drive: paste your web app URL");
const TOKEN = cfg("token", "Pinterest Drive: paste your token");
GM_registerMenuCommand("Reset saved URL + token", () => {
  GM_setValue("api", "");
  GM_setValue("token", "");
  alert("Cleared. Reload the page to enter them again.");
});

const call = (method, data) => new Promise((res, rej) => GM_xmlhttpRequest({
  method,
  url: method === "GET" ? `${API}?token=${TOKEN}` : API,
  headers: { "Content-Type": "text/plain" },
  data: data && JSON.stringify({ ...data, token: TOKEN }),
  anonymous: true,
  onload: r => { try { res(JSON.parse(r.responseText)); } catch { rej("bad reply " + r.status); } },
  onerror: () => rej("blocked"),
  ontimeout: () => rej("timeout")
}));

const getBlob = url => new Promise((res, rej) => GM_xmlhttpRequest({
  method: "GET",
  url,
  responseType: "blob",
  headers: { Referer: location.origin + "/" },
  onload: r => r.status === 200 ? res(r.response) : rej("image " + r.status),
  onerror: () => rej("image blocked"),
  ontimeout: () => rej("image timeout")
}));

// RedNote serves resized copies with a "!suffix" on the URL. Try the bare
// (original) URL first, fall back to the URL as shown on the page.
async function fetchImage(url) {
  const bare = url.split("!")[0];
  let blob;
  try { blob = await getBlob(bare); } catch { blob = await getBlob(url); }
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res({ data: fr.result.split(",")[1], mime: blob.type || "image/jpeg" });
    fr.onerror = () => rej("read failed");
    fr.readAsDataURL(blob);
  });
}

// ---------- styles ----------
GM_addStyle(`
#pk-tools{position:fixed;z-index:2147483000;display:none;gap:6px}
.pk-btn{width:30px;height:30px;border-radius:50%;border:0;cursor:pointer;background:rgba(0,0,0,.65);color:#fff;font-size:16px;line-height:30px;padding:0}
.pk-btn:hover{background:rgba(0,0,0,.85)}
.pk-btn.busy::after{content:"";display:block;width:18px;height:18px;box-sizing:border-box;margin:6px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:pkspin .7s linear infinite}
.pk-btn.ok{background:#00ba7c}
.pk-btn.err{background:#f4212e}
@keyframes pkspin{to{transform:rotate(360deg)}}
#pk-menu{position:fixed;z-index:2147483001;width:230px;background:#16181c;color:#e7e9ea;border:1px solid #333;border-radius:10px;padding:6px;box-shadow:0 4px 16px rgba(0,0,0,.5);font:14px sans-serif}
#pk-menu input{width:100%;box-sizing:border-box;padding:6px 8px;margin-bottom:4px;border-radius:6px;border:1px solid #444;background:#000;color:#fff}
#pk-menu .it{padding:6px 8px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pk-menu .it:hover,#pk-menu .it.sel{background:#2f3336}
.pk-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483002;background:#16181c;color:#fff;padding:8px 14px;border-radius:8px;font:14px sans-serif}
.pk-toast.err{background:#f4212e}
`);

function toast(msg, err) {
  const t = document.createElement("div");
  t.className = "pk-toast" + (err ? " err" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ---------- board list (cached for instant menu) ----------
let boards = JSON.parse(GM_getValue("boards", "[]"));
call("GET").then(b => {
  if (Array.isArray(b)) { boards = b; GM_setValue("boards", JSON.stringify(b)); }
}).catch(() => {});

const getRecent = () => JSON.parse(GM_getValue("recent", "[]"));
const pushRecent = b =>
  GM_setValue("recent", JSON.stringify([b, ...getRecent().filter(x => x !== b)].slice(0, 5)));

// ---------- popup menu ----------
const menu = document.createElement("div");
menu.id = "pk-menu";
menu.style.display = "none";
const input = document.createElement("input");
input.placeholder = "Search board…";
const list = document.createElement("div");
menu.append(input, list);
document.body.appendChild(menu);

let onPick = null;
const hide = () => { menu.style.display = "none"; };

function pick(board) {
  const f = onPick;
  onPick = null;
  hide();
  if (f) f(board);
}

function render() {
  const q = input.value.trim().toLowerCase();
  const items = q
    ? boards.filter(b => b.toLowerCase().includes(q)).slice(0, 6)
    : getRecent();
  list.innerHTML = "";
  items.forEach((b, i) => {
    const d = document.createElement("div");
    d.className = "it" + (i === 0 ? " sel" : "");
    d.textContent = b;
    d.onmousedown = e => { e.preventDefault(); pick(b); };
    list.appendChild(d);
  });
  if (!items.length) {
    const d = document.createElement("div");
    d.className = "it";
    d.style.opacity = ".6";
    d.textContent = q ? "No match" : "Type to search";
    list.appendChild(d);
  }
}

function openMenu(btn, cb) {
  onPick = cb;
  const r = btn.getBoundingClientRect();
  menu.style.display = "block";
  menu.style.left = Math.max(8, Math.min(r.left - 190, window.innerWidth - 240)) + "px";
  menu.style.top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 260)) + "px";
  input.value = "";
  render();
  input.focus();
}

input.oninput = render;
input.onkeydown = e => {
  e.stopPropagation();
  if (e.key === "Escape") hide();
  if (e.key === "Enter") {
    const first = list.querySelector(".it.sel");
    if (first) pick(first.textContent);
  }
};
input.onkeyup = input.onkeypress = e => e.stopPropagation();
document.addEventListener("mousedown", e => { if (!menu.contains(e.target)) hide(); }, true);

// ---------- reading info off the page ----------
const CARD = "section.note-item, #noteContainer, .note-container, .note-detail-mask";

function imgUrl(img) {
  return img.currentSrc || img.src;
}

const imgId = url => {
  const p = new URL(url).pathname.split("/").pop() || "img";
  return "rn-" + p.split("!")[0].replace(/\.\w+$/, "");
};

// author name: first profile link with text inside the card / open note
function getUser(img) {
  const root = img.closest(CARD) || document;
  for (const a of root.querySelectorAll('a[href*="/user/profile/"]')) {
    const t = (a.textContent || "").trim();
    if (t) return t;
  }
  const n = root.querySelector(".author .name, .username, .author-wrapper .name");
  return n ? n.textContent.trim() : "";
}

// ---------- floating buttons (follow the image under the cursor) ----------
let target = null;

function setState(b, s, title) {
  b.className = "pk-btn" + (s === "idle" ? "" : " " + s);
  b.textContent = s === "busy" ? "" : s === "ok" ? "✓" : s === "err" ? "✕" : b._icon;
  b.title = title || b._title;
}

function makeBtn(mode) {
  const b = document.createElement("button");
  b._icon = mode === "plain" ? "⬇" : "@";
  b._title = mode === "plain" ? "Save plain (no credit)" : "Save with 'name on RedNote' description";
  setState(b, "idle");

  b.onclick = e => {
    e.preventDefault();
    e.stopPropagation();
    const img = target;
    if (!img) return;
    const user = getUser(img);
    if (mode === "at" && !user) return toast("Author not found", true);

    openMenu(b, async board => {
      setState(b, "busy");
      try {
        const url = imgUrl(img);
        const { data, mime } = await fetchImage(url);
        const r = await call("POST", {
          action: "saveIG", source: "RedNote", mode, board, user,
          img: imgId(url), data, mime
        });
        if (!r.ok) throw r.error || "failed";
        if (target === img) setState(b, "ok", "Saved to " + board);
        toast(r.saved ? "Saved to " + board : "Already saved", false);
        pushRecent(board);
      } catch (err) {
        if (target === img) setState(b, "err", String(err));
        toast(String(err), true);
      }
    });
  };
  return b;
}

const tools = document.createElement("div");
tools.id = "pk-tools";
const btnAt = makeBtn("at");
const btnPlain = makeBtn("plain");
tools.append(btnAt, btnPlain);
document.body.appendChild(tools);

// feed covers and images inside an open note; skips avatars and small icons
const isPostImg = el => {
  if (el.tagName !== "IMG" || !el.closest(CARD)) return false;
  if (el.closest('a[href*="/user/profile/"]')) return false;
  const r = el.getBoundingClientRect();
  return r.width >= 150 && r.height >= 150;
};

function update(x, y) {
  const els = document.elementsFromPoint(x, y);
  if (els.some(el => tools.contains(el) || menu.contains(el))) return;
  const img = els.find(isPostImg);
  if (!img) { tools.style.display = "none"; return; }
  if (img !== target) {
    target = img;
    setState(btnAt, "idle");
    setState(btnPlain, "idle");
  }
  const r = img.getBoundingClientRect();
  tools.style.left = Math.max(8, Math.min(r.right, window.innerWidth) - 76) + "px";
  tools.style.top = Math.max(r.top, 0) + 8 + "px";
  tools.style.display = "flex";
}

let raf = 0;
document.addEventListener("mousemove", e => {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; update(e.clientX, e.clientY); });
}, true);

window.addEventListener("scroll", () => { hide(); tools.style.display = "none"; }, true);
