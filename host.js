const https = require("https");
const fs = require("fs");
const path = require("path");
const logFile = "C:\\yt-dlp\\host.log";
const tools = { 
	"yt-dlp": {"path": "C:\\yt-dlp\\yt-dlp.exe", "url": "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"},
	"ffmpeg": {"path": "C:\\ffmpeg\\bin\\ffmpeg.exe", "url": "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"},
	"ffplay": {"path": "C:\\ffmpeg\\bin\\ffplay.exe", "url": "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"},
	"ffprobe": {"path": "C:\\ffmpeg\\bin\\ffprobe.exe", "url": "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"}
};
const urlsFile = "C:\\yt-dlp\\urls.txt";
const urlsDownloadFolder = "C:\\yt-dlp\\downloads";

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
        return false;
    }
}

function cleanMessage(message) {
    return (message || "").normalize("NFKD").replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

log("Host started");

const { execSync, execFile } = require("child_process");
if (!require("fs").existsSync("node_modules")) {
    log("Installing dependencies...");
    execSync("npm install --no-audit --no-fund", {
        stdio: "ignore"
    });
}
const unzipper = require("unzipper");
const util = require("util");
const execAsync = util.promisify(execFile);

function sendResponse(obj) {
    const json = JSON.stringify(obj);
    const buffer = Buffer.alloc(4 + Buffer.byteLength(json));
    buffer.writeUInt32LE(Buffer.byteLength(json), 0);
    buffer.write(json, 4);
    process.stdout.write(buffer);
    log("Response sent: " + json);
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

    function startDownload(url) {
        https.get(url, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                log(`Redirect ${res.statusCode} -> ${res.headers.location}`);
                return startDownload(res.headers.location);
            }
            if (res.statusCode !== 200) {
                return callback(new Error("Download failed: " + res.statusCode));
            }
            let file;
            try {
                file = fs.createWriteStream(tempFile);
            } catch (err) {
                log("WriteStream error: " + err.message);
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
                });
            });
            file.on("error", err => {
                log("File stream error: " + err.message);
                callback(err);
            });
        }).on("error", err => {
            log("Download error: " + err.message);
            fs.unlink(tempFile, () => callback(err));
        });
    }
    startDownload(toolUrl);
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
            sendResponse({
                message: `Error installing ${toolName}: ${err.message}`
            });
            log(`Installation failed for ${toolName}: ${err.message}`);
        }
        callback();
    });
}

function installAllTools() {
    return new Promise((resolve) => {
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
            installIfNotExists(toolsList[index++], next);
        }
        next();
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
        const {
            stdout: infoStdout
        } = await execAsync(ffprobePath,
            [
                "-v", "error",
                "-show_streams",
                "-of", "json",
                filePath
            ], {
                encoding: "utf8"
            }
        );
        const data = JSON.parse(infoStdout);
        const hasAudio = Array.isArray(data.streams) && data.streams.some(s => s.codec_type === "audio");
        if (!hasAudio) return false;
        return true;
    } catch (err) {
        log("ffprobe validation error: " + err.message);
        return false;
    }
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", async chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
        const msgLength = buffer.readUInt32LE(0);
        if (buffer.length < 4 + msgLength) break;
        const msgBuffer = buffer.slice(4, 4 + msgLength);
        const msgText = msgBuffer.toString("utf8");
        buffer = buffer.slice(4 + msgLength);
        try {
            const msg = JSON.parse(msgText);
            log("Message: " + JSON.stringify(msg));
            if (msg.command === "install") {
                await installAllTools();
                if (!fs.existsSync(urlsDownloadFolder)) {
                    fs.mkdirSync(urlsDownloadFolder, {
                        recursive: true
                    });
                }
                if (!fs.existsSync(urlsFile)) {
                    log("urls.txt not found");
                    sendResponse({
                        type: "NATIVE_DISCONNECT",
                        error: "urls.txt not found. Please export your URLs first by clicking the Export button."
                    });
                    return;
                }
                const urls = fs.readFileSync(urlsFile, "utf-8")
                    .split(/\r?\n/)
                    .filter(Boolean);
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
                    const startTime = Date.now();
                    try {
                        const {
                            stdout: dlStdout
                        } = await execAsync(ytDlpPath,
                            [
                                "--cookies-from-browser", "firefox",
                                "--dump-json",
                                "--encoding", "utf-8",
                                "--js-runtimes", "node",
                                "--extractor-args", "youtube:player_client=android,web",
                                url
                            ], {
                                encoding: "utf8"
                            }
                        );
                        processedCount++;
                        const json = JSON.parse(dlStdout);
                        const urlTitle = json.title.replace(/[\/\\:*?"<>|]/g, "_");
                        const urlDuration = formatTime(json.duration);
                        if (!json.categories?.includes("Music")) {
                            log(`Skipped (not music): ${urlTitle} | ${urlDuration}`);
                            sendResponse({
                                type: "DOWNLOAD_SKIPPED",
                                videoIndex,
                                totalUrls,
                                title: urlTitle,
                                reason: "not music"
                            });
                            continue;
                        }
                        musicCount++;
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
                            continue;
                        }
                        sendResponse({
                            type: "DOWNLOAD_START",
                            videoIndex,
                            totalUrls,
                            title: urlTitle
                        });
                        const urlArtist = (json.artist || json.uploader || "Unknown").replace(/[\/\\:*?"<>|]/g, "_");
                        const urlAlbum = (json.album || json.playlist_title || "Unknown").replace(/[\/\\:*?"<>|]/g, "_");
                        const urlGenre = (json.genre || "Music").replace(/[\/\\:*?"<>|]/g, "_");
                        const {
                            stdout: downloadStdout
                        } = await execAsync(ytDlpPath,
                            [
                                "--cookies-from-browser", "firefox",
                                "--ffmpeg-location", ffmpegPath,
                                "--encoding", "utf-8",
                                "--js-runtimes", "node",
                                "--extractor-args", "youtube:player_client=android,web",
                                "--concurrent-fragments", "5",
                                "--throttled-rate", "100K",
                                "--format", "bv*+ba/b",
                                "-x",
                                "--audio-format", "mp3",
                                "--audio-quality", "0",
                                "--parse-metadata", `title:${urlTitle}`,
                                "--parse-metadata", `artist:${urlArtist}`,
                                "--parse-metadata", `album:${urlAlbum}`,
                                "--parse-metadata", `genre:${urlGenre}`,
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
                            ], {
                                encoding: "utf8",
                                maxBuffer: 1024 * 1024 * 50
                            }
                        );
                        const endTime = Date.now();
                        const elapsedSeconds = Math.floor((endTime - startTime) / 1000);
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
                            continue;
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
                            continue;
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

                    } catch (err) {
                        const endTime = Date.now();
                        const elapsedSeconds = Math.floor((endTime - startTime) / 1000);
                        const message = cleanMessage(err.message);
                        log(`Error processing URL ${url} after ${formatTime(elapsedSeconds)}: ${message}`);
                        if (
                            message.includes("Sign in to confirm") ||
                            message.includes("Confirm your age") ||
                            message.includes("This video is unavailable") ||
                            message.includes("Video unavailable") ||
                            message.includes("Private video") ||
                            message.includes("Unsupported URL") ||
                            message.includes("No video formats found") ||
                            message.includes("HTTP Error 403") ||
                            message.includes("Requested format is not available")
                        ) {
                            log("Skipped (non‑fatal error)");
                            sendResponse({
                                type: "DOWNLOAD_ERROR",
                                videoIndex,
                                totalUrls,
                                title: url,
                                fatal: false,
                                reason: message
                            });
                            continue;
                        }
                        log("Fatal error");
                        sendResponse({
                            type: "DOWNLOAD_ERROR",
                            videoIndex,
                            totalUrls,
                            title: url,
                            fatal: true,
                            reason: message
                        });
                        break;
                    }
                }
                const endTimeGlobal = Date.now();
                const elapsedSecondsGlobal = Math.floor((endTimeGlobal - startTimeGlobal) / 1000);
                log(`URL processing for ${processedCount}/${totalUrls} videos finished after ${formatTime(elapsedSecondsGlobal)}`);
                log(`Repartition: ${musicCount} videos classified as Music and ${processedCount - musicCount} as Other`);
                sendResponse({
                    type: "NATIVE_DISCONNECT",
                    error: null
                });
            } else {
                log("Unknown command received");
                sendResponse({
                    message: "Unknown command"
                });
            }
        } catch (err) {
            log("JSON parse error: " + err.message);
        }
    }
});