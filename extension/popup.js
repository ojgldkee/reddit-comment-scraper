const $=id=>document.getElementById(id);
async function refresh(){
  const data=await chrome.storage.local.get({selectedPosts:[]});
  $("count").textContent=(data.selectedPosts||[]).length;
  $("copy").disabled=!(data.selectedPosts||[]).length;
}
$("open").addEventListener("click",()=>{
  chrome.tabs.create({url:chrome.runtime.getURL("results.html")});
  window.close();
});
$("copy").addEventListener("click",async()=>{
  const data=await chrome.storage.local.get({selectedPosts:[]});
  const links=(data.selectedPosts||[]).map(p=>p.url).join("\n");
  try{await navigator.clipboard.writeText(links);$("message").textContent="Copied "+data.selectedPosts.length+" links.";}
  catch(e){$("message").textContent="Clipboard unavailable. Open the dashboard instead.";}
});
chrome.storage.onChanged.addListener(refresh);
refresh();