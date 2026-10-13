# SPhO Exam Simulator

Offline Windows 11 physics examination software built with Tauri 2, Rust, React, TypeScript, Vite, Tailwind CSS, SQLite, React Markdown, KaTeX, and Recharts. Light mode; Overload Mode only. No accounts, telemetry, remote content, or cloud storage.

## Install and use

Run the NSIS installer under `src-tauri/target/release/bundle/nsis/`. The standalone executable is `src-tauri/target/release/spho-exam-simulator.exe`. Windows WebView2 is required; the installer embeds its bootstrapper. Windows 11 normally includes the runtime. Installing on a machine without WebView2 may require internet to install that prerequisite; normal application use is offline.

1. Import `fixtures/SPHO_SAMPLE_VALIDATION.zip` to inspect ten demonstration questions. This is a rendering fixture, not a full preparation exam.
2. Import your own canonical `spho-exam/1.0` ZIP. See [SCHEMA.md](SCHEMA.md) for the exact generation contract.
3. Start the examination. Choose A/B/C/D, flag questions, and type per-question notes. Changes save automatically. Use Previous, Next, Skip, or the numbered grid.
4. Closing the application pauses the timer. Reopening automatically restores the active attempt. Minimizing or switching applications does **not** pause it.
5. Confirm submission to unlock results, explanations, shortcuts, pitfalls, and the original notes. Review by incorrect, unanswered, flagged, correct, or all. Retaking creates a fresh attempt; prior results remain in the library.

The standard examination has 100 questions, 9000 seconds, and one point per correct answer. There is no negative marking. Smaller fixture packages use the same exam engine, without introducing another mode.

## Development

Prerequisites: Node.js 22.12+ (24 LTS recommended), stable Rust with `x86_64-pc-windows-msvc`, Visual Studio Build Tools with Desktop Development with C++ and Windows SDK, and WebView2. This workspace was built using Node 24 and Rust 1.98. Official Tauri prerequisites: <https://v2.tauri.app/start/prerequisites/>.

```powershell
npm install
npm run tauri dev
```

`npm run dev` runs the frontend development server at `http://127.0.0.1:1420`; normal persistence requires Tauri. The browser alone reports a desktop connection error, intentionally. There is no simulated production backend.

For isolated native QA or portable local storage, set the trusted process environment variable `SPHO_DATA_DIR` to an absolute directory. It is not accepted through frontend IPC; the default remains the Windows local application data directory.

```powershell
npm run build
npm run tauri build
```

The second command runs the frontend build and builds the native executable and NSIS installer. Builds need internet the first time to obtain dependencies and bundler tools. No server is installed or started by the application.

## Tests

```powershell
npm run test
npm run test:rust
npx playwright install chromium
npm run test:e2e
```

Vitest exercises the exact Markdown/math pipeline, all sample content, Unicode, order, image choices, table explanations, and analytics linkage. Rust tests exercise safe imports, malicious assets, transactions, persistence, grading, immutable submitted attempts, concurrent attempt prevention, full-size scoring, and deterministic timer transitions.

Playwright drives the complete React UI with a **test-only JSON-lines process bridge to the real Rust importer/repository and SQLite**, including a stopped/restarted backend process. The bridge requires the `qa` Cargo feature and is not bundled in the desktop application. It substitutes the OS file picker with a chosen fixture; native picker/lifecycle verification is separate. Screenshot artifacts appear in `test-results/`, and `playwright-report/` contains the test report. Required viewports are 1366×768, 1536×864, and 1920×1080.

After building the Windows EXE, `npm run test:native` verifies the actual production executable using WebView2 CDP and a Python standard-library Win32 picker/close helper. No mock IPC or frontend server is used. It checks native launch, ZIP selection, close/reopen persistence, offline figures, scoring, and timeout. QA data and WebView profiles are isolated under `test-results/native/`. Close any running app instance before building or running this test. The debug port is enabled only in the test process environment; normal launches do not enable it.

`fixtures/SPHO_SYNTHETIC_100.zip` is explicitly synthetic QA data, not SPhO preparation. `SPHO_TIMEOUT_VALIDATION.zip` has a three-second duration for timeout QA. `fixtures/negative/` includes fourteen rejected packages. Invalid LaTeX is caught by the trusted frontend validation stage; structural and asset checks run in Rust first. Both are required before the library commit.

To regenerate packages from checked-in original assets: `npm run fixtures`. `node scripts/schema.ts` regenerates the JSON Schemas (Node 24 supports TypeScript stripping). Optional: `python scripts/create-assets.py` rebuilds original PNG/WebP fixtures and icons; it needs Pillow (`python -m pip install Pillow`). Fixture regeneration is not needed to build or use the application.

## Persistence and timer policy

SQLite lives in `%LOCALAPPDATA%\org.spho.examsimulator\spho.sqlite3`, resolved through Tauri's `app_local_data_dir`. The database uses WAL, FULL synchronous commits, foreign keys, a versioned migration, and transactions. Assets are validated then stored as immutable binary rows with the examination; no extracted asset directory can become incomplete. The content hash frames sorted package file names and their uncompressed bytes, so recompression, ZIP timestamps, and ZIP entry order do not change identity. JSON whitespace changes do change the hash. Identical reimports do nothing; conflicting content with the same `examId` is rejected.

The Rust session owns elapsed milliseconds and a monotonic reference. A background thread checkpoints every second; UI polls do not own or increment time. Each answer, flag, note, or navigation update also checkpoints and commits. A graceful native close requests a frontend save flush, then commits elapsed time before process exit. An OS forced termination can restore up to approximately one second of uncheckpointed time (potentially more if storage was unavailable); no closed-process wall-clock time is charged on restart.

On Windows, `GetTickCount64` includes system sleep and is unaffected by wall-clock/timezone changes. **Sleep while the process is running consumes examination time**, including automatic submission on wake if the duration expired. Minimized/background windows also consume time. Foreground viewing metrics accrue only when the app window is focused. Gaps above three seconds, such as sleep, are excluded from viewing metrics; timer time still advances. Viewing metrics are approximate observations, not cognitive effort. Zero recorded viewing time is displayed as unavailable.

Only one application instance and one active attempt are allowed. No manual Pause or abandonment control is provided. Submit the active attempt before starting another. Completed attempts are immutable, and the UI does not offer deletion that could lose history. SQLite is local storage, not encrypted storage; this simulator is not an adversarial examination security system.

## Architecture

- `src-tauri/src/importer.rs`: bounded ZIP reader, typed contract validation, raster decoding, static SVG allowlist, canonical file hashing.
- `src/science.ts`: common parser options and import-time validation using the same Remark/KaTeX plugins as display.
- `src/components/ScientificContent.tsx`: reusable ordered Markdown/math and figures for every context, including lightbox.
- `src-tauri/src/repository.rs`: all SQL access, session timer, critical transactions, guarded solution access and grading.
- `src-tauri/migrations/001_initial.sql`: schema, constraints, foreign keys, indexes, immutability triggers.
- `src-tauri/src/lib.rs`: narrow typed IPC commands, backend-owned native picker, single-instance and native close handling.
- `src/App.tsx`: serialized durable edits, library, exam room, keyboard handling and submission.
- `src/Results.tsx`, `src/analytics.ts`: ID-based analytics and post-submission review.

The CSP blocks remote scripts, fonts, figures, frames, objects, and connections. Imported Markdown HTML, links, and Markdown image syntax are rejected. Images must use canonical image blocks. SVG is rendered through an image element, never injected into the DOM. Tauri exposes no general file read/write or SQL command. Clipboard, shell, and frontend filesystem plugins are not enabled.

## Fonts and licensing

Inter and Noto Serif (Latin and Vietnamese subsets) are bundled from Fontsource with SIL Open Font Licenses. KaTeX bundles its own math fonts and MIT license. See `licenses/` for redistributed font and KaTeX license copies. The app icon and fixture diagrams/plots are original project assets. License metadata for npm and Cargo dependencies remains available in their installed packages and lockfiles.

The font and KaTeX license texts are also embedded in the executable and available through **About & licenses** in the library.

The installer is unsigned. Publishing a signed release requires a code-signing certificate supplied by the distributor. No update service is installed.
