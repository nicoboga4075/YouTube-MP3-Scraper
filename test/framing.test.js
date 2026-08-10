"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFramedMessage } = require("../host.js");
const { freshHost } = require("../test-helpers/env.js");

function frame(obj) {
    const json = JSON.stringify(obj);
    const buf = Buffer.alloc(4 + Buffer.byteLength(json));
    buf.writeUInt32LE(Buffer.byteLength(json), 0);
    buf.write(json, 4);
    return buf;
}

test("readFramedMessage", async (t) => {
    await t.test("returns null when fewer than 4 bytes are available", () => {
        assert.equal(readFramedMessage(Buffer.alloc(0)), null);
        assert.equal(readFramedMessage(Buffer.alloc(3)), null);
    });

    await t.test("returns null when the header is complete but the body is not", () => {
        const full = frame({ hello: "world" });
        const partial = full.subarray(0, full.length - 1);
        assert.equal(readFramedMessage(partial), null);
    });

    await t.test("parses a single complete message and returns an empty rest", () => {
        const buf = frame({ command: "install" });
        const result = readFramedMessage(buf);
        assert.deepEqual(JSON.parse(result.msgText), { command: "install" });
        assert.equal(result.rest.length, 0);
    });

    await t.test("a zero-length message body parses to an empty string", () => {
        const buf = Buffer.alloc(4);
        buf.writeUInt32LE(0, 0);
        const result = readFramedMessage(buf);
        assert.equal(result.msgText, "");
        assert.equal(result.rest.length, 0);
    });

    await t.test("leaves extra bytes (a second message) in rest", () => {
        const first = frame({ a: 1 });
        const second = frame({ b: 2 });
        const combined = Buffer.concat([first, second]);

        const firstResult = readFramedMessage(combined);
        assert.deepEqual(JSON.parse(firstResult.msgText), { a: 1 });

        const secondResult = readFramedMessage(firstResult.rest);
        assert.deepEqual(JSON.parse(secondResult.msgText), { b: 2 });
        assert.equal(secondResult.rest.length, 0);
    });
});

test("sendResponse", async (t) => {
    await t.test("writes a 4-byte little-endian length prefix followed by the JSON payload", (t) => {
        const { host, sentResponses } = freshHost(t);
        host.sendResponse({ type: "NATIVE_DISCONNECT", error: null });
        assert.equal(sentResponses.length, 1);
        assert.deepEqual(sentResponses[0], { type: "NATIVE_DISCONNECT", error: null });
    });
});
