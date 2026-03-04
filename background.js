let nativePort = null;
let popupPort = null;

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
                    const error = chrome.runtime.lastError;
                    if (popupPort) popupPort.postMessage({
                        type: "NATIVE_DISCONNECT",
                        error: error?.message || null
                    });
                    nativePort = null;
                });
                nativePort.postMessage({
                    command: "install"
                });
            }
        });
    }
});