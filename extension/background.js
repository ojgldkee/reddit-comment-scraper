/* One-shot proxy for the localhost Python bridge; NO scheduled tasks. */
const BRIDGE = "http://127.0.0.1:8765";
const POST_ID = /^[a-z0-9]{3,12}$/i;

function trustedSender(sender) {
  const url = sender.url || sender.tab?.url || "";
  const extension = chrome.runtime.getURL("");
  return (
    url.startsWith(extension) ||
    /^https:\/\/(?:www\.|old\.|new\.)?reddit\.com(?:\/|$)/i.test(url)
  );
}

async function request(path, method = "GET", body = null) {
  const { bridgeToken } = await chrome.storage.local.get("bridgeToken");
  if (!bridgeToken) throw new Error("Open the extension icon and enter the local pairing code first.");
  let response;
  try {
    response = await fetch(BRIDGE + path, {
      method,
      headers: {
        "X-Research-Token": bridgeToken,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
  } catch (_) {
    throw new Error("Local collector is offline. Run 'python bridge.py' on your computer.");
  }
  if (!response.ok) {
    const explanation = await response.text().catch(() => "");
    throw new Error(
      response.status === 401
        ? "Pairing code rejected. Copy the new code from the Python terminal."
        : explanation.slice(0, 230) || "Collector request failed (" + response.status + ")."
    );
  }
  return response.json();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!trustedSender(sender) || !message || typeof message.type !== "string") {
    sendResponse({ ok: false, error: "Unauthorized message." });
    return false;
  }
  (async () => {
    let value;
    switch (message.type) {
      case "PING":
        value = await request("/api/ping");
        break;
      case "STATE":
        value = await request("/api/state");
        break;
      case "ROWS":
        value = await request("/api/rows?limit=150");
        break;
      case "QUEUE_POST": {
        const id = String(message.post_id || "").trim().toLowerCase();
        if (!POST_ID.test(id)) throw new Error("Invalid Reddit thread ID.");
        const settings = await chrome.storage.local.get({
          maxComments: 1000,
          moreRequests: 12,
          commentSort: "top",
        });
        value = await request("/api/queue", "POST", {
          post_id: id,
          max_comments: Math.min(5000, Math.max(1, Number(settings.maxComments) || 1000)),
          more_requests: Math.min(64, Math.max(0, Number(settings.moreRequests) || 0)),
          sort: ["top", "best", "new", "old", "controversial"].includes(settings.commentSort)
            ? settings.commentSort : "top",
        });
        break;
      }
      case "STOP":
        value = await request("/api/stop", "POST");
        break;
      case "CLEAR":
        value = await request("/api/clear", "POST");
        await chrome.storage.local.set({ selectedPosts: [] });
        break;
      case "OPEN_RESULTS":
        await chrome.tabs.create({ url: chrome.runtime.getURL("results.html") });
        value = { opened: true };
        break;
      default:
        throw new Error("Unknown extension command.");
    }
    sendResponse({ ok: true, data: value });
  })().catch(error => {
    sendResponse({ ok: false, error: String(error.message || error) });
  });
  return true;
});
