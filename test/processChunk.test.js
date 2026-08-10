"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { freshHost } = require("../test-helpers/env.js");

function frame(obj) {
    const json = JSON.stringify(obj);
    const buf = Buffer.alloc(4 + Buffer.byteLength(json));
    buf.writeUInt32LE(Buffer.byteLength(json), 0);
    buf.write(json, 4);
    return buf;
}

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

test("processChunk", async (t) => {
    await t.test("a fatal error on one install command does not prevent a later buffered message from being processed", async (t) => {
        let dumpJsonCalls = 0;
        const { host, sentResponses } = freshHost(t, {
            existsSync: toolsAlreadyInstalledExistsSync(),
            execFile: async (file, args) => {
                if (args.includes("--dump-json")) {
                    dumpJsonCalls++;
                    if (dumpJsonCalls === 1) throw new Error("ECONNRESET");
                    return { stdout: musicInfo("Song B") };
                }
                if (args.includes("--audio-format")) return { stdout: "C:\\yt-dlp\\downloads\\Song B.mp3\n" };
                if (args.includes("-show_streams")) return { stdout: JSON.stringify({ streams: [{ codec_type: "audio" }] }) };
                throw new Error("unexpected execFile call");
            }
        });

        const fatalInstall = frame({ command: "install", urls: ["https://a"] });
        const secondInstall = frame({ command: "install", urls: ["https://b"] });
        const chunk = Buffer.concat([fatalInstall, secondInstall]);

        await host.processChunk(chunk);

        assert.equal(dumpJsonCalls, 2, "both install commands should have been attempted");
        assert.ok(
            sentResponses.some((r) => r.type === "DOWNLOAD_DONE"),
            "the second, independent install command must still complete"
        );
        assert.ok(
            sentResponses.some((r) => r.type === "DOWNLOAD_ERROR" && r.fatal === true),
            "the fatal error from the first command must still have been reported"
        );
    });

    await t.test("an unknown command is answered and does not block the next buffered message", async (t) => {
        const { host, sentResponses } = freshHost(t, {
            existsSync: toolsAlreadyInstalledExistsSync(),
            execFile: async (file, args) => {
                if (args.includes("--dump-json")) return { stdout: musicInfo("Song") };
                if (args.includes("--audio-format")) return { stdout: "C:\\yt-dlp\\downloads\\Song.mp3\n" };
                if (args.includes("-show_streams")) return { stdout: JSON.stringify({ streams: [{ codec_type: "audio" }] }) };
                throw new Error("unexpected execFile call");
            }
        });

        const unknown = frame({ command: "handcheck" });
        const install = frame({ command: "install", urls: ["https://a"] });
        const chunk = Buffer.concat([unknown, install]);

        await host.processChunk(chunk);

        assert.deepEqual(sentResponses[0], { message: "Unknown command" });
        assert.ok(sentResponses.some((r) => r.type === "DOWNLOAD_DONE"));
    });

    await t.test("malformed JSON is logged and does not stop processing of the next buffered message", async (t) => {
        const { host, sentResponses } = freshHost(t, {
            existsSync: toolsAlreadyInstalledExistsSync()
        });

        const badJson = Buffer.from("not json");
        const badFrame = Buffer.alloc(4 + badJson.length);
        badFrame.writeUInt32LE(badJson.length, 0);
        badJson.copy(badFrame, 4);

        const unknown = frame({ command: "handcheck" });
        const chunk = Buffer.concat([badFrame, unknown]);

        await host.processChunk(chunk);

        assert.deepEqual(sentResponses, [{ message: "Unknown command" }]);
    });

    await t.test("carries a partial message across two calls (chunk split mid-frame)", async (t) => {
        const { host, sentResponses } = freshHost(t, {
            existsSync: toolsAlreadyInstalledExistsSync()
        });

        const full = frame({ command: "handcheck" });
        const firstHalf = full.subarray(0, 3);
        const secondHalf = full.subarray(3);

        await host.processChunk(firstHalf);
        assert.equal(sentResponses.length, 0, "an incomplete frame must not be processed yet");

        await host.processChunk(secondHalf);
        assert.deepEqual(sentResponses, [{ message: "Unknown command" }]);
    });
});
