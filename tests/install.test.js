"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { freshHost } = require("./helpers/env.js");

test("installIfNotExists", async (t) => {
    await t.test("skips downloading when the tool already exists", async (t) => {
        const { host, sentResponses } = freshHost(t, {
            existsSync: () => true
        });
        let callbackErr = "not called";
        await new Promise((resolve) => {
            host.installIfNotExists("yt-dlp", (err) => {
                callbackErr = err;
                resolve();
            });
        });
        assert.equal(callbackErr, undefined);
        assert.equal(sentResponses.length, 1);
        assert.match(sentResponses[0].message, /already installed/);
    });

    await t.test("downloads the tool and reports the error message when the download fails", async (t) => {
        const { host, sentResponses } = freshHost(t, {
            existsSync: () => false,
            httpsGet: () => ({ statusCode: 500 })
        });
        await new Promise((resolve) => {
            host.installIfNotExists("yt-dlp", () => resolve());
        });
        const errorMsg = sentResponses.find((r) => r.message?.includes("Error installing"));
        assert.ok(errorMsg, "expected an 'Error installing' response");
        assert.match(errorMsg.message, /500/);
    });
});

test("installAllTools", async (t) => {
    await t.test("resolves and announces ALL_TOOLS_INSTALLED when every tool is already present", async (t) => {
        const { host, sentResponses } = freshHost(t, {
            existsSync: () => true
        });
        await host.installAllTools();
        assert.equal(sentResponses.filter((r) => r.message === "ALL_TOOLS_INSTALLED").length, 1);
        assert.equal(sentResponses.filter((r) => r.message?.includes("already installed")).length, 4);
    });

    await t.test("still resolves and reports each failure when every tool fails to install", async (t) => {
        // installIfNotExists always calls its own callback with no error
        // (it only reports the failure via sendResponse), so a download
        // failure never rejects installAllTools() — it just logs the error
        // per tool and moves on to the next one. This documents that
        // existing behavior rather than asserting a rejection.
        const { host, sentResponses } = freshHost(t, {
            existsSync: () => false,
            httpsGet: () => ({ requestError: new Error("network down") })
        });
        await host.installAllTools();
        const errorMessages = sentResponses.filter((r) => r.message?.includes("Error installing"));
        assert.equal(errorMessages.length, 4);
        assert.ok(errorMessages.every((r) => r.message.includes("network down")));
        assert.equal(sentResponses.filter((r) => r.message === "ALL_TOOLS_INSTALLED").length, 1);
    });
});
