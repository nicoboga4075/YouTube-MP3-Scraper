"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { formatTime, formatBytes, cleanMessage } = require("../host.js");

test("formatTime", async (t) => {
    await t.test("0 seconds -> 0s", () => {
        assert.equal(formatTime(0), "0s");
    });

    await t.test("seconds only", () => {
        assert.equal(formatTime(45), "45s");
    });

    await t.test("minutes and seconds", () => {
        assert.equal(formatTime(65), "1m5s");
    });

    await t.test("exact minute has no trailing 0s (remainingSeconds === 0 and result non-empty)", () => {
        assert.equal(formatTime(60), "1m");
    });

    await t.test("hours, minutes and seconds", () => {
        assert.equal(formatTime(3661), "1h1m1s");
    });

    await t.test("exact hour has no trailing 0m0s", () => {
        assert.equal(formatTime(3600), "1h");
    });

    await t.test("hours and seconds, no minutes", () => {
        assert.equal(formatTime(3605), "1h5s");
    });
});

test("formatBytes", async (t) => {
    await t.test("0 -> '0 B'", () => {
        assert.equal(formatBytes(0), "0 B");
    });

    await t.test("falsy values also short-circuit to '0 B'", () => {
        assert.equal(formatBytes(undefined), "0 B");
        assert.equal(formatBytes(null), "0 B");
        assert.equal(formatBytes(NaN), "0 B");
    });

    await t.test("bytes", () => {
        assert.equal(formatBytes(500), "500.00 B");
    });

    await t.test("kilobytes", () => {
        assert.equal(formatBytes(1024), "1.00 KB");
    });

    await t.test("megabytes", () => {
        assert.equal(formatBytes(1024 * 1024 * 2.5), "2.50 MB");
    });

    await t.test("gigabytes", () => {
        assert.equal(formatBytes(1024 * 1024 * 1024 * 1.5), "1.50 GB");
    });
});

test("cleanMessage", async (t) => {
    await t.test("passes through a normal message", () => {
        assert.equal(cleanMessage("hello world"), "hello world");
    });

    await t.test("falls back to a default for falsy input", () => {
        assert.equal(cleanMessage(undefined), "Unknown error occured");
        assert.equal(cleanMessage(null), "Unknown error occured");
        assert.equal(cleanMessage(""), "Unknown error occured");
    });

    await t.test("strips control characters", () => {
        assert.equal(cleanMessage("badbellchar"), "badbellchar");
    });

    await t.test("keeps accented characters (NFKD decomposes them but does not strip them)", () => {
        // cleanMessage normalizes to NFKD, which decomposes "é" into "e" +
        // a combining acute accent — same rendered text, different code
        // points. Round-tripping back to NFC must recover the original.
        const input = "Vidéo non disponible";
        assert.equal(cleanMessage(input).normalize("NFC"), input);
    });
});
