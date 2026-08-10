"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { freshHost } = require("./helpers/env.js");

test("isValidAudio", async (t) => {
    await t.test("true when ffprobe reports an audio stream", async (t) => {
        const { host } = freshHost(t, {
            execFile: async () => ({ stdout: JSON.stringify({ streams: [{ codec_type: "video" }, { codec_type: "audio" }] }) })
        });
        assert.equal(await host.isValidAudio("C:\\file.mp3"), true);
    });

    await t.test("false when there is no audio stream", async (t) => {
        const { host } = freshHost(t, {
            execFile: async () => ({ stdout: JSON.stringify({ streams: [{ codec_type: "video" }] }) })
        });
        assert.equal(await host.isValidAudio("C:\\file.mp3"), false);
    });

    await t.test("false when streams is missing entirely", async (t) => {
        const { host } = freshHost(t, {
            execFile: async () => ({ stdout: JSON.stringify({}) })
        });
        assert.equal(await host.isValidAudio("C:\\file.mp3"), false);
    });

    await t.test("false (not a throw) when ffprobe itself fails", async (t) => {
        const { host } = freshHost(t, {
            execFile: async () => {
                throw new Error("ffprobe: command not found");
            }
        });
        assert.equal(await host.isValidAudio("C:\\file.mp3"), false);
    });

    await t.test("false when ffprobe returns malformed JSON", async (t) => {
        const { host } = freshHost(t, {
            execFile: async () => ({ stdout: "not json" })
        });
        assert.equal(await host.isValidAudio("C:\\file.mp3"), false);
    });
});
