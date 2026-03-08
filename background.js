let nativePort = null;
let popupPort = null;

function isYouTubeHost(url) {
    return url?.startsWith("https://www.youtube.com/") ?? false;
}

function updateActionState(tabId, url) {
    if (isYouTubeHost(url)) {
        chrome.action.enable(tabId);
    } else {
        chrome.action.disable(tabId);
    }
}

chrome.action.disable();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" || !tab.url) return;
    updateActionState(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    const tab = await chrome.tabs.get(tabId);
    updateActionState(tabId, tab.url);
});

// Connexion from popup
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "popup") {
        popupPort = port;
        port.onDisconnect.addListener(() => {
            popupPort = null;
        });
        port.onMessage.addListener((msg) => {
            if (msg.command === "handcheck") {
                port.postMessage({
                    message: "HANDCHECK_OK"
                });
                return;
            }
            if (msg.command === "install") {
                if (nativePort) {
                    nativePort.disconnect();
                    nativePort = null;
                }
                nativePort = chrome.runtime.connectNative("com.example.ytdlp_installer");
                nativePort.onMessage.addListener((nativeMsg) => {
                    if (popupPort) popupPort.postMessage(nativeMsg);
                });
                nativePort.onDisconnect.addListener(() => {
                    if (popupPort) popupPort.postMessage({
                        type: "NATIVE_DISCONNECT",
                        error: chrome.runtime.lastError?.message || null
                    });
                    nativePort = null;
                });
                nativePort.postMessage(msg);
            }
        });
    }
});