const bgPort = chrome.runtime.connect({
    name: "popup"
});

bgPort.onMessage.addListener((msg) => {
    if (msg.message === "HANDCHECK_OK") {
        outputTerminal.value = "> Waiting for you.\n";
        statusTerminal.textContent = `Status: Idle`;
        return;
    }
    if (msg.type === "NATIVE_DISCONNECT") {
        if (msg.error) {
            outputTerminal.value += "> " + msg.error + "\n";
            statusTerminal.textContent = `Status: Error`;
            hideProgress();
        } else {
            statusTerminal.textContent = `Status: Success`;
        }
        installBtn.disabled = false;
        scanBtn.disabled = false;
        return;
    }
    if (msg.type === "DOWNLOAD_START") {
        const percent = Math.round((msg.videoIndex - 1) / msg.totalUrls * 100);
        showProgress(
            `⬇ [${msg.videoIndex}/${msg.totalUrls}] ${msg.title}`,
            percent,
            `${msg.videoIndex}/${msg.totalUrls}`
        );
        outputTerminal.value += `> ⬇ ${msg.title}\n`;
        outputTerminal.scrollTop = outputTerminal.scrollHeight;
        return;
    }
    if (msg.type === "DOWNLOAD_DONE") {
        const {
            videoIndex,
            totalUrls,
            title
        } = msg;
        showProgress(`[${videoIndex}/${totalUrls}] ${title}`, 100, "Done ✓");
        outputTerminal.value += `> ✓ ${title}\n`;
        outputTerminal.scrollTop = outputTerminal.scrollHeight;
        return;
    }
    if (msg.type === "DOWNLOAD_SKIPPED") {
        const percent = Math.round(msg.videoIndex / msg.totalUrls * 100);
        showProgress(`⏭ ${msg.title}`, percent, `${msg.videoIndex}/${msg.totalUrls}`);
        outputTerminal.value += `> ⏭ ${msg.title} (${msg.reason})\n`;
        outputTerminal.scrollTop = outputTerminal.scrollHeight;
        return;
    }
    if (msg.type === "DOWNLOAD_ERROR") {
        showProgress(`❌ ${msg.title}`, msg.videoIndex, msg.totalUrls);
        outputTerminal.value += `> ❌ ${msg.title}\n> ${msg.reason}\n`;
        outputTerminal.scrollTop = outputTerminal.scrollHeight;
        if (msg.fatal) {
            statusTerminal.textContent = `Status: Fatal error — downloads stopped`;
        }
        return;
    }
    if (msg.message === "ALL_TOOLS_INSTALLED") {
        statusTerminal.textContent = `Status: Tools installation finished`;
        let lines = outputTerminal.value.split("\n");
        lines.shift();
        outputTerminal.value = lines.join("\n");
        outputTerminal.value += "\n";
        showProgress("", 0, "");
        statusTerminal.textContent = 'Status: ⏳ Downloading MP3...';
        return;
    }
    if (msg.message) {
        outputTerminal.value += "> " + msg.message + "\n";
        outputTerminal.scrollTop = outputTerminal.scrollHeight;
    }
});

bgPort.onDisconnect.addListener(() => {
    if (chrome.runtime.lastError) {
        outputTerminal.value += "> " + chrome.runtime.lastError.message + "\n";
        statusTerminal.textContent = `Status: Error`;
        fetch(chrome.runtime.getURL("host.log"))
            .then(res => res.text())
            .then(text => {
                const lines = text.trim().split("\n");
                const lastRecord = lines[lines.length - 1];
                if (lastRecord.toLowerCase().includes('node') || lastRecord.includes('fichier de commandes.') || lastRecord.includes('batch file.')) {
                    outputTerminal.value += "> Check if Node.js is installed and well recognized or used on your laptop.\n";
                }
            });
    } else {
        statusTerminal.textContent = `Status: Idle`;
    }
    installBtn.disabled = false;
    scanBtn.disabled = false;
});

bgPort.postMessage({
    command: "handcheck"
});

function cleanMessage(message) {
    return (message || "").normalize("NFKD").replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

function showProgress(label, percent, meta) {
    progressContainer.style.display = "block";
    progressLabel.textContent = label;
    progressPercent.textContent = `${percent}%`;
    progressBar.style.width = `${percent}%`;
    progressMeta.textContent = meta || "";
}

function hideProgress() {
    progressContainer.style.display = "none";
    progressBar.style.width = "0%";
}

async function runScraper() {
    try {
        hideProgress();
        scanBtn.disabled = true;
        saveBtn.disabled = true;
        installBtn.disabled = true;
        outputTerminal.value = "> Please wait...\n";
        statusTerminal.textContent = `Status: Scanning`;
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });
        chrome.runtime.onMessage.addListener(function listener(msg, sender, sendResponse) {
            if (msg.type === "YT_SCRAPER_PROGRESS") {
                statusTerminal.textContent = `Status: ${msg.count} videos detected...`;
            }
        });
        chrome.scripting.executeScript({
            target: {
                tabId: tab.id
            },
            func: async () => {
                function cleanUrl(url) {
                    try {
                        const u = new URL(url);
                        const uri = 'https://www.youtube.com/watch?v=';
                        if (u.hostname.includes("youtu.be")) return `${uri}${u.pathname.slice(1)}`;
                        const v = u.searchParams.get("v");
                        return v ? `${uri}${v}` : null;
                    } catch {
                        return null;
                    }
                }

                function durationToMinutes(durationStr) {
                    if (!durationStr) return 0;
                    const parts = durationStr.split(':').map(p => parseInt(p.trim(), 10));
                    if (parts.length === 2) { // mm:ss
                        return parts[0] + parts[1] / 60;
                    } else if (parts.length === 3) { // hh:mm:ss
                        return parts[0] * 60 + parts[1] + parts[2] / 60;
                    }
                    return 0;
                }
                return new Promise((resolve, reject) => {
                    try {
                        const seenVideos = new Map();

                        let lastCount = 0;
                        let sameCountTime = 0;
                        const checkInterval = 500;
                        const maxIdle = 4000;
                        const step = () => {
                            try {
                                window.scrollBy(0, 3000);
                                document.querySelectorAll('ytd-playlist-video-renderer').forEach(el => {
                                    const a = el.querySelector('a#video-title');
                                    if (!a) return;
                                    const url = cleanUrl(a.href);
                                    if (!url) return;
                                    const title = a.textContent.trim();
                                    const artist = el.querySelector('ytd-channel-name #text a')?.textContent.trim();
                                    const duration = el.querySelector('ytd-thumbnail-overlay-time-status-renderer')?.textContent.trim().split('\n')[0].trim();
                                    seenVideos.set(url, {
                                        url,
                                        title,
                                        artist,
                                        duration
                                    });
                                });
                                chrome.runtime.sendMessage({
                                    type: "YT_SCRAPER_PROGRESS",
                                    count: seenVideos.size
                                });
                                if (seenVideos.size === lastCount) {
                                    sameCountTime += checkInterval;
                                } else {
                                    lastCount = seenVideos.size;
                                    sameCountTime = 0;
                                }
                                if (sameCountTime >= maxIdle) {
                                    const results = [...seenVideos.values()];
                                    resolve(results);
                                } else {
                                    setTimeout(step, checkInterval);
                                }
                            } catch (err) {
                                reject(err);
                            }
                        };
                        step();
                    } catch (err) {
                        reject(err);
                    }
                });
            }
        }, (results) => {
            if (!results || !results[0]) {
                outputTerminal.value = "> " + chrome.runtime.lastError.message + "\n";
                statusTerminal.textContent = `Status: Error`;
                return;
            }
            window.scraperResults = results[0].result;
            const urls = results[0].result.map(result => result.url);
            outputTerminal.value = urls.join("\n");
            statusTerminal.textContent = `Status: ${urls.length} videos found`;
            saveBtn.disabled = urls.length === 0;
            scanBtn.disabled = false;
            installBtn.disabled = false;
        });
    } catch (err) {
        outputTerminal.value += "> " + cleanMessage(err.message) + "\n";
        statusTerminal.textContent = `Status: Error`;
        scanBtn.disabled = false;
        installBtn.disabled = false;
    }
}

closeBtn.addEventListener("click", () => {window.close()});

scanBtn.addEventListener("click", runScraper);

saveBtn.addEventListener("click", () => {
    try {
        hideProgress();
        const lines = outputTerminal.value.split("\n").filter(Boolean);
        if (!lines.length || lines.length === 0) return;
        const blob = new Blob([lines.join("\n")], {
            type: "text/plain"
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "urls.txt";
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        outputTerminal.value += "> " + cleanMessage(err.message) + "\n";
        statusTerminal.textContent = `Status: Error`;
    }
});

installBtn.addEventListener("click", () => {
    installBtn.disabled = true;
    scanBtn.disabled = true;
    saveBtn.disabled = true;
    const lines = (outputTerminal.value || "")
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.startsWith("https://"));
    const payload = lines.length > 0
      ? { command: "install", urls: lines }
      : { command: "install" };
    outputTerminal.value = "> Installation of Node.js if needed and tools...\n";
    statusTerminal.textContent = `Status: Installation pending...`;
    bgPort.postMessage(payload);
});