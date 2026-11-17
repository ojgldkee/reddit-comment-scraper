/* Click-to-collect Reddit UI. No request runs until the user clicks a post. */
(() => {
  "use strict";
  if (window.top !== window.self || document.getElementById("rr-research-overlay")) return;

  const MATCH = /\/comments\/([a-z0-9]{3,12})(?:\/|$|\?)/i;
  const CARDS = "shreddit-post, [data-testid='post-container'], article, [data-post-id], .Post";
  let selecting = false;
  let saved = [];
  let timer = null;

  function parsePost(value) {
    try {
      const url = new URL(value, location.href);
      if (!/(^|\.)reddit\.com$/i.test(url.hostname)) return null;
      const m = url.pathname.match(MATCH);
      return m ? { post_id: m[1].toLowerCase(),
        url: "https://www.reddit.com/comments/" + m[1].toLowerCase() + "/" } : null;
    } catch (_) { return null; }
  }
  function fromClick(target) {
    if (!(target instanceof Element)) return null;
    const candidates = [];
    const link = target.closest("a[href*='/comments/']");
    if (link) candidates.push(link);
    let current = target;
    for (let depth = 0; current && depth < 10; depth++, current = current.parentElement) {
      if (current.matches?.(CARDS)) candidates.push(current);
    }
    for (const el of candidates) {
      for (const value of [el.getAttribute("permalink"), el.getAttribute("href"),
        el.getAttribute("data-permalink"),
        el.querySelector?.("a[href*='/comments/']")?.getAttribute("href")]) {
        const found = value && parsePost(value);
        if (found) {
          const title = el.querySelector?.("h3, h2, [slot='title'], [data-testid='post-title']")?.textContent;
          return { ...found, title: (title || target.textContent || found.post_id).trim().slice(0, 180) };
        }
      }
    }
    return null;
  }
  const host = document.createElement("div");
  host.id = "rr-research-overlay";
  host.style.cssText = "position:fixed;bottom:20px;left:18px;z-index:2147483647;";
  const dom = host.attachShadow({ mode: "open" });
  dom.innerHTML = [
    '<style>*{box-sizing:border-box} .panel{background:#0d1522;color:#f5f7fc;',
    'font:13px/1.4 system-ui,sans-serif;border:1px solid #334154;border-radius:15px;',
    'padding:12px;max-width:min(94vw,640px);box-shadow:0 14px 45px #0009}',
    '.active{border-color:#ff7557;box-shadow:0 0 0 2px #ff755744,0 14px 45px #0009}',
    '.head{display:flex;align-items:center;gap:10px;margin-bottom:10px}',
    '.brand{font-weight:800}.brand:before{content:"●";color:#ff5938;padding-right:7px}',
    '.counts{margin-left:auto;font-variant-numeric:tabular-nums;color:#bbc7d5}',
    '.buttons{display:flex;gap:6px;flex-wrap:wrap}',
    'button{font:700 12px/1 system-ui,sans-serif;color:white;background:#273548;',
    'border:1px solid #455a75;border-radius:9px;padding:9px 10px;cursor:pointer}',
    'button:hover{background:#3a4f6a} button.primary{background:#ff5938;border-color:#ff5938}',
    'button[disabled]{opacity:.45;cursor:not-allowed}',
    '.hint{margin-top:9px;color:#a9bfd9;font-size:12px;min-height:17px}',
    '.hint.error{color:#ffbcae}.hint.good{color:#9fe8c7}',
    '.tiny{margin-top:4px;font-size:10px;color:#91a2b8}</style>',
    '<div class="panel"><div class="head"><span class="brand">Reddit Research</span>',
    '<span class="counts" id="counts">0 posts • 0 comments</span></div>',
    '<div class="buttons">',
    '<button class="primary" id="toggle">Start selecting</button>',
    '<button id="current">Collect this thread</button>',
    '<button id="copy">Copy links</button><button id="retry">Queue all</button>',
    '<button id="results">Results / exports</button>',
    '<button id="stop">Stop</button><button id="reset">Reset</button>',
    '</div><div class="hint" id="hint">Click Start selecting, then click any Reddit post.</div>',
    '<div class="tiny">Manual-only • no AI calls • approved Reddit API access required</div></div>'
  ].join("");
  document.documentElement.appendChild(host);
  const $ = id => dom.getElementById(id);

  function notice(value, kind = "") {
    $("hint").textContent = value;
    $("hint").className = "hint " + kind;
  }
  function send(type, extra = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...extra }, reply => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!reply?.ok) return reject(new Error(reply?.error || "Collector disconnected"));
        resolve(reply.data);
      });
    });
  }
  function counts(state) {
    $("counts").textContent =
      (state?.selected ?? saved.length) + " posts • " +
      Number(state?.comments ?? 0).toLocaleString() + " comments";
    $("current").style.display = parsePost(location.href) ? "" : "none";
    $("copy").disabled = !saved.length;
    $("retry").disabled = !saved.length;
  }
  async function collect(post) {
    if (saved.some(item => item.post_id === post.post_id)) {
      notice("Already selected. Open Results to see its status.", "good");
      return;
    }
    saved.push({ post_id: post.post_id, url: post.url, title: post.title || post.post_id });
    await chrome.storage.local.set({ selectedPosts: saved });
    counts();
    notice("Saved " + post.post_id + ". Collecting comments…", "good");
    try {
      const state = await send("QUEUE_POST", { post_id: post.post_id });
      counts(state);
      notice("Thread queued. You can click another post.", "good");
    } catch (error) {
      notice(error.message + " Link saved; use Queue all after connecting.", "error");
    }
  }
  function selectClick(event) {
    if (!selecting || host.contains(event.target)) return;
    const post = fromClick(event.target);
    if (!post) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    collect(post);
  }
  function mode(active) {
    selecting = active;
    $("toggle").textContent = selecting ? "Done selecting" : "Start selecting";
    dom.querySelector(".panel").classList.toggle("active", selecting);
    if (selecting) {
      document.addEventListener("click", selectClick, true);
      timer = setInterval(refresh, 3500);
      notice("Selection mode ON — click a Reddit post to scrape it.", "good");
      refresh();
    } else {
      document.removeEventListener("click", selectClick, true);
      if (timer) clearInterval(timer);
      timer = null;
      notice("Selection mode OFF. Open Results to export the comments.");
    }
  }
  async function refresh() {
    try {
      const state = await send("STATE");
      counts(state);
      if (state.running) notice(
        "Reading " + (state.current || "queued threads") +
        " • " + state.completed + " complete • " + state.queued + " waiting", "good");
      else if (state.failed) notice("Some threads failed. Open Results for details.", "error");
      else if (state.completed) notice(state.comments + " comments ready to export.", "good");
    } catch (_) { /* Collector may be off while browsing. */ }
  }
  $("toggle").addEventListener("click", () => mode(!selecting));
  $("current").addEventListener("click", () => {
    const post = parsePost(location.href);
    if (post) collect({ ...post, title: document.title });
  });
  $("results").addEventListener("click", () => send("OPEN_RESULTS").catch(e => notice(e.message, "error")));
  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(saved.map(item => item.url).join("\n"));
      notice("Copied " + saved.length + " Reddit URLs.", "good");
    } catch (_) { notice("Clipboard unavailable. Open Results to export.", "error"); }
  });
  $("retry").addEventListener("click", async () => {
    notice("Queuing selected threads...");
    let errors = 0;
    for (const item of saved) {
      try { await send("QUEUE_POST", { post_id: item.post_id }); } catch (_) { errors++; }
    }
    notice(errors ? "Some threads could not be queued. Check the pairing code." : "All posts queued.",
      errors ? "error" : "good");
    refresh();
  });
  $("stop").addEventListener("click", () => {
    send("STOP").then(() => notice("Stopped future requests. Current request may finish.", "good"))
      .catch(e => notice(e.message, "error"));
  });
  $("reset").addEventListener("click", async () => {
    if (!confirm("Remove all saved links and comments from the local session?")) return;
    try { await send("CLEAR"); } catch (_) { /* Still clear local selection. */ }
    saved = [];
    await chrome.storage.local.set({ selectedPosts: [] });
    counts({ selected: 0, comments: 0 });
    notice("Local selection cleared.", "good");
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && selecting) mode(false);
  });
  chrome.storage.onChanged.addListener((updates, area) => {
    if (area === "local" && updates.selectedPosts) {
      saved = updates.selectedPosts.newValue || [];
      counts();
    }
  });
  chrome.storage.local.get({ selectedPosts: [] }).then(data => {
    saved = Array.isArray(data.selectedPosts) ? data.selectedPosts : [];
    counts();
    refresh();
  });
})();
