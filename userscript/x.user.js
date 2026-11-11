// ==UserScript==
// @name         X → Pinterest Drive
// @description  Save X images to the Pinterest Drive folder
// @version      2.2
// @match        https://x.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      script.google.com
// @connect      script.googleusercontent.com
// ==/UserScript==

// URL and token are NOT stored in this file. On first run you are asked for
// them once; Tampermonkey keeps them. Reset via the Tampermonkey menu.
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

// ---------- styles ----------
const style = document.createElement("style");
style.textContent = `
.pk-btn{position:absolute;top:8px;right:8px;z-index:5;width:30px;height:30px;border-radius:50%;border:0;cursor:pointer;background:rgba(0,0,0,.65);color:#fff;font-size:16px;line-height:30px;padding:0}
.pk-btn:hover{background:rgba(0,0,0,.85)}
.pk-btn.plain{right:44px}
.pk-btn.at{right:80px}
.pk-btn.busy::after{content:"";display:block;width:18px;height:18px;box-sizing:border-box;margin:6px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:pkspin .7s linear infinite}
.pk-btn.ok{background:#00ba7c}
.pk-btn.err{background:#f4212e}
@keyframes pkspin{to{transform:rotate(360deg)}}
#pk-menu{position:fixed;z-index:99999;width:230px;background:#16181c;color:#e7e9ea;border:1px solid #333;border-radius:10px;padding:6px;box-shadow:0 4px 16px rgba(0,0,0,.5);font:14px sans-serif}
#pk-menu input{width:100%;box-sizing:border-box;padding:6px 8px;margin-bottom:4px;border-radius:6px;border:1px solid #444;background:#000;color:#fff}
#pk-menu .it{padding:6px 8px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pk-menu .it:hover,#pk-menu .it.sel{background:#2f3336}
`;
document.head.appendChild(style);

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
window.addEventListener("scroll", hide, true);

// ---------- per-image buttons ----------
// mode: "credit" (➕), "plain" (⬇), "at" (@)
function makeBtn(m, mode) {
  const base = "pk-btn" + (mode === "credit" ? "" : " " + mode);
  const b = document.createElement("button");
  b.className = base;
  b.textContent = { credit: "➕", plain: "⬇", at: "@" }[mode];
  b.title = {
    credit: "Save with credit + link",
    plain: "Save plain (no credit/link)",
    at: "Save with 'name in x.com' description"
  }[mode];

  b.onclick = e => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(b, async board => {
      b.className = base + " busy";
      b.textContent = "";
      try {
        const r = await call("POST", {
          url: m[1], index: +m[2], board,
          plain: mode !== "credit", mode
        });
        if (!r.ok) throw r.error || "failed";
        b.className = base + " ok";
        b.textContent = "✓";
        b.title = "Saved to " + board;
        pushRecent(board);
      } catch (err) {
        b.className = base + " err";
        b.textContent = "✕";
        b.title = String(err);
      }
    });
  };
  return b;
}

function addButtons() {
  document.querySelectorAll('article[data-testid="tweet"] a[href*="/photo/"]').forEach(a => {
    if (a.querySelector(".pk-btn")) return;
    const m = a.href.match(/^(.*\/status\/\d+)\/photo\/(\d+)/);
    if (!m) return;
    a.style.position = "relative";
    a.append(makeBtn(m, "credit"), makeBtn(m, "plain"), makeBtn(m, "at"));
  });
}

new MutationObserver(addButtons).observe(document.body, { childList: true, subtree: true });
addButtons();
