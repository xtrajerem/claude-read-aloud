chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "cra-read", title: "Read aloud", contexts: ["selection", "page"] });
});

// Send to the page's player; inject it first on sites where it isn't loaded yet.
async function send(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tabId, msg);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab && tab.id) send(tab.id, { type: "readSelection" }).catch(() => {});
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  send(tab.id, { type: cmd === "stop-reading" ? "stop" : "toggle" }).catch(() => {});
});
