"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { freshHost } = require("../test-helpers/env.js");

function toolsAlreadyInstalledExistsSync() {
    // .exe tool paths: always "already installed". For .mp3 paths,
    // processUrl always checks existsSync exactly twice per URL: once
    // before downloading (must be false) and once after (must be true) —
    // so alternating false/true by call count works regardless of the
    // exact path string. This also sidesteps host.js's Windows-style
    // hardcoded paths producing different separators on Linux CI than on
    // a local Windows run, which broke an earlier exact-path-based tracker.
    let mp3Calls = 0;
    return (p) => {
        const s = String(p);
        if (s.endsWith(".exe")) return true;
        if (s.endsWith(".mp3")) {
            mp3Calls++;
            return mp3Calls % 2 === 0;
        }
        return false;
    };
}

function musicInfo(title) {
    return JSON.stringify({ title, duration: 200, categories: ["Music"] });
}

function execFileFor(byTitle) {
    return async (file, args) => {
        if (args.includes("--dump-json")) {
            const url = args[args.length - 1];
            return { stdout: musicInfo(byTitle[url] ?? "Song") };
        }
        if (args.includes("--audio-format")) {
            return { stdout: "C:\\yt-dlp\\downloads\\Song.mp3\n" };
        }
        if (args.includes("-show_streams")) {
            return { stdout: JSON.stringify({ streams: [{ codec_type: "audio" }] }) };
        }
        throw new Error("Unexpected execFile call: " + JSON.stringify(args));
    };
}

test("handleInstallCommand", async (t) => {
    await t.test("returns false without processing any URL when urls cannot be resolved", async (t) => {
        // handleInstallCommand always runs installAllTools() first, so a few
        // "already installed" responses are expected before the failure.
        const { host, sentResponses } = freshHost(t, {
            existsSync: toolsAlreadyInstalledExistsSync()
        });
        const result = await host.handleInstallCommand({});
        assert.equal(result, false);
        const last = sentResponses[sentResponses.length - 1];
        assert.equal(last.type, "NATIVE_DISCONNECT");
        assert.match(last.error, /not found/);
        assert.ok(!sentResponses.some((r) => r.type?.startsWith("DOWNLOAD_")));
    });

    await t.test("processes every url and sends a final NATIVE_DISCONNECT on full success", async (t) => {
        const { host, sentResponses } = freshHost(t, {
            existsSync: toolsAlreadyInstalledExistsSync(),
            execFile: execFileFor({ "https://a": "Song A", "https://b": "Song B" })
        });
        const result = await host.handleInstallCommand({ urls: ["https://a", "https://b"] });
        assert.equal(result, true);
        const doneCount = sentResponses.filter((r) => r.type === "DOWNLOAD_DONE").length;
        assert.equal(doneCount, 2);
        const last = sentResponses[sentResponses.length - 1];
        assert.deepEqual(last, { type: "NATIVE_DISCONNECT", error: null });
    });

    await t.test("stops processing remaining urls after a fatal error and returns false", async (t) => {
        let dumpJsonCalls = 0;
        const { host, sentResponses } = freshHost(t, {
            existsSync: toolsAlreadyInstalledExistsSync(),
            execFile: async (file, args) => {
                if (args.includes("--dump-json")) {
                    dumpJsonCalls++;
                    if (dumpJsonCalls === 1) {
                        throw new Error("ECONNRESET");
                    }
                    return { stdout: musicInfo("Should not be reached") };
                }
                throw new Error("Unexpected execFile call: " + JSON.stringify(args));
            }
        });
        const result = await host.handleInstallCommand({ urls: ["https://a", "https://b"] });
        assert.equal(result, false);
        assert.equal(dumpJsonCalls, 1, "the second URL must never be fetched after a fatal error");
        assert.ok(!sentResponses.some((r) => r.type === "NATIVE_DISCONNECT"));
    });

    await t.test("creates the downloads folder when it does not exist yet", async (t) => {
        const mkdirCalls = [];
        const { host } = freshHost(t, {
            existsSync: toolsAlreadyInstalledExistsSync(),
            mkdirSync: (...args) => mkdirCalls.push(args),
            execFile: execFileFor({ "https://a": "Song A" })
        });
        await host.handleInstallCommand({ urls: ["https://a"] });
        assert.ok(mkdirCalls.some((call) => String(call[0]).includes("downloads")));
    });
});
