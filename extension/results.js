const BASE = "http://127.0.0.1:8765";
const $ = id => document.getElementById(id);
let recentRows = [];
let connection = false;

async function api(path, method = "GET") {
  const { bridgeToken } = await chrome.storage.local.get("bridgeToken");
  if (!bridgeToken) throw new Error("Enter your pairing code in the extension popup first.");
  let response;
  try {
    response = await fetch(BASE + path, {
      method,
      headers: { "X-Research-Token": bridgeToken },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch (_) { throw new Error("Local collector is offline. Start python bridge.py."); }
  if (!response.ok) {
    throw new Error(response.status === 401
      ? "Pairing code rejected. Reconnect in extension popup."
      : (await response.text()).slice(0, 250));
  }
  return response;
}

function setStatus(message, error = false) {
  $("status").textContent = message;
  $("status").className = error ? "status error" : "status good";
}
function text(el, value) { $(el).textContent = String(value); }
function parseThemes(value) { return (value || "").split(" | ").filter(Boolean); }

function renderRows() {
  const keyword = $("search").value.toLowerCase().trim();
  const theme = $("theme").value;
  const list = recentRows.filter(row =>
    (!theme || parseThemes(row.themes).includes(theme)) &&
    (!keyword || (String(row.comment) + " " + String(row.post_title)).toLowerCase().includes(keyword)));
  const tbody = $("rows");
  tbody.replaceChildren();
  for (const row of list) {
    const tr = document.createElement("tr");
    const commentCell = document.createElement("td");
    commentCell.className = "comment";
    const comment = document.createElement("div");
    comment.textContent = String(row.comment || "");
    const anchor = document.createElement("a");
    const sourceUrl = String(row.comment_url || "");
    anchor.textContent = "View on Reddit";
    anchor.href = /^https:\/\/(?:www\.|old\.)?reddit\.com\//i.test(sourceUrl)
      ? sourceUrl : "https://www.reddit.com";
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    const title = document.createElement("div");
    title.className = "status";
    title.textContent = String(row.post_title || "");
    commentCell.append(comment, title, anchor);
    const themeCell = document.createElement("td");
    for (const label of parseThemes(row.themes)) {
      const badge = document.createElement("span");
      badge.className = "tag";
      badge.textContent = label;
      themeCell.append(badge);
    }
    const score = document.createElement("td");
    score.textContent = String(row.score ?? 0);
    tr.append(commentCell, themeCell, score);
    tbody.append(tr);
  }
  text("row-count", "Showing " + list.length + " of the latest " + recentRows.length +
    " comments. Full exports include the complete session.");
}

async function refresh() {
  try {
    const state = await (await api("/api/state")).json();
    connection = true;
    setStatus(state.running ? "Local collector connected • collecting comments" :
      "Local collector connected • ready");
    text("comments", Number(state.comments).toLocaleString());
    text("selected", state.selected);
    text("completed", state.completed);
    text("queued", state.queued + " / " + state.failed);
    const percent = state.selected
      ? Math.round(((state.completed + state.failed) / state.selected) * 100) : 0;
    $("bar").style.width = Math.min(100, percent) + "%";
    text("progress-label", state.running
      ? "Scraping " + (state.current || "posts") + " — " + percent + "%"
      : state.completed ? "Ready to export • " + percent + "%" : "Waiting for selected posts");
    text("run-state", state.running ? "● Running" : "Idle");
    $("log").textContent = (state.events || []).map((line, i) =>
      "[" + String(i + 1).padStart(2, "0") + "] " + line).join("\n") ||
      "No posts processed yet. Open Reddit and click posts in selection mode.";
    const records = await (await api("/api/rows?limit=150")).json();
    recentRows = records.rows || [];
    renderRows();
    const themes = Object.keys(state.themes || {});
    const old = $("theme").value;
    const filter = $("theme");
    filter.replaceChildren(new Option("All themes", ""));
    for (const theme of themes) filter.add(new Option(theme, theme));
    filter.value = themes.includes(old) ? old : "";
  } catch (error) {
    connection = false;
    setStatus(error.message, true);
  }
}

async function download(kind, filename) {
  try {
    const response = await api("/api/export/" + kind);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    setStatus("Downloaded " + filename);
  } catch (error) { setStatus(error.message, true); }
}
$("csv").addEventListener("click", () => download("csv", "reddit-comments.csv"));
$("json").addEventListener("click", () => download("json", "reddit-comments.json"));
$("markdown").addEventListener("click", () => download("markdown", "reddit-research.md"));
$("txt").addEventListener("click", () => download("txt", "reddit-comments.txt"));
$("copy").addEventListener("click", async () => {
  try {
    const text = await (await api("/api/export/txt")).text();
    await navigator.clipboard.writeText(text);
    setStatus("Copied collected comments to clipboard.");
  } catch (error) { setStatus(error.message, true); }
});
$("stop").addEventListener("click", async () => {
  try {
    await api("/api/stop", "POST");
    setStatus("No more queued threads will start; the current request may still finish.");
    await refresh();
  } catch (error) { setStatus(error.message, true); }
});
$("reset").addEventListener("click", async () => {
  if (!confirm("Delete all session comments and selected posts?")) return;
  try {
    await api("/api/clear", "POST");
    await chrome.storage.local.set({ selectedPosts: [] });
    await refresh();
    setStatus("Local session cleared.");
  } catch (error) { setStatus(error.message, true); }
});
$("search").addEventListener("input", renderRows);
$("theme").addEventListener("change", renderRows);
refresh();
setInterval(refresh, 3000); // Only refreshes this open dashboard, never triggers scraping.
