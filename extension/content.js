/* Reddit link grabber: selecting a post SAVES ITS LINK, and never scrapes.
   Scraping begins only after clicking "Scrape selected" on the dashboard. */
(() => {
  "use strict";
  if (window.top !== window.self || document.getElementById("rr-link-grabber")) return;
  const POST_RE = /\/comments\/([a-z0-9]{3,12})(?:\/|$|\?)/i;
  const CARD = "shreddit-post, [data-testid='post-container'], [data-testid='post'], article, [data-post-id], .Post, .thing.link";
  let selecting = false;
  let selected = [];
  let mutationObserver = null;
  let refreshScheduled = false;
  const styles = document.createElement("style");
  styles.textContent = [
    ".rr-post-picked{outline:2px solid #ff6846!important;outline-offset:3px!important;border-radius:8px!important;}",
    ".rr-selection-on shreddit-post,.rr-selection-on [data-testid='post-container'],",
    ".rr-selection-on article,.rr-selection-on .Post{cursor:crosshair!important;}"
  ].join("");
  document.documentElement.appendChild(styles);

  function parsePost(urlText) {
    if (!urlText) return null;
    try {
      const url = new URL(urlText, location.href);
      if (!/(^|\.)reddit\.com$/i.test(url.hostname)) return null;
      const found = url.pathname.match(POST_RE);
      if (!found) return null;
      return {post_id:found[1].toLowerCase(),url:"https://www.reddit.com/comments/"+found[1].toLowerCase()+"/"};
    } catch (_) { return null; }
  }
  function postFromNode(target) {
    if (!(target instanceof Element)) return null;
    const anchors = [];
    const closestLink = target.closest("a[href*='/comments/']");
    if (closestLink) anchors.push(closestLink);
    let ancestor = target;
    for (let i=0;ancestor && i<10;i++,ancestor=ancestor.parentElement) {
      if (ancestor.matches?.(CARD)) anchors.push(ancestor);
    }
    for (const el of anchors) {
      const possible = [
        el.getAttribute("permalink"),
        el.getAttribute("href"),
        el.getAttribute("data-permalink"),
        el.querySelector?.("a[href*='/comments/']")?.getAttribute("href")
      ];
      for (const link of possible) {
        const post = parsePost(link);
        if (!post) continue;
        const card = el.closest(CARD) || el;
        const heading = card.querySelector?.("h3, h2, [slot='title'], [data-testid='post-title']");
        return {...post,title:(heading?.textContent || document.title || post.post_id).trim().slice(0,170),card};
      }
    }
    return null;
  }

  const host = document.createElement("div");
  host.id = "rr-link-grabber";
  host.style.cssText = "position:fixed;bottom:18px;left:18px;z-index:2147483647;";
  const shadow = host.attachShadow({mode:"open"});
  shadow.innerHTML = [
    '<style>*{box-sizing:border-box} .dock{font:13px system-ui,-apple-system,sans-serif;color:#f5f7fb;background:#101722;',
    'border:1px solid #3a485b;border-radius:16px;padding:10px;max-width:calc(100vw - 36px);',
    'box-shadow:0 10px 35px #0008} .row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
    '.brand{font-weight:800;margin-right:4px;white-space:nowrap}.brand b{color:#ff6846}',
    '.count{background:#263549;color:#d8e4ef;border-radius:18px;padding:6px 9px;font-size:12px;white-space:nowrap}',
    'button{border:1px solid #43536a;border-radius:9px;background:#273549;color:#fff;',
    'font:700 12px system-ui,sans-serif;padding:9px 11px;cursor:pointer}',
    'button:hover{background:#38495f}button.primary{background:#ff6846;border-color:#ff6846}',
    '.on{border-color:#ff6846}.hint{color:#a9bdcf;font-size:11px;padding-top:8px;line-height:1.5}',
    '.collapsed .actions,.collapsed .hint{display:none}.collapsed .row{gap:9px}',
    '</style><div class="dock"><div class="row"><span class="brand"><b>●</b> Reddit Grabber</span>',
    '<span class="count" id="count">0 selected</span><span class="actions">',
    '<button id="mode" class="primary">Select posts</button>',
    '<button id="current" style="display:none">Add this post</button>',
    '<button id="open">Open scraper</button><button id="copy">Copy links</button>',
    '</span><button id="collapse" title="Minimize toolbar" aria-label="Minimize toolbar">−</button>',
    '</div><div id="hint" class="hint">Save links first. Scrape them together when ready.</div></div>'
  ].join("");
  document.documentElement.appendChild(host);
  const $=id=>shadow.getElementById(id);
  const dock=shadow.querySelector(".dock");

  function hint(text) { $("hint").textContent=text; }
  function scheduleHighlight() {
    if (refreshScheduled) return;
    refreshScheduled=true;
    requestAnimationFrame(()=>{refreshScheduled=false;highlight();});
  }
  function highlight() {
    const ids=new Set(selected.map(x=>x.post_id));
    document.querySelectorAll(CARD).forEach(node=>{
      const post = parsePost(node.getAttribute("permalink") ||
        node.getAttribute("data-permalink") ||
        node.querySelector?.("a[href*='/comments/']")?.getAttribute("href"));
      node.classList.toggle("rr-post-picked",!!post&&ids.has(post.post_id));
    });
  }
  function render() {
    $("count").textContent=selected.length+" selected";
    $("current").style.display=parsePost(location.href)?"":"none";
    $("mode").textContent=selecting?"Finish selecting":"Select posts";
    dock.classList.toggle("on",selecting);
    document.documentElement.classList.toggle("rr-selection-on",selecting);
    scheduleHighlight();
  }
  async function togglePost(post) {
    const existing=selected.findIndex(x=>x.post_id===post.post_id);
    if(existing>=0) {
      selected.splice(existing,1);
      hint("Removed thread. "+selected.length+" saved.");
    } else {
      selected.push({post_id:post.post_id,url:post.url,title:post.title});
      hint("Saved! "+selected.length+" threads ready. Click Open scraper when done.");
    }
    await chrome.storage.local.set({selectedPosts:selected});
    render();
  }
  function clickHandler(event) {
    if(!selecting||host.contains(event.target)) return;
    const post=postFromNode(event.target);
    if(!post) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    togglePost(post);
  }
  function setMode(next) {
    selecting=Boolean(next);
    if(selecting) {
      document.addEventListener("click",clickHandler,true);
      mutationObserver=new MutationObserver(scheduleHighlight);
      mutationObserver.observe(document.body,{subtree:true,childList:true});
      hint("Selection ON · Click posts to save their links. Click again to remove.");
    } else {
      document.removeEventListener("click",clickHandler,true);
      mutationObserver?.disconnect();
      mutationObserver=null;
      hint("Links saved. Open scraper to review and extract comments.");
    }
    render();
  }
  $("mode").addEventListener("click",()=>setMode(!selecting));
  $("current").addEventListener("click",()=>{
    const post=parsePost(location.href);
    if(post)togglePost({...post,title:document.title});
  });
  $("open").addEventListener("click",()=>chrome.runtime.sendMessage({type:"OPEN_RESULTS"},r=>{
    if(!r?.ok) hint("Could not open dashboard. Open the extension menu instead.");
  }));
  $("copy").addEventListener("click",async()=>{
    try{
      await navigator.clipboard.writeText(selected.map(x=>x.url).join("\n"));
      hint("Copied "+selected.length+" post links.");
    }catch(_){hint("Clipboard unavailable. Open scraper to copy selected links.");}
  });
  $("collapse").addEventListener("click",()=>{
    dock.classList.toggle("collapsed");
    $("collapse").textContent=dock.classList.contains("collapsed")?"+":"−";
  });
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&selecting)setMode(false);});
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==="local"&&changes.selectedPosts){
      selected=Array.isArray(changes.selectedPosts.newValue)?changes.selectedPosts.newValue:[];
      render();
    }
  });
  chrome.storage.local.get({selectedPosts:[]}).then(values=>{
    selected=Array.isArray(values.selectedPosts)?values.selectedPosts:[];
    render();
  });
  window.addEventListener("popstate",render);
})();