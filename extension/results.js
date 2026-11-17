/* Two-step research dashboard. Saving links works without any API credentials.
   No scrape is requested except by pressing Scrape selected posts. */
const $=id=>document.getElementById(id);
const BASE="http://127.0.0.1:8765";
const VALID_ID=/^[a-z0-9]{3,12}$/i;
const URLS=/https?:\/\/[^\s"'<>]+/gi;
let savedPosts=[];
let recentComments=[];
let lastState=null;
let runningBatch=false;

function notify(message,error=false){
  $("message").textContent=message;
  $("message").className="status"+(error?" error":" good");
}
function send(type,params={}){
  return new Promise((resolve,reject)=>{
    chrome.runtime.sendMessage({type,...params},reply=>{
      if(chrome.runtime.lastError)return reject(new Error(chrome.runtime.lastError.message));
      if(!reply?.ok)return reject(new Error(reply?.error||"Local collector not connected."));
      resolve(reply.data);
    });
  });
}
async function rawRequest(path,method="GET"){
  const {bridgeToken}=await chrome.storage.local.get("bridgeToken");
  if(!bridgeToken)throw new Error("Enter your local pairing code under Connection setup first.");
  let response;
  try{
    response=await fetch(BASE+path,{
      method,headers:{"X-Research-Token":bridgeToken},
      cache:"no-store",signal:AbortSignal.timeout(15000)
    });
  }catch(_){throw new Error("Could not reach the collector. Start python bridge.py on your computer.");}
  if(!response.ok)throw new Error(response.status===401?"The pairing code is invalid. Save the current code from Python.":(await response.text()).slice(0,240));
  return response;
}
function parsePost(value){
  try{
    const u=new URL(value);
    const host=u.hostname.toLowerCase();
    let match;
    if(host==="redd.it")match=u.pathname.match(/^\/([a-z0-9]{3,12})(?:\/|$)/i);
    else if(host==="reddit.com"||host.endsWith(".reddit.com"))
      match=u.pathname.match(/\/comments\/([a-z0-9]{3,12})(?:\/|$)/i);
    if(!match)return null;
    const post_id=match[1].toLowerCase();
    return {post_id,url:"https://www.reddit.com/comments/"+post_id+"/",title:"Reddit post "+post_id};
  }catch(_){return null;}
}
async function storeSaved(){
  await chrome.storage.local.set({selectedPosts:savedPosts});
  renderSaved();
}
function renderSaved(){
  const container=$("post-list");
  container.replaceChildren();
  $("link-count").textContent=savedPosts.length+" "+(savedPosts.length===1?"link":"links");
  $("scrape").disabled=!savedPosts.length||runningBatch;
  $("copy-links").disabled=!savedPosts.length;
  $("clear-links").disabled=!savedPosts.length;
  if(!savedPosts.length){
    const empty=document.createElement("div");empty.className="empty";
    empty.textContent="No saved links. Open Reddit and click Select posts, or paste links below.";
    container.append(empty);return;
  }
  for(const post of savedPosts){
    const item=document.createElement("div");item.className="post";
    const description=document.createElement("div");description.className="description";
    const title=document.createElement("b");title.textContent=post.title||"Reddit post "+post.post_id;
    title.title=post.title||post.post_id;
    const anchor=document.createElement("a");anchor.href=post.url;anchor.target="_blank";anchor.rel="noopener noreferrer";
    anchor.textContent="Open Reddit post · "+post.post_id;
    description.append(title,anchor);
    const remove=document.createElement("button");remove.className="ghost";remove.textContent="Remove";
    remove.setAttribute("aria-label","Remove "+post.post_id);
    remove.addEventListener("click",async()=>{
      savedPosts=savedPosts.filter(row=>row.post_id!==post.post_id);
      await storeSaved();
    });
    item.append(description,remove);container.append(item);
  }
}
async function loadSaved(){
  const data=await chrome.storage.local.get({selectedPosts:[]});
  savedPosts=Array.isArray(data.selectedPosts)?data.selectedPosts.filter(x=>x&&VALID_ID.test(x.post_id)): [];
  renderSaved();
}
function drawComments(){
  const container=$("comments-list");
  const search=$("search").value.trim().toLowerCase();
  const theme=$("theme").value;
  const filtered=recentComments.filter(row=>
    (!theme||(row.themes||"").split(" | ").includes(theme)) &&
    (!search||(String(row.comment||"")+" "+String(row.post_title||"")).toLowerCase().includes(search))
  );
  container.replaceChildren();
  $("result-count").textContent="Showing "+filtered.length+" of the latest "+recentComments.length+
    " comments. Exports include every collected comment.";
  if(!filtered.length){
    const empty=document.createElement("div");empty.className="empty";
    empty.textContent=recentComments.length?"No comments match these filters.":"No comments yet. Click Scrape selected posts above.";
    container.append(empty);return;
  }
  for(const row of filtered){
    const card=document.createElement("article");card.className="comment";
    const top=document.createElement("div");top.className="meta";
    const title=document.createElement("span");title.textContent=String(row.subreddit||"Reddit")+" · "+String(row.post_title||"Thread").slice(0,80);
    const score=document.createElement("span");score.textContent=Number(row.score||0)+" points";
    top.append(title,score);
    const body=document.createElement("p");body.textContent=String(row.comment||"");
    const bottom=document.createElement("div");bottom.className="meta";
    const link=document.createElement("a");
    const url=String(row.comment_url||"");
    link.href=/^https:\/\/(?:www\.|old\.|new\.)?reddit\.com\//i.test(url)?url:"https://www.reddit.com/";
    link.target="_blank";link.rel="noopener noreferrer";link.textContent="View original comment";
    const tags=document.createElement("span");tags.className="tags";
    for(const name of String(row.themes||"").split(" | ").filter(Boolean)){
      const tag=document.createElement("span");tag.className="tag";tag.textContent=name;tags.append(tag);
    }
    bottom.append(link,tags);card.append(top,body,bottom);container.append(card);
  }
}
function displayState(state){
  lastState=state;
  $("comments").textContent=Number(state.comments||0).toLocaleString();
  $("completed").textContent=Number(state.completed||0);
  $("queued").textContent=Number(state.queued||0);
  const total=Number(state.selected||0),processed=Number(state.completed||0)+Number(state.failed||0);
  $("progress").style.width=(total?Math.min(100,Math.round(100*processed/total)):0)+"%";
  $("activity").textContent=state.running?
    "Collecting "+(state.current||"queued threads")+" · "+state.queued+" waiting":
    state.failed>0?"Finished with "+state.failed+" errors. See activity log.":
    state.completed>0?"Collection complete. Export your comments below.":"Nothing scraped yet.";
  $("log").textContent=(state.events||[]).join("\n")||"No jobs queued.";
  const themeSelect=$("theme"),current=themeSelect.value;
  const names=Object.keys(state.themes||{});
  themeSelect.replaceChildren(new Option("All research themes",""));
  for(const name of names)themeSelect.add(new Option(name,name));
  themeSelect.value=names.includes(current)?current:"";
}
async function refresh(){
  const token=(await chrome.storage.local.get({bridgeToken:""})).bridgeToken;
  if(!token){
    $("connection").textContent="Not paired · Links can still be saved";
    $("connection").className="status";
    return;
  }
  try{
    const health=await send("PING");
    $("connection").textContent=health.reddit_credentials_configured?
      "Connected · Reddit API configured":"Connected · Reddit API credentials missing in .env";
    $("connection").className="status "+(health.reddit_credentials_configured?"good":"error");
    const state=await send("STATE");
    displayState(state);
    const data=await send("ROWS");
    recentComments=data.rows||[];
    drawComments();
  }catch(error){
    $("connection").textContent=error.message;
    $("connection").className="status error";
  }
}

$("copy-links").addEventListener("click",async()=>{
  try{await navigator.clipboard.writeText(savedPosts.map(p=>p.url).join("\n"));notify("Copied "+savedPosts.length+" Reddit links.");}
  catch(_){notify("Could not access the clipboard.",true);}
});
$("clear-links").addEventListener("click",async()=>{
  if(!confirm("Remove all saved links? Scraped results will remain until reset."))return;
  savedPosts=[];await storeSaved();notify("Saved link list cleared.");
});
$("add-links").addEventListener("click",async()=>{
  const input=$("paste-links").value,found=[];
  for(const url of input.match(URLS)||[]){
    const parsed=parsePost(url.replace(/[),.;]+$/,""));
    if(parsed&&!savedPosts.some(x=>x.post_id===parsed.post_id)&&!found.some(x=>x.post_id===parsed.post_id))
      found.push(parsed);
  }
  if(!found.length){notify("No new valid Reddit post links found.",true);return;}
  savedPosts.push(...found);await storeSaved();$("paste-links").value="";
  notify("Added "+found.length+" Reddit post links.");
});
$("save-token").addEventListener("click",async()=>{
  const value=$("bridge-token").value.trim();
  if(!value){notify("Paste the pairing code printed when you ran python bridge.py.",true);return;}
  await chrome.storage.local.set({bridgeToken:value});
  notify("Pairing code saved. Checking collector connection…");await refresh();
});
$("scrape").addEventListener("click",async()=>{
  if(!savedPosts.length){notify("Add Reddit post links first.",true);return;}
  runningBatch=true;renderSaved();
  try{
    const health=await send("PING");
    if(!health.reddit_credentials_configured)throw new Error("The collector is running, but you still need approved Reddit OAuth credentials in your local .env file.");
    const posts=savedPosts.slice();
    let queued=0,already=0,failed=0,firstError="";
    notify("Queuing "+posts.length+" selected Reddit threads…");
    for(const post of posts){
      try{
        const answer=await send("QUEUE_POST",{post_id:post.post_id});
        if(answer.queued)queued++;else already++;
      }catch(error){failed++;if(!firstError)firstError=error.message;}
    }
    if(failed)notify("Queued "+queued+" threads; "+failed+" failed. "+firstError,true);
    else notify(queued+" threads queued for extraction"+(already?" · "+already+" already queued":"")+".");
    await refresh();
  }catch(error){notify(error.message,true);$("connection-details").open=true;}
  finally{runningBatch=false;renderSaved();}
});
$("stop").addEventListener("click",async()=>{
  try{await send("STOP");notify("Stopped queued jobs. The active request may still finish.");await refresh();}
  catch(error){notify(error.message,true);}
});
$("clear-results").addEventListener("click",async()=>{
  if(!confirm("Reset the scraper's collected comments? Your saved links will remain."))return;
  try{
    await send("CLEAR");recentComments=[];drawComments();await refresh();
    notify("Scraped results reset. Saved Reddit links remain available.");
  }catch(error){notify(error.message,true);}
});
async function download(kind,name){
  try{
    const response=await rawRequest("/api/export/"+kind);
    const blob=await response.blob();
    const objectUrl=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=objectUrl;a.download=name;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),10000);notify("Downloaded "+name);
  }catch(error){notify(error.message,true);}
}
$("csv").addEventListener("click",()=>download("csv","reddit-comments.csv"));
$("json").addEventListener("click",()=>download("json","reddit-comments.json"));
$("markdown").addEventListener("click",()=>download("markdown","reddit-research.md"));
$("txt").addEventListener("click",()=>download("txt","reddit-comments.txt"));
$("search").addEventListener("input",drawComments);
$("theme").addEventListener("change",drawComments);
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==="local"&&changes.selectedPosts)loadSaved();
});
(async()=>{
  await loadSaved();
  const {bridgeToken}=await chrome.storage.local.get({bridgeToken:""});
  $("bridge-token").value=bridgeToken;
  await refresh();
})();
setInterval(()=>{if(document.visibilityState==="visible")refresh();},3500); // status only, never scrapes
