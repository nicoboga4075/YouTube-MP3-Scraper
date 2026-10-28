"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { freshHost } = require("./helpers/env.js");

test("fetchUrlInfo", async (t) => {
    await t.test("returns the --dump-json stdout of yt-dlp", async (t) => {
        const { host } = freshHost(t, {
            execFile: async (file, args) => {
                assert.ok(args.includes("--dump-json"));
                return { stdout: "{\"id\":\"T6oZEzwd0vw\"}" };
            }
        });
        assert.equal(await host.fetchUrlInfo("C:\\yt-dlp\\yt-dlp.exe", "https://www.youtube.com/watch?v=T6oZEzwd0vw"), "{\"id\":\"T6oZEzwd0vw\"}");
    });

    await t.test("raises maxBuffer above the 1 MiB default for large metadata", async (t) => {
        let options;
        const { host } = freshHost(t, {
            execFile: async (file, args, opts) => {
                options = opts;
                return { stdout: "{}" };
            }
        });
        await host.fetchUrlInfo("C:\\yt-dlp\\yt-dlp.exe", "https://www.youtube.com/watch?v=T6oZEzwd0vw");
        assert.ok(options.maxBuffer > 1024 * 1024);
    });
});
