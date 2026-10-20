# CLAUDE.md

## Overview

Chrome extension (Manifest V3) + Node.js Native Messaging host, Windows only, that downloads YouTube audio as MP3 via `yt-dlp` (using Firefox cookies). `README.md` (in French) documents setup in detail (registry key, `allowed_origins`, packaging) and troubleshooting.

## Commands

```sh
npm test                                   # node --test (discovers tests/**/*.test.js)
node --test tests/processUrl.test.js       # single file
node --test --test-name-pattern="skips a non-music" tests/processUrl.test.js   # single case
npm run test:coverage                      # c8 → coverage/lcov.info + text summary
npm run build                              # minifies every root *.js with terser → dist/
npm run release -- [patch|minor|major|x.y.z]
```

No linter is configured. CI (`.github/workflows/node.js.yml`) runs on Node 20/22/24; coverage is only computed and uploaded to Codecov on 22.x. SonarCloud uses automatic analysis (`.sonarcloud.properties`).

`npm run release` is a bash script that bumps the version, regenerates `CHANGELOG.md` via `auto-changelog` (template `changelog.hbs`), runs `update-version.js` (rewrites version + date in `popup.html` and the section date in `CHANGELOG.md`), then **commits, tags and pushes**. Do not run it unless explicitly asked.

## Architecture

Message chain: `popup.js` ⇄ `background.js` ⇄ `host.cmd` → `host.js`.

- **`popup.js`** — UI. Opens a long-lived port `chrome.runtime.connect({name:"popup"})`, sends `handcheck`, then `{command:"install", urls?}`. Scan injects a function via `chrome.scripting.executeScript`: it cannot capture popup variables (inputs go through `args`, results come back via the return value).
- **`background.js`** — service worker, a plain relay. Opens a fresh `connectNative("com.example.ytdlp_installer")` on each `install` and forwards host messages unchanged; emits `NATIVE_DISCONNECT` on disconnect.
- **`host.cmd`** — resolves Node (PATH → nvm → portable 22.22.0 download), logs to `stdio.log`, launches `C:\yt-dlp\host.js` (absolute path).
- **`host.js`** — all the business logic:
  - Native Messaging protocol: frames are a 4-byte LE length prefix + JSON (`readFramedMessage`, `sendResponse`). `processChunk` accumulates stdin chunks and serializes handling through the `messageQueue` promise.
  - **stdout is reserved for the protocol**: all diagnostics go through `log()` → `host.log`. A `console.log` to stdout would corrupt the stream.
  - `handleInstallCommand`: installs yt-dlp/ffmpeg/ffplay/ffprobe if missing (`C:\yt-dlp`, `C:\ffmpeg\bin`) → `resolveUrls` (message `urls` field, else `urls.txt`) → sequential `processUrl`.
  - `processUrl`: `--dump-json` → `isMusicFile` (Music category, otherwise title/channel/tags/description heuristics and duration < 10 min) → skip if the `.mp3` already exists → download → `ffprobe` validation. Errors are classified by `isNonFatalError` (substring patterns in yt-dlp messages): non-fatal = move to next URL, fatal = stop.
  - Message types sent: `DOWNLOAD_START|DONE|SKIPPED|ERROR`, `NATIVE_DISCONNECT`, and free-form `{message: ...}` (including `ALL_TOOLS_INSTALLED`). Changing a type requires updating `popup.js`.
  - Windows paths are hard-coded (`C:\yt-dlp`, `C:\ffmpeg\bin`); on load it runs `npm install` if `node_modules/` is missing.
  - Startup side effects are guarded by `require.main === module`; every function is exported for tests.

## Tests

Only `host.js` is tested (one file per function in `tests/`). Always go through `freshHost(t, overrides)` from `tests/helpers/env.js`: it reloads `host.js` without cache and mocks `fs`, `https`, `unzipper`, `execFile` and `process.stdout` via `t.mock`; responses sent to the popup are captured in `sentResponses`. Subtleties documented in that helper:

- `execFile` is mocked by intercepting `util.promisify` (not `child_process.execFile`), because `host.js` calls `promisify(execFile)` at load time.
- `fs` mocks are installed **after** `require`-ing `host.js`, otherwise the CJS loader would read the fake return values.
- The stdout mock only captures valid length-prefixed frames and passes everything else through (`node --test` uses stdout for its own protocol).

Drive `execFile` behavior by inspecting the arguments (`--dump-json`, `-show_streams`, `--audio-format`); see `execFileFor` in `tests/processUrl.test.js`.

## Misc

- `package.json#ytdlpVersion` is bumped daily by `.github/workflows/update-ytdlp.yml`, which opens a PR; the field is informational (the host always downloads the latest yt-dlp release).
- `host.log`, `stdio.log`, `urls.txt` and `downloads/` are local runtime artifacts; `yt-dlp.exe` is tracked but is a third-party binary (do not modify).

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
