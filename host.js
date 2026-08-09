const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const ytDlpDir = String.raw`C:\yt-dlp`;
const ffmpegBinDir = String.raw`C:\ffmpeg\bin`;
const logFile = path.join(ytDlpDir, "host.log");
const urlsFile = path.join(ytDlpDir, "urls.txt");
const urlsDownloadFolder = path.join(ytDlpDir, "downloads");
const tools = {
    "yt-dlp": {"path": path.join(ytDlpDir, "yt-dlp.exe"), "url": "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"},
    "ffmpeg": {"path": path.join(ffmpegBinDir, "ffmpeg.exe"), "url": "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"},
    "ffplay": {"path": path.join(ffmpegBinDir, "ffplay.exe"), "url": "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"},
    "ffprobe": {"path": path.join(ffmpegBinDir, "ffprobe.exe"), "url": "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"}
};

function log(msg) {
    try {
        const dir = path.dirname(logFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {
                recursive: true
            });
        }
        if (!fs.existsSync(logFile)) {
            fs.writeFileSync(logFile, "");
        }
        fs.appendFileSync(logFile, new Date().toISOString() + " " + (typeof msg === "string" ? msg : JSON.stringify(msg)) + "\n", {
            encoding: 'utf8'
        });
    } catch (err) {
        console.error("log() failed:", err);
        return false;
    }
}

function cleanMessage(message) {
    return (message || "Unknown error occured").normalize("NFKD").replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

log("Host started");

const { execSync, execFile } = require("node:child_process");
if (!require("node:fs").existsSync("node_modules")) {
    log("Installing dependencies...");
    execSync("npm install --no-audit --no-fund", {
        stdio: "ignore"
    });
}
const unzipper = require("unzipper");
const util = require("node:util");
const execAsync = util.promisify(execFile);

function sendResponse(obj) {
    const json = JSON.stringify(obj);
    const buffer = Buffer.alloc(4 + Buffer.byteLength(json));
    buffer.writeUInt32LE(Buffer.byteLength(json), 0);
    buffer.write(json, 4);
    process.stdout.write(buffer);
    log("Response sent: " + json);
}

function extractToolFromZip(tempFile, toolPath, toolName, callback) {
    log(`Extracting ${toolName} from zip`);
    fs.createReadStream(tempFile)
        .pipe(unzipper.Parse())
        .on("entry", entry => {
            const fileName = entry.path;
            if (fileName.endsWith(path.basename(toolPath))) {
                entry.pipe(fs.createWriteStream(toolPath));
            } else {
                entry.autodrain();
            }
        })
        .on("close", () => {
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
            sendResponse({
                message: `${toolName} successfully installed`
            });
            log(`${toolName} extracted to ${toolPath}`);
            callback(null);
        })
        .on("error", err => callback(err));
}

function downloadToFile(url, tempFile, toolPath, toolName, isZip, callback) {
    https.get(url, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            log(`Redirect ${res.statusCode} -> ${res.headers.location}`);
            return downloadToFile(res.headers.location, tempFile, toolPath, toolName, isZip, callback);
        }
        if (res.statusCode !== 200) {
            return callback(new Error("Download failed: " + res.statusCode));
        }
        let file;
        try {
            file = fs.createWriteStream(tempFile);
        } catch (err) {
            log("WriteStream error: " + cleanMessage(err.message));
            return callback(err);
        }
        res.pipe(file);
        file.on("finish", () => {
            file.close(() => {
                log("Download finished: " + tempFile);
                if (!isZip) {
                    sendResponse({
                        message: `${toolName} successfully installed`
                    });
                    return callback(null);
                }
                extractToolFromZip(tempFile, toolPath, toolName, callback);
            });
        });
        file.on("error", err => {
            log("File stream error: " + cleanMessage(err.message));
            callback(err);
        });
    }).on("error", err => {
        log("Download error: " + cleanMessage(err.message));
        fs.unlink(tempFile, () => callback(err));
    });
}

function download(toolName, callback) {
    const tool = tools[toolName];
    const toolPath = tool.path;
    const toolUrl = tool.url;
    const isZip = toolUrl.endsWith(".zip");
    const dir = path.dirname(toolPath);

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {
        recursive: true
    });

    const tempFile = isZip ? path.join(dir, toolName + ".zip") : toolPath;

    log(`Downloading ${toolName} from ${toolUrl}`);
    sendResponse({
        message: `Starting download of ${toolName}...`
    });

    downloadToFile(toolUrl, tempFile, toolPath, toolName, isZip, callback);
}

function installIfNotExists(toolName, callback) {
    const exePath = tools[toolName].path;
    log(`Checking if ${toolName} exists at ${exePath}`);
    if (fs.existsSync(exePath)) {
        sendResponse({
            message: `${toolName} already installed`
        });
        return callback();
    }
    download(toolName, (err) => {
        if (err) {
            const errorMessage = cleanMessage(err.message);
            sendResponse({
                message: `Error installing ${toolName}: ${errorMessage}`
            });
            log(`Installation failed for ${toolName}: ${errorMessage}`);
        }
        callback();
    });
}

function installAllTools() {
    return new Promise((resolve, reject) => {
        try {
            const toolsList = Object.keys(tools);
            let index = 0;
            function next() {
                if (index >= toolsList.length) {
                    sendResponse({
                        message: "ALL_TOOLS_INSTALLED"
                    });
                    resolve();
                    return;
                }
                try {
                    installIfNotExists(toolsList[index++], (err) => {
                        if (err) {
                            reject(err);
                        } else {
                            next();
                        }
                    });
                } catch (err) {
                    reject(err);
                }
            }
            next();
        } catch (err) {
            reject(err);
        }
    });
}

function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    let result = "";
    if (hours > 0) result += `${hours}h`;
    if (minutes > 0) result += `${minutes}m`;
    if (remainingSeconds > 0 || result === "") result += `${remainingSeconds}s`;
    return result;
}

function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(2) + " " + units[i];
}

async function isValidAudio(filePath) {
    const ffprobePath = tools["ffprobe"].path;
    try {
        const { stdout: fileInfoStdout } = await execAsync(ffprobePath,
            [
                "-v", "error",
                "-show_streams",
                "-of", "json",
                filePath
            ], 
            {
                encoding: "utf8"
            }
        );
        const data = JSON.parse(fileInfoStdout);
        return Array.isArray(data.streams) && data.streams.some(s => s.codec_type === "audio");
    } catch (err) {
        log("ffprobe validation error: " + cleanMessage(err.message));
        return false;
    }
}

function readFramedMessage(buffer) {
    if (buffer.length < 4) {
        return null;
    }
    const msgLength = buffer.readUInt32LE(0);
    if (buffer.length < 4 + msgLength) {
        return null;
    }
    return {
        msgText: buffer.slice(4, 4 + msgLength).toString("utf8"),
        rest: buffer.slice(4 + msgLength)
    };
}

async function downloadAudio(ytDlpPath, ffmpegPath, url, urlTitle, urlArtist, urlAlbum, urlGenre) {
    const { stdout } = await execAsync(ytDlpPath,
        [
            "--cookies-from-browser", "firefox",
            "--ffmpeg-location", ffmpegPath,
            "--no-playlist",
            "--encoding", "utf-8",
            "--js-runtimes", "node",
            "--extractor-args", "youtube:player_client=android,web",
            "--concurrent-fragments", "5",
            "--throttled-rate", "100K",
            "--format", "bv*+ba/b",
            "-x",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "--parse-metadata", `:(?P<title>${urlTitle})`,
            "--parse-metadata", `:(?P<artist>${urlArtist})`,
            "--parse-metadata", `:(?P<album>${urlAlbum})`,
            "--parse-metadata", `:(?P<genre>${urlGenre})`,
            "--embed-metadata",
            "--print", "after_move:filepath",
            "--retries", "3",
            "--fragment-retries", "3",
            "--retry-sleep", "3",
            "--windows-filenames",
            "--no-progress",
            "--newline",
            "-o", path.join(urlsDownloadFolder, `${urlTitle}.%(ext)s`),
            url
        ],
        {
            encoding: "utf8",
            maxBuffer: 1024 * 1024 * 50
        }
    );
    return stdout;
}

async function fetchUrlInfo(ytDlpPath, url) {
    const { stdout } = await execAsync(ytDlpPath,
        [
            "--cookies-from-browser", "firefox",
            "--dump-json",
            "--no-playlist",
            "--encoding", "utf-8",
            "--js-runtimes", "node",
            "--extractor-args", "youtube:player_client=android,web",
            url
        ],
        {
            encoding: "utf8"
        }
    );
    return stdout;
}

function isNonFatalError(errorMessage) {
    const NON_FATAL_ERROR_PATTERNS = [
        "Sign in to confirm",
        "Confirm your age",
        "This video is unavailable",
        "Video unavailable",
        "Private video",
        "Unsupported URL",
        "No video formats found",
        "HTTP Error 403",
        "Requested format is not available"
    ];
    return NON_FATAL_ERROR_PATTERNS.some(pattern => errorMessage.includes(pattern));
}

function isMusicFile(json) {
    if (json.categories?.includes("Music")) {
        return true;
    }
    const matchRegexMusic = /\b(officiel|official|audio|clip|lyrics|visualizer)\b/i.test(json.title)
        || /\b(vevo)\b/i.test(json.channel ?? "")
        || /\b(pop|rock|rap|rnb|hip.?hop)\b/i.test((json.tags ?? []).join(" "))
        || /\b(pop|rock|rap|rnb|hip.?hop)\b/i.test(json.description ?? "");
    return !(json.categories?.includes("Education") || !matchRegexMusic || json.duration >= 600); // 600s = 10min, unlikely to be a single song beyond that
}

function resolveUrls(msg) {
    if (msg.urls) {
        log("Using URLs from popup terminal");
        return msg.urls;
    }
    if (!fs.existsSync(urlsFile)) {
        log("urls.txt not found");
        sendResponse({
            type: "NATIVE_DISCONNECT",
            error: "urls.txt not found. Please export your URLs first by clicking the Export button."
        });
        return null;
    }
    log("Using URLs from urls.txt");
    const urls = fs.readFileSync(urlsFile, "utf-8")
        .split(/\r?\n/)
        .filter(Boolean);
    if (urls.length === 0) {
        log("urls.txt empty");
        sendResponse({
            type: "NATIVE_DISCONNECT",
            error: "urls.txt empty. Please export your URLs first by clicking the Export button."
        });
        return null;
    }
    return urls;
}

async function processUrl(url, videoIndex, totalUrls, ytDlpPath, ffmpegPath) {
    const startTime = Date.now();
    let infoFetched = false;
    let isMusic = false;
    try {
        const urlInfoStdout = await fetchUrlInfo(ytDlpPath, url);
        infoFetched = true;
        const json = JSON.parse(urlInfoStdout);
        log(json);
        const urlTitle = json.title.replace(/[\\:*?"<>|/]/g, "_");
        const urlDuration = formatTime(json.duration);
        if (!isMusicFile(json)) {
            log(`Skipped (not music): ${urlTitle} | ${urlDuration}`);
            sendResponse({
                type: "DOWNLOAD_SKIPPED",
                videoIndex,
                totalUrls,
                title: urlTitle,
                reason: "not music"
            });
            return { processed: true, isMusic: false, fatal: false };
        }
        isMusic = true;
        log(`Downloading music: ${urlTitle} | ${urlDuration}`);
        const expectedPath = path.join(urlsDownloadFolder, `${urlTitle}.mp3`);
        if (fs.existsSync(expectedPath)) {
            log("Skipped (already exists)");
            sendResponse({
                type: "DOWNLOAD_SKIPPED",
                videoIndex,
                totalUrls,
                title: urlTitle,
                reason: "already exists"
            });
            return { processed: true, isMusic: true, fatal: false };
        }
        sendResponse({
            type: "DOWNLOAD_START",
            videoIndex,
            totalUrls,
            title: urlTitle
        });
        const urlArtist = (json.artist || json.uploader || "Unknown").replace(/[\\:*?"<>|]/g, "_");
        const urlAlbum = (json.album || json.playlist_title || "Unknown").replace(/[\\:*?"<>|]/g, "_");
        const urlGenre = (json.genre || "Unknown").replace(/[\\:*?"<>|]/g, "_");
        const downloadStdout = await downloadAudio(ytDlpPath, ffmpegPath, url, urlTitle, urlArtist, urlAlbum, urlGenre);
        const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
        log(`Download completed in ${formatTime(elapsedSeconds)}`);
        const filePath = downloadStdout.trim().split("\n").pop();
        if (!fs.existsSync(filePath)) {
            log("Audio file was not created, download failed or skipped");
            sendResponse({
                type: "DOWNLOAD_SKIPPED",
                videoIndex,
                totalUrls,
                title: urlTitle,
                reason: "file not created"
            });
            return { processed: true, isMusic: true, fatal: false };
        }
        const valid = await isValidAudio(filePath);
        if (!valid) {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            log("Invalid audio file, deleting...");
            sendResponse({
                type: "DOWNLOAD_SKIPPED",
                videoIndex,
                totalUrls,
                title: urlTitle,
                reason: "invalid audio"
            });
            return { processed: true, isMusic: true, fatal: false };
        }
        log(`File path -> ${filePath}`);
        log(`Metadata -> Title: ${urlTitle}, Artist: ${urlArtist}, Album: ${urlAlbum}, Genre: ${urlGenre}`);
        const stats = fs.statSync(filePath);
        log(`File size: ${formatBytes(stats.size)}`);
        sendResponse({
            type: "DOWNLOAD_DONE",
            videoIndex,
            totalUrls,
            title: urlTitle
        });
        return { processed: true, isMusic: true, fatal: false };
    } catch (err) {
        const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
        const errorMessage = cleanMessage(err.message);
        log(`Error processing URL ${url} after ${formatTime(elapsedSeconds)}: ${errorMessage}`);
        if (isNonFatalError(errorMessage)) {
            log("Skipped (non‑fatal error)");
            sendResponse({
                type: "DOWNLOAD_ERROR",
                videoIndex,
                totalUrls,
                title: url,
                fatal: false,
                reason: errorMessage
            });
            return { processed: infoFetched, isMusic, fatal: false };
        }
        log("Fatal error");
        sendResponse({
            type: "DOWNLOAD_ERROR",
            videoIndex,
            totalUrls,
            title: url,
            fatal: true,
            reason: errorMessage
        });
        return { processed: infoFetched, isMusic, fatal: true };
    }
}

async function handleInstallCommand(msg) {
    await installAllTools();
    if (!fs.existsSync(urlsDownloadFolder)) {
        fs.mkdirSync(urlsDownloadFolder, {
            recursive: true
        });
    }
    const urls = resolveUrls(msg);
    if (!urls) {
        return false;
    }
    const ytDlpPath = tools["yt-dlp"].path;
    const ffmpegPath = tools["ffmpeg"].path;
    const totalUrls = urls.length;
    log(`Total URLs to process: ${totalUrls}`);
    const startTimeGlobal = Date.now();
    let processedCount = 0;
    let musicCount = 0;
    for (let i = 0; i < urls.length; i++) {
        const videoIndex = i + 1;
        const url = urls[i];
        log(`========== URL ${videoIndex}/${totalUrls} ==========`);
        log(url);
        const result = await processUrl(url, videoIndex, totalUrls, ytDlpPath, ffmpegPath);
        if (result.fatal) {
            return false;
        }
        if (result.processed) {
            processedCount++;
        }
        if (result.isMusic) {
            musicCount++;
        }
    }
    const elapsedSecondsGlobal = Math.floor((Date.now() - startTimeGlobal) / 1000);
    log(`URL processing for ${processedCount}/${totalUrls} videos finished after ${formatTime(elapsedSecondsGlobal)}`);
    log(`Repartition: ${musicCount} videos classified as Music and ${processedCount - musicCount} as Other`);
    sendResponse({
        type: "NATIVE_DISCONNECT",
        error: null
    });
    return true;
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", async (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let frame;
    while ((frame = readFramedMessage(buffer))) {
        const msgText = frame.msgText;
        buffer = frame.rest;
        try {
            const msg = JSON.parse(msgText);
            log("Message: " + JSON.stringify(msg));
            if (msg.command !== "install") {
                log("Unknown command received");
                sendResponse({
                    message: "Unknown command"
                });
                continue;
            }
            if (!(await handleInstallCommand(msg))) {
                return;
            }
        } catch (err) {
            log("JSON parse error: " + cleanMessage(err.message));
        }
    }
});