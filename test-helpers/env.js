"use strict";

const fs = require("node:fs");
const https = require("node:https");
const child_process = require("node:child_process");
const util = require("node:util");
const { EventEmitter } = require("node:events");
const unzipper = require("unzipper");

const HOST_PATH = require.resolve("../host.js");
const REAL_EXEC_FILE = child_process.execFile;
const REAL_PROMISIFY = util.promisify.bind(util);

class FakeStream extends EventEmitter {
    close(cb) {
        if (cb) process.nextTick(cb);
    }
    autodrain() {
        // Intentionally empty: mimics unzipper's entry.autodrain(), which
        // just discards a non-matching zip entry's data — there's no real
        // stream content here for the fake to drain.
    }
}

/**
 * Mocks every external side-effecting dependency host.js touches (fs,
 * https, child_process.execFile, unzipper, process.stdout) and returns a
 * freshly `require`d instance of host.js wired to those mocks. Each test
 * gets its own isolated instance (module cache is busted) and mocks are
 * auto-restored by node:test at the end of the test via t.mock.
 */
function freshHost(t, overrides = {}) {
    const state = {
        existsSync: () => false,
        readFileSync: () => "",
        writeFileSync: () => {},
        appendFileSync: () => {},
        mkdirSync: () => {},
        unlinkSync: () => {},
        unlink: () => {},
        statSync: () => ({ size: 0 }),
        execFile: async () => ({ stdout: "", stderr: "" }),
        httpsGet: () => ({ statusCode: 200, headers: {} }),
        unzipEntries: () => ({ entries: [] }),
        ...overrides
    };

    // host.js builds execAsync via `util.promisify(execFile)` once at module
    // load time. child_process.execFile can't be mocked directly: node:test's
    // mock.method copies the real execFile's own (non-writable,
    // non-configurable) util.promisify.custom symbol onto its wrapper, so
    // util.promisify still resolves to the real, process-spawning
    // implementation no matter what replacement function we pass in.
    // Intercepting util.promisify itself and only special-casing the exact
    // call host.js makes (promisify(execFile)) sidesteps that entirely.
    t.mock.method(util, "promisify", (fn) => {
        if (fn === REAL_EXEC_FILE) {
            return (file, args, options) => Promise.resolve().then(() => state.execFile(file, args, options));
        }
        return REAL_PROMISIFY(fn);
    });

    // Node's own CJS loader uses fs.readFileSync/existsSync internally to
    // locate and read host.js's source before compiling it. Mocking those
    // BEFORE the require() below would make Node try to compile our fake
    // return values as JavaScript instead of host.js's real source — so
    // every other mock is installed only after the module is loaded.
    delete require.cache[HOST_PATH];
    const host = require(HOST_PATH);

    t.mock.method(fs, "existsSync", (...a) => state.existsSync(...a));
    t.mock.method(fs, "readFileSync", (...a) => state.readFileSync(...a));
    t.mock.method(fs, "writeFileSync", (...a) => state.writeFileSync(...a));
    t.mock.method(fs, "appendFileSync", (...a) => state.appendFileSync(...a));
    t.mock.method(fs, "mkdirSync", (...a) => state.mkdirSync(...a));
    t.mock.method(fs, "unlinkSync", (...a) => state.unlinkSync(...a));
    t.mock.method(fs, "statSync", (...a) => state.statSync(...a));
    t.mock.method(fs, "unlink", (targetPath, callback) => {
        state.unlink(targetPath);
        process.nextTick(callback);
    });

    t.mock.method(fs, "createWriteStream", (targetPath) => {
        if (state.createWriteStreamThrows) {
            throw state.createWriteStreamThrows;
        }
        if (state.createWriteStream) {
            state.createWriteStream(targetPath);
        }
        return new FakeStream();
    });

    t.mock.method(fs, "createReadStream", () => {
        const rs = new FakeStream();
        rs.pipe = (dest) => dest;
        return rs;
    });

    t.mock.method(unzipper, "Parse", () => {
        const stream = new FakeStream();
        process.nextTick(() => {
            let behavior;
            try {
                behavior = state.unzipEntries();
            } catch (err) {
                stream.emit("error", err);
                return;
            }
            for (const entry of behavior.entries || []) {
                const entryStream = new FakeStream();
                entryStream.path = entry.path;
                entryStream.pipe = (dest) => dest;
                stream.emit("entry", entryStream);
            }
            stream.emit("close");
        });
        return stream;
    });

    t.mock.method(https, "get", (url, callback) => {
        const req = new FakeStream();
        process.nextTick(() => {
            let behavior;
            try {
                behavior = state.httpsGet(url);
            } catch (err) {
                req.emit("error", err);
                return;
            }
            if (behavior.requestError) {
                req.emit("error", behavior.requestError);
                return;
            }
            const res = new FakeStream();
            res.statusCode = behavior.statusCode;
            res.headers = behavior.headers || {};
            res.pipe = (dest) => {
                process.nextTick(() => {
                    if (behavior.writeError) {
                        dest.emit("error", behavior.writeError);
                    } else {
                        dest.emit("finish");
                    }
                });
                return dest;
            };
            callback(res);
        });
        return req;
    });

    // node --test spawns each test file as a child process and uses stdout
    // for its own parent/child result-reporting protocol. Only intercept
    // writes that are actually one of our own length-prefixed frames;
    // anything else must be passed straight through to the real stdout or
    // the test runner's own reporting breaks.
    const sentResponses = [];
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    t.mock.method(process.stdout, "write", (...args) => {
        const buffer = args[0];
        if (Buffer.isBuffer(buffer) && buffer.length >= 4) {
            const len = buffer.readUInt32LE(0);
            if (buffer.length === 4 + len) {
                try {
                    sentResponses.push(JSON.parse(buffer.subarray(4, 4 + len).toString("utf8")));
                    return true;
                } catch {
                    // not one of our frames, fall through
                }
            }
        }
        return originalStdoutWrite(...args);
    });

    return { host, state, sentResponses };
}

module.exports = { freshHost, HOST_PATH, FakeStream };
