const $ = id => document.getElementById(id);
function message(type, extra = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...extra }, reply => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!reply?.ok) return reject(new Error(reply?.error || "Collector unavailable"));
      resolve(reply.data);
    });
  });
}
function status(text, kind = "") {
  $("status").textContent = text;
  $("status").className = "status " + kind;
}
async function preferences() {
  await chrome.storage.local.set({
    bridgeToken: $("token").value.trim(),
    maxComments: Number($("max").value),
    moreRequests: Number($("more").value),
    commentSort: $("sort").value,
  });
}
async function check() {
  try {
    const info = await message("PING");
    $("connection").textContent = "● Connected";
    $("connection").className = "good";
    if (info.reddit_credentials_configured) status("Ready. Open Reddit and click posts.", "good");
    else status("Bridge connected, but approved Reddit OAuth credentials are missing in .env.", "error");
    const state = await message("STATE");
    $("counts").textContent =
      state.selected + " posts · " + state.comments.toLocaleString() + " comments" +
      (state.running ? " · collecting" : "");
  } catch (error) {
    $("connection").textContent = "● Offline";
    $("connection").className = "error";
    status(error.message, "error");
    const data = await chrome.storage.local.get({ selectedPosts: [] });
    $("counts").textContent = data.selectedPosts.length + " links saved locally";
  }
}
(async () => {
  const prefs = await chrome.storage.local.get({
    bridgeToken: "", maxComments: 1000, moreRequests: 12,
    commentSort: "top",
  });
  $("token").value = prefs.bridgeToken;
  $("max").value = String(prefs.maxComments);
  $("more").value = String(prefs.moreRequests);
  $("sort").value = prefs.commentSort;
  await check();
})();
$("connect").addEventListener("click", async () => {
  await preferences();
  await check();
});
$("save").addEventListener("click", async () => {
  await preferences();
  status("Preferences saved. New post selections will use these settings.", "good");
});
$("results").addEventListener("click", async () => {
  try { await message("OPEN_RESULTS"); window.close(); }
  catch (error) { status(error.message, "error"); }
});
$("queue").addEventListener("click", async () => {
  const { selectedPosts } = await chrome.storage.local.get({ selectedPosts: [] });
  let failed = 0;
  for (const post of selectedPosts) {
    try { await message("QUEUE_POST", { post_id: post.post_id }); }
    catch (_) { failed++; }
  }
  status(failed ? failed + " threads failed to queue. Check local collector." : "All saved threads queued.",
    failed ? "error" : "good");
  await check();
});
