async function send(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    try { await chrome.tabs.sendMessage(tab.id, msg); }
    catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      await chrome.tabs.sendMessage(tab.id, msg);
    }
    window.close();
  } catch {
    document.getElementById("err").textContent = "Can't run on this page (browser pages and the extension store are off-limits).";
  }
}
document.getElementById("read").onclick = () => send({ type: "toggle" });
document.getElementById("stop").onclick = () => send({ type: "stop" });
document.getElementById("settings").onclick = () => send({ type: "openSettings" });

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = ""; try { host = new URL(tab.url).hostname; } catch {}
  const btn = document.getElementById("site");
  if (!host) { btn.hidden = true; return; }
  const render = (off) => { btn.textContent = off ? `✅ Enable on ${host}` : `🚫 Disable on ${host}`; };
  let { disabledSites = [] } = await chrome.storage.local.get({ disabledSites: [] });
  render(disabledSites.includes(host));
  btn.onclick = async () => {
    const set = new Set(disabledSites);
    set.has(host) ? set.delete(host) : set.add(host);
    disabledSites = [...set];
    await chrome.storage.local.set({ disabledSites });
    render(set.has(host));
  };
})();
