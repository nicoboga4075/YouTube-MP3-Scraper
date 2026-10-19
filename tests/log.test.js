"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { freshHost } = require("./helpers/env.js");

test("log", async (t) => {
    await t.test("appends a timestamped line when the log directory/file already exist", (t) => {
        const calls = [];
        const { host } = freshHost(t, {
            existsSync: () => true,
            appendFileSync: (...args) => calls.push(args)
        });
        const result = host.log("hello");
        assert.equal(calls.length, 1);
        assert.match(calls[0][1], /^\d{4}-\d{2}-\d{2}T.*hello\n$/);
        assert.notEqual(result, false);
    });

    await t.test("creates the log directory and file when missing", (t) => {
        const existsCalls = [];
        const mkdirCalls = [];
        const writeCalls = [];
        const { host } = freshHost(t, {
            existsSync: (p) => {
                existsCalls.push(p);
                return false;
            },
            mkdirSync: (...args) => mkdirCalls.push(args),
            writeFileSync: (...args) => writeCalls.push(args),
            appendFileSync: () => {}
        });
        host.log("hi");
        assert.equal(mkdirCalls.length, 1);
        assert.equal(writeCalls.length, 1);
    });

    await t.test("serializes non-string messages as JSON", (t) => {
        const calls = [];
        const { host } = freshHost(t, {
            existsSync: () => true,
            appendFileSync: (...args) => calls.push(args)
        });
        host.log({ foo: "bar" });
        assert.match(calls[0][1], /\{"foo":"bar"\}\n$/);
    });

    await t.test("swallows fs errors and reports them via console.error instead of throwing", (t) => {
        const consoleErrorCalls = [];
        t.mock.method(console, "error", (...args) => consoleErrorCalls.push(args));
        const { host } = freshHost(t, {
            existsSync: () => {
                throw new Error("disk exploded");
            }
        });
        const result = host.log("hello");
        assert.equal(result, false);
        assert.equal(consoleErrorCalls.length, 1);
        assert.equal(consoleErrorCalls[0][0], "log() failed:");
    });
});
