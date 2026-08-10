"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isMusicFile, isNonFatalError } = require("../host.js");

test("isMusicFile", async (t) => {
    await t.test("Music category always wins, regardless of duration/regex", () => {
        assert.equal(
            isMusicFile({ categories: ["Music"], title: "random", duration: 9999 }),
            true
        );
    });

    await t.test("Education category with no Music -> not music", () => {
        assert.equal(
            isMusicFile({ categories: ["Education"], title: "Official Audio", duration: 100 }),
            false
        );
    });

    await t.test("long video (>=600s) with no Music category -> not music", () => {
        assert.equal(
            isMusicFile({ title: "Official Audio", duration: 600 }),
            false
        );
    });

    await t.test("just under the 600s cutoff with a matching title -> music", () => {
        assert.equal(
            isMusicFile({ title: "Official Audio", duration: 599 }),
            true
        );
    });

    await t.test("no categories field at all, title matches regex, short duration -> music", () => {
        assert.equal(
            isMusicFile({ title: "Artist - Song (Official Music Video)", duration: 200 }),
            true
        );
    });

    await t.test("no categories, channel matches vevo, short duration -> music", () => {
        // \bvevo\b requires a word boundary, so it only matches when "vevo"
        // is its own token (e.g. "Artist VEVO"), not a suffix glued onto
        // the artist name with no separator (e.g. "ArtistVEVO").
        assert.equal(
            isMusicFile({ title: "Some Song", channel: "Artist VEVO", duration: 200 }),
            true
        );
    });

    await t.test("no categories, tags match a genre, short duration -> music", () => {
        assert.equal(
            isMusicFile({ title: "Some Song", tags: ["pop", "2026"], duration: 200 }),
            true
        );
    });

    await t.test("no categories, description matches a genre, short duration -> music", () => {
        assert.equal(
            isMusicFile({ title: "Some Song", description: "a great rock anthem", duration: 200 }),
            true
        );
    });

    await t.test("no categories, nothing matches -> not music", () => {
        assert.equal(
            isMusicFile({ title: "Random vlog", duration: 200 }),
            false
        );
    });

    await t.test("undefined duration behaves as not >= 600 (not treated as long)", () => {
        assert.equal(
            isMusicFile({ title: "Official Audio" }),
            true
        );
    });
});

test("isNonFatalError", async (t) => {
    const nonFatalSamples = [
        "Sign in to confirm you're not a bot",
        "Confirm your age to watch this video",
        "This video is unavailable",
        "Video unavailable",
        "Private video",
        "Unsupported URL: foo",
        "No video formats found",
        "HTTP Error 403: Forbidden",
        "Requested format is not available"
    ];

    for (const sample of nonFatalSamples) {
        await t.test(`"${sample}" is classified as non-fatal`, () => {
            assert.equal(isNonFatalError(sample), true);
        });
    }

    await t.test("an unrecognized error message is fatal", () => {
        assert.equal(isNonFatalError("ECONNRESET: socket hang up"), false);
    });

    await t.test("matching is case-sensitive (documents current behavior)", () => {
        assert.equal(isNonFatalError("private video"), false);
    });

    await t.test("substring matches count, not just exact matches", () => {
        assert.equal(isNonFatalError("ERROR: Private video (contact uploader)"), true);
    });
});
