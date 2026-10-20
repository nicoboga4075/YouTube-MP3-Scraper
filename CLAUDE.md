# CLAUDE.md

## Project

Chrome extension (Manifest V3) + Node.js Native Messaging host, Windows only, that downloads YouTube audio as MP3 via `yt-dlp` (using Firefox cookies).
`README.md` (in French) documents setup in detail (registry key, `allowed_origins`, packaging, Chrome Web Store) and troubleshooting.
CI runs on GitHub Actions, with Codecov for coverage and SonarCloud for quality.

## Stack

| Area | Tools (major version) |
|---|---|
| Runtime | Node.js 22 (installed by `host.cmd` when missing; CI matrix 20.x, 22.x, 24.x), npm |
| Extension | Chrome Manifest V3, Vanilla JS (CommonJS), HTML 5, CSS 3, Terser 5 |
| Host | Node.js built-ins (`https`, `child_process`, `fs`), unzipper 0, yt-dlp (latest release), ffmpeg / ffplay / ffprobe (gyan.dev essentials build) |
| Tests | `node:test` runner, `node:assert/strict`, c8 12 |
| Release | auto-changelog 2 |

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Wipe `dist/` and minify every root `.js` into it with terser. Required after any edit to `background.js` or `popup.js`: `manifest.json` loads `dist/background.js` and `popup.html` loads `dist/popup.js` (`host.cmd` runs the root `host.js` directly) |
| `npm test` | Every test (`node --test`, discovers `tests/**/*.test.js`) |
| `node --test tests/processUrl.test.js` | One test file; add `--test-name-pattern="skips a non-music"` for one case |
| `npm run test:coverage` | c8 → `coverage/lcov.info` + text summary |
| `npm run changelog` | Regenerate `CHANGELOG.md` |
| `npm run release -- [patch\|minor\|major\|x.y.z]` | Bump the version, regenerate `CHANGELOG.md` via `auto-changelog` (template `changelog.hbs`), run `update-version.js` (version and date in `popup.html`, section date in `CHANGELOG.md`), then **commit, tag and push**. Never run it unless asked |

No linter is configured.

## Environment and setup

- Windows only: `host.cmd`, `host.js` and `com.example.ytdlp_installer.json` hard-code `C:\yt-dlp` and `C:\ffmpeg\bin`.
- `npm install`, then `npm run build`; load the folder unpacked from `chrome://extensions` (Developer mode).
- Native host registration: the registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.example.ytdlp_installer` points to `com.example.ytdlp_installer.json`, whose `allowed_origins` must match the extension ID.
- Firefox must be installed and signed in to YouTube: yt-dlp reads its cookies (`--cookies-from-browser firefox`).
- `host.cmd` resolves Node (PATH → nvm → portable 22.22.0 download), logs to `stdio.log`; `host.js` runs `npm install` on load if `node_modules/` is missing.

## Architecture

Message chain: `popup.js` ⇄ `background.js` ⇄ `host.cmd` → `host.js`.

- **`popup.js`** — UI. Opens a long-lived port `chrome.runtime.connect({name:"popup"})`, sends `handcheck`, then `{command:"install", urls?}`. Scan injects a function via `chrome.scripting.executeScript`: it cannot capture popup variables (inputs go through `args`, results come back via the return value). Three download modes: the active `/watch?v=` tab, the URLs of a Scan sent in memory, or (no `urls` field) `urls.txt` read by the host.
- **`background.js`** — service worker, a plain relay. Opens a fresh `connectNative("com.example.ytdlp_installer")` on each `install` and forwards host messages unchanged; emits `NATIVE_DISCONNECT` on disconnect.
- **`host.cmd`** — resolves Node (PATH → nvm → portable 22.22.0 download), logs to `stdio.log`, launches `C:\yt-dlp\host.js` (absolute path).
- **`host.js`** — all the business logic:
  - Native Messaging protocol: frames are a 4-byte LE length prefix + JSON (`readFramedMessage`, `sendResponse`). `processChunk` accumulates stdin chunks and serializes handling through the `messageQueue` promise.
  - **stdout is reserved for the protocol**: all diagnostics go through `log()` → `host.log`. A `console.log` to stdout would corrupt the stream.
  - `handleInstallCommand`: installs yt-dlp/ffmpeg/ffplay/ffprobe if missing (`C:\yt-dlp`, `C:\ffmpeg\bin`) → `resolveUrls` (message `urls` field, else `urls.txt`) → sequential `processUrl`.
  - `processUrl`: `--dump-json` → `isMusicFile` (Music category, otherwise title/channel/tags/description heuristics and duration < 10 min) → skip if the `.mp3` already exists → download → `ffprobe` validation. Errors are classified by `isNonFatalError` (substring patterns in yt-dlp messages): non-fatal = move to next URL, fatal = stop.
  - Message types sent: `DOWNLOAD_START|DONE|SKIPPED|ERROR`, `NATIVE_DISCONNECT`, and free-form `{message: ...}` (including `ALL_TOOLS_INSTALLED`). Changing a type requires updating `popup.js`.
  - Startup side effects are guarded by `require.main === module`; every function is exported for tests.

## Code conventions

- Plain CommonJS, 4-space indentation, double quotes, semicolons, `const`/`let` (no `var`).
- Keep `host.js` loadable from tests: no side effect outside the `require.main === module` guard, every new function added to `module.exports`.
- Never write to stdout in `host.js` except through `sendResponse`; use `log()`.
- A message type or command changed on one side (`popup.js`, `background.js`, `host.js`) must be changed on the others.
- Comments: see "Comments" below.

## Git workflow

- One branch, `main`. Commit only when asked, and never push until asked.
- `origin` is GitHub (`nicoboga4075/YouTube-MP3-Scraper`); Dependabot opens daily npm update PRs.
- `.github/workflows/node.js.yml` runs on each push and PR to `main`: `npm ci --ignore-scripts`, build and tests on Node 20/22/24; coverage is only computed and uploaded to Codecov on 22.x. SonarCloud uses automatic analysis (`.sonarcloud.properties`).
- `.github/workflows/update-ytdlp.yml` runs daily at 8:00 UTC and opens a PR bumping `package.json#ytdlpVersion`; the field is informational (the host always downloads the latest yt-dlp release).
- Releases: `npm run release` (see "Commands").

## Tests

Only `host.js` is tested (one file per function in `tests/`). Always go through `freshHost(t, overrides)` from `tests/helpers/env.js`: it reloads `host.js` without cache and mocks `fs`, `https`, `unzipper`, `execFile` and `process.stdout` via `t.mock`; responses sent to the popup are captured in `sentResponses`. Subtleties documented in that helper:

- `execFile` is mocked by intercepting `util.promisify` (not `child_process.execFile`), because `host.js` calls `promisify(execFile)` at load time.
- `fs` mocks are installed **after** `require`-ing `host.js`, otherwise the CJS loader would read the fake return values.
- The stdout mock only captures valid length-prefixed frames and passes everything else through (`node --test` uses stdout for its own protocol).

Drive `execFile` behavior by inspecting the arguments (`--dump-json`, `-show_streams`, `--audio-format`); see `execFileFor` in `tests/processUrl.test.js`.

## Sensitive areas

- `extension.pem` (signing key) and `extension.crx` are git-ignored: never commit, copy or share them.
- `com.example.ytdlp_installer.json` pins the allowed extension ID: changing it breaks the native host for the installed extension.
- `host.js` downloads and writes executables (yt-dlp, ffmpeg): any tool URL or path change needs care (HTTPS only, official sources).
- `yt-dlp.exe` is tracked but is a third-party binary: do not modify it.
- `host.log`, `stdio.log`, `urls.txt` and `downloads/` are local runtime artifacts, git-ignored; `downloads/` holds the user's MP3s, never delete it.
- Never edit `dist/` (generated) or hand-edit the version in `popup.html` and `CHANGELOG.md` (written by `npm run release`).

## Glossary

| Term | Meaning |
|---|---|
| host, native host | `host.js` launched by Chrome through `host.cmd`, registered as `com.example.ytdlp_installer` |
| handcheck | The popup's first message to `background.js` |
| install | The command that installs the missing tools, then downloads the URLs |
| tools | The `tools` map of `host.js`: yt-dlp, ffmpeg, ffplay, ffprobe (`path`, `url`) |
| scan | The **Scan** button run: collect the YouTube URLs of the page into the popup terminal |
| export | The **Export** button: save the scanned URLs to `urls.txt` |
| non-fatal error | A yt-dlp error matched by `isNonFatalError`: skip the URL and go on |
| frame | A native message: 4-byte little-endian length, then the JSON |

## Commits

Start every commit message with the emoji from [gitmoji.dev](https://gitmoji.dev) that matches the change, as the character itself (not the `:code:`), followed by a space and the subject line. For example:

- `🐛 Fix ...` for a bug fix
- `✨ Add ...` for a new feature
- `💄 Update ...` for UI and style changes
- `♻️ Refactor ...` for a refactor
- `✅ Test ...` for adding or updating tests
- `👷 Update ...` for the CI workflows
- `📝 Document ...` for documentation
- `🔧 Configure ...` for configuration files

One emoji per commit: pick the one for the main intent of the change. The `Release vX.Y.Z` commits created by `npm run release` keep their format, since `auto-changelog` excludes them through `ignoreCommitPattern: "^Release v"`.

## Comments

Prefer single-line comments, even long ones, in every language (JS, HTML, CSS, batch): no comment wrapped over several lines, and no numbered lists (`1.`, `2.`) inside a comment. When a comment explains several cases or branches, put one single-line comment on each branch instead of a block above them.

## File size

**Never commit a file of 100 MB or more, whatever the reason.** GitHub refuses any file over 100 MiB, so one such file blocks every push. Git warns from 50 MiB: keep each file well under that, such as `yt-dlp.exe` already at 18 MB, and never commit `downloads/` or the ffmpeg binaries.
