"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { freshHost } = require("../test-helpers/env.js");

const YT_DLP = "C:\\yt-dlp\\yt-dlp.exe";
const FFMPEG = "C:\\ffmpeg\\bin\\ffmpeg.exe";
const URL = "https://www.youtube.com/watch?v=abc123";
const DOWNLOADED_PATH = "C:\\yt-dlp\\downloads\\Test Song.mp3";

function musicInfo(overrides = {}) {
    return JSON.stringify({
        title: "Test Song",
        duration: 200,
        categories: ["Music"],
        artist: "Test Artist",
        album: "Test Album",
        genre: "Pop",
        ...overrides
    });
}

function execFileFor({ dumpJson, ffprobe, download, downloadError }) {
    return async (file, args) => {
        if (args.includes("--dump-json")) {
            if (dumpJson instanceof Error) throw dumpJson;
            return { stdout: dumpJson };
        }
        if (args.includes("-show_streams")) {
            return { stdout: ffprobe };
        }
        if (args.includes("--audio-format")) {
            if (downloadError) throw downloadError;
            return { stdout: download + "\n" };
        }
        throw new Error("Unexpected execFile call with args: " + JSON.stringify(args));
    };
}

test("processUrl", async (t) => {
    await t.test("skips a non-music video without downloading", async (t) => {
        const { host, sentResponses } = freshHost(t, {
            execFile: execFileFor({ dumpJson: musicInfo({ categories: [], title: "Vlog", duration: 900 }) }),
            existsSync: () => false
        });
        const result = await host.processUrl(URL, 1, 1, YT_DLP, FFMPEG);
        assert.deepEqual(result, { processed: true, isMusic: false, fatal: false });
        assert.equal(sentResponses.length, 1);
        assert.equal(sentResponses[0].type, "DOWNLOAD_SKIPPED");
        assert.equal(sentResponses[0].reason, "not music");
    });

    await t.test("skips a music video whose mp3 already exists on disk", async (t) => {
        const { host, sentResponses } = freshHost(t, {
            execFile: execFileFor({ dumpJson: musicInfo() }),
            existsSync: (p) => String(p).endsWith(".mp3")
        });
        const result = await host.processUrl(URL, 1, 1, YT_DLP, FFMPEG);
        assert.deepEqual(result, { processed: true, isMusic: true, fatal: false });
        assert.equal(sentResponses.length, 1);
        assert.equal(sentResponses[0].reason, "already exists");
    });

    await t.test("sanitizes forbidden filename characters out of the title", async (t) => {
        const existsCalls = [];
        const { host } = freshHost(t, {
            execFile: execFileFor({ dumpJson: musicInfo({ title: 'Weird: Title/Name*?"<>|' }) }),
            existsSync: (p) => {
                existsCalls.push(String(p));
                return String(p).endsWith(".mp3");
            }
        });
        await host.processUrl(URL, 1, 1, YT_DLP, FFMPEG);
        const mp3Check = existsCalls.find((p) => p.endsWith(".mp3"));
        assert.ok(mp3Check, "expected an existsSync check against a sanitized .mp3 path");
        assert.ok(!/[\\:*?"<>|/]/.test(mp3Check.replace(/^.*[\\/]/, "")), `filename should be sanitized, got: ${mp3Check}`);
    });

    await t.test("reports DOWNLOAD_SKIPPED when the file was not created after download", async (t) => {
        const { host, sentResponses } = freshHost(t, {
            execFile: execFileFor({ dumpJson: musicInfo(), download: DOWNLOADED_PATH }),
            existsSync: () => false
        });
        const result = await host.processUrl(URL, 1, 1, YT_DLP, FFMPEG);
        assert.deepEqual(result, { processed: true, isMusic: true, fatal: false });
        const skipped = sentResponses.find((r) => r.type === "DOWNLOAD_SKIPPED");
        assert.equal(skipped.reason, "file not created");
    });

    await t.test("deletes and reports DOWNLOAD_SKIPPED for an invalid (non-audio) downloaded file", async (t) => {
        const unlinked = [];
        // First .mp3 existsSync check is the pre-download "already exists?"
        // guard (must be false); every check after that (post-download file
        // check, then the unlink guard) refers to the file the download
        // actually produced, so it must be true.
        let mp3ExistsCallCount = 0;
        const { host, sentResponses } = freshHost(t, {
            execFile: execFileFor({
                dumpJson: musicInfo(),
                download: DOWNLOADED_PATH,
                ffprobe: JSON.stringify({ streams: [{ codec_type: "video" }] })
            }),
            existsSync: (p) => {
                if (!String(p).endsWith(".mp3")) return false;
                mp3ExistsCallCount++;
                return mp3ExistsCallCount > 1;
            },
            unlinkSync: (p) => unlinked.push(p)
        });
        const result = await host.processUrl(URL, 1, 1, YT_DLP, FFMPEG);
        assert.deepEqual(result, { processed: true, isMusic: true, fatal: false });
        const skipped = sentResponses.find((r) => r.type === "DOWNLOAD_SKIPPED");
        assert.equal(skipped.reason, "invalid audio");
        assert.deepEqual(unlinked, [DOWNLOADED_PATH]);
    });

    await t.test("full success path sends DOWNLOAD_START then DOWNLOAD_DONE", async (t) => {
        // processUrl checks fs.existsSync twice for a .mp3 path: once before
        // downloading (must be false, "not already downloaded") and once after
        // (must be true, "the download produced the expected file").
        let mp3ExistsCallCount = 0;
        const { host, sentResponses } = freshHost(t, {
            execFile: execFileFor({
                dumpJson: musicInfo(),
                download: DOWNLOADED_PATH,
                ffprobe: JSON.stringify({ streams: [{ codec_type: "audio" }] })
            }),
            existsSync: (p) => {
                if (!String(p).endsWith(".mp3")) return false;
                mp3ExistsCallCount++;
                return mp3ExistsCallCount > 1;
            },
            statSync: () => ({ size: 123456 })
        });
        const result = await host.processUrl(URL, 1, 1, YT_DLP, FFMPEG);
        assert.deepEqual(result, { processed: true, isMusic: true, fatal: false });
        const types = sentResponses.map((r) => r.type);
        assert.deepEqual(types, ["DOWNLOAD_START", "DOWNLOAD_DONE"]);
    });

    await t.test("a non-fatal error during metadata fetch is reported with processed:false", async (t) => {
        const { host, sentResponses } = freshHost(t, {
            execFile: execFileFor({ dumpJson: new Error("Private video") })
        });
        const result = await host.processUrl(URL, 1, 1, YT_DLP, FFMPEG);
        assert.deepEqual(result, { processed: false, isMusic: false, fatal: false });
        assert.equal(sentResponses[0].type, "DOWNLOAD_ERROR");
        assert.equal(sentResponses[0].fatal, false);
        assert.equal(sentResponses[0].title, URL);
    });

    await t.test("a non-fatal error during download is reported with processed:true, isMusic:true", async (t) => {
        const { host, sentResponses } = freshHost(t, {
            execFile: execFileFor({ dumpJson: musicInfo(), downloadError: new Error("HTTP Error 403: Forbidden") }),
            existsSync: () => false
        });
        const result = await host.processUrl(URL, 1, 1, YT_DLP, FFMPEG);
        assert.deepEqual(result, { processed: true, isMusic: true, fatal: false });
        const errorResponse = sentResponses.find((r) => r.type === "DOWNLOAD_ERROR");
        assert.equal(errorResponse.fatal, false);
    });

    await t.test("an unrecognized error during download is fatal", async (t) => {
        const { host, sentResponses } = freshHost(t, {
            execFile: execFileFor({ dumpJson: musicInfo(), downloadError: new Error("ECONNRESET") }),
            existsSync: () => false
        });
        const result = await host.processUrl(URL, 1, 1, YT_DLP, FFMPEG);
        assert.deepEqual(result, { processed: true, isMusic: true, fatal: true });
        const errorResponse = sentResponses.find((r) => r.type === "DOWNLOAD_ERROR");
        assert.equal(errorResponse.fatal, true);
    });
});
