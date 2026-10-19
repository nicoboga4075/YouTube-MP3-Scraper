"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { freshHost } = require("./helpers/env.js");

test("resolveUrls", async (t) => {
    await t.test("uses msg.urls when present, without touching urls.txt", (t) => {
        const existsCalls = [];
        const { host } = freshHost(t, {
            existsSync: (p) => {
                existsCalls.push(p);
                return true;
            }
        });
        const urls = host.resolveUrls({ urls: ["https://a", "https://b"] });
        assert.deepEqual(urls, ["https://a", "https://b"]);
        assert.ok(!existsCalls.some((p) => p.includes("urls.txt")));
    });

    await t.test("returns null and sends NATIVE_DISCONNECT when urls.txt does not exist", (t) => {
        const { host, sentResponses } = freshHost(t, {
            existsSync: (p) => !p.includes("urls.txt")
        });
        const urls = host.resolveUrls({});
        assert.equal(urls, null);
        assert.equal(sentResponses.length, 1);
        assert.equal(sentResponses[0].type, "NATIVE_DISCONNECT");
        assert.match(sentResponses[0].error, /not found/);
    });

    await t.test("returns null and sends NATIVE_DISCONNECT when urls.txt is empty after filtering blank lines", (t) => {
        const { host, sentResponses } = freshHost(t, {
            existsSync: () => true,
            readFileSync: () => "\r\n\n\r\n"
        });
        const urls = host.resolveUrls({});
        assert.equal(urls, null);
        assert.equal(sentResponses[0].type, "NATIVE_DISCONNECT");
        assert.match(sentResponses[0].error, /empty/);
    });

    await t.test("returns the filtered, split list of URLs from urls.txt", (t) => {
        const { host } = freshHost(t, {
            existsSync: () => true,
            readFileSync: () => "https://a\r\nhttps://b\n\nhttps://c\r\n"
        });
        const urls = host.resolveUrls({});
        assert.deepEqual(urls, ["https://a", "https://b", "https://c"]);
    });
});
