"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { freshHost } = require("../test-helpers/env.js");

function runDownload(host, toolName) {
    return new Promise((resolve) => {
        host.download(toolName, (err) => resolve(err));
    });
}

test("download", async (t) => {
    await t.test("a non-zip tool (yt-dlp) downloads and reports success", async (t) => {
        const { host, sentResponses } = freshHost(t, {
            existsSync: () => true, // parent dir already exists
            httpsGet: () => ({ statusCode: 200 })
        });
        const err = await runDownload(host, "yt-dlp");
        assert.equal(err, null);
        const messages = sentResponses.map((r) => r.message);
        assert.ok(messages.some((m) => m.includes("Starting download")));
        assert.ok(messages.some((m) => m.includes("successfully installed")));
    });

    await t.test("creates the parent directory when it does not exist", async (t) => {
        const mkdirCalls = [];
        const { host } = freshHost(t, {
            existsSync: () => false,
            mkdirSync: (...args) => mkdirCalls.push(args),
            httpsGet: () => ({ statusCode: 200 })
        });
        await runDownload(host, "yt-dlp");
        assert.equal(mkdirCalls.length >= 1, true);
    });

    await t.test("a zip tool (ffmpeg) is extracted, and the matching entry is written to the tool path", async (t) => {
        let unlinked = null;
        const { host, sentResponses } = freshHost(t, {
            existsSync: () => true,
            httpsGet: () => ({ statusCode: 200 }),
            unzipEntries: () => ({
                entries: [
                    { path: "ffmpeg-release/doc/readme.txt" },
                    { path: "ffmpeg-release/bin/ffmpeg.exe" }
                ]
            }),
            unlinkSync: (p) => { unlinked = p; }
        });
        const err = await runDownload(host, "ffmpeg");
        assert.equal(err, null);
        assert.ok(unlinked && unlinked.endsWith(".zip"), "the downloaded zip must be cleaned up");
        const messages = sentResponses.map((r) => r.message).filter(Boolean);
        assert.equal(messages.filter((m) => m.includes("successfully installed")).length, 1);
    });

    await t.test("follows a redirect before downloading", async (t) => {
        const requestedUrls = [];
        const { host } = freshHost(t, {
            existsSync: () => true,
            httpsGet: (url) => {
                requestedUrls.push(url);
                if (requestedUrls.length === 1) {
                    return { statusCode: 302, headers: { location: "https://mirror.example/yt-dlp.exe" } };
                }
                return { statusCode: 200 };
            }
        });
        const err = await runDownload(host, "yt-dlp");
        assert.equal(err, null);
        assert.equal(requestedUrls.length, 2);
        assert.equal(requestedUrls[1], "https://mirror.example/yt-dlp.exe");
    });

    await t.test("a non-200 status is reported as an error", async (t) => {
        const { host } = freshHost(t, {
            existsSync: () => true,
            httpsGet: () => ({ statusCode: 404 })
        });
        const err = await runDownload(host, "yt-dlp");
        assert.ok(err instanceof Error);
        assert.match(err.message, /404/);
    });

    await t.test("a network-level request error is forwarded to the callback", async (t) => {
        const { host } = freshHost(t, {
            existsSync: () => true,
            httpsGet: () => ({ requestError: new Error("getaddrinfo ENOTFOUND") })
        });
        const err = await runDownload(host, "yt-dlp");
        assert.ok(err instanceof Error);
        assert.match(err.message, /ENOTFOUND/);
    });

    await t.test("a synchronous fs.createWriteStream failure is forwarded to the callback", async (t) => {
        const { host } = freshHost(t, {
            existsSync: () => true,
            httpsGet: () => ({ statusCode: 200 }),
            createWriteStreamThrows: new Error("EACCES: permission denied")
        });
        const err = await runDownload(host, "yt-dlp");
        assert.ok(err instanceof Error);
        assert.match(err.message, /EACCES/);
    });

    await t.test("a write-stream error after piping is forwarded to the callback", async (t) => {
        const { host } = freshHost(t, {
            existsSync: () => true,
            httpsGet: () => ({ statusCode: 200, writeError: new Error("ENOSPC: no space left") })
        });
        const err = await runDownload(host, "yt-dlp");
        assert.ok(err instanceof Error);
        assert.match(err.message, /ENOSPC/);
    });

    await t.test("a non-matching zip entry is autodrained instead of written to disk", async (t) => {
        const writeStreamPaths = [];
        const { host } = freshHost(t, {
            existsSync: () => true,
            httpsGet: () => ({ statusCode: 200 }),
            unzipEntries: () => ({ entries: [{ path: "unrelated/file.txt" }] }),
            createWriteStream: (p) => writeStreamPaths.push(p)
        });
        const err = await runDownload(host, "ffmpeg");
        assert.equal(err, null);
        // Only the initial .zip temp file write stream should have been created,
        // never one for the tool's final .exe path (the entry didn't match).
        assert.ok(!writeStreamPaths.some((p) => String(p).endsWith(".exe")));
    });

    await t.test("an extraction error is forwarded to the callback", async (t) => {
        const { host } = freshHost(t, {
            existsSync: () => true,
            httpsGet: () => ({ statusCode: 200 }),
            unzipEntries: () => {
                throw new Error("corrupt archive");
            }
        });
        const err = await runDownload(host, "ffmpeg");
        assert.ok(err instanceof Error);
        assert.match(err.message, /corrupt archive/);
    });
});
