# D11 — Offline licence keys and the Windows installer

Status: accepted 2026-10-12 (operator: scope, done before Stage 5, re-check at every start,
embedded CPython, the install check partly on a machine without Smart App Control) ·
licence keys implemented in Stage A, the installer in Stage B (results below).

## Context

On 2026-10-12 the operator asked for three things outside the 9-stage app plan (an addition; the
installer pulls the planned packaging stage forward):

1. a Windows installer (NSIS via electron-builder) that bundles the app and the Python engine:
   "Nazeer Desktop Setup <version>.exe";
2. a licence-key system with two kinds from one mechanism: a **trial** key (signed
   `{"expires": <ISO date>}`, made with `--days N`) and a **permanent** key (signed
   `{"customer": <name>, "expires": null}`), produced by one generator run on the vendor's machine
   (never shipped) with an Ed25519 private key that stays off any repository; the app ships only
   the public key, baked in at build time;
3. an Activate screen before the main UI on first run: verify the signature (no internet), reject
   an expired key, write an activation marker to userData on success, and say why a key fails —
   bad signature, expired or malformed — in Arabic and English.

Non-goals: no hardware lock, no activation server, no code-signing certificate. Verification and
file I/O live in Electron main; the sandboxed renderer only shows the screen over `window.nazeer`.

## Decision — licence keys

- **Token:** `NZL1.<payload>.<signature>`, both parts base64url without padding. The signature is
  Ed25519 over the ASCII bytes of `NZL1.<payload>` — the exact transmitted text, so no JSON
  canonicalisation question exists.
- **Payload** (exact keys): `v` = 1; `kind` = `"trial"` | `"permanent"`; `customer` = a name
  (1–200 characters, no control characters or bidi controls) or null — required for a permanent
  key; `expires` = `"YYYY-MM-DDTHH:MM:SSZ"` or null (permanent ⇔ null); `issued` in the same
  format. This is the spec's payload plus `v` (format evolution), `kind` (display) and `issued`
  (audit). The verifier does not require `issued < expires`: a key generated with a past
  `--expires` (the acceptance check's "rejected tomorrow", produced today) is issued after its own
  expiry and must read as **expired**, not malformed; `--days N` always gives `issued < expires`.
- **Verification order and reasons** (`app/src/main/license/verify.ts`):
  1. normalise: remove whitespace and Unicode format characters (`\p{Cf}`: chat apps add LRM, RLM,
     ALM or zero-width spaces when a key is copied);
  2. **malformed** unless: length ≤ 2048; three parts; prefix `NZL1`; both parts in the base64url
     alphabet and **canonical** (decoding and re-encoding gives the same text — Node's decoder is
     lenient, so without this a changed last character could decode to the same bytes); a
     64-byte signature;
  3. **bad_signature** when Ed25519 verification fails;
  4. **malformed** when the payload is not UTF-8 JSON matching the schema; dates must match the
     pattern and survive a round trip through `Date` (V8 silently rolls `2026-02-30` over);
  5. **expired** when a trial key's `expires` ≤ now (the decoded payload is returned so the screen
     can show the date);
  6. otherwise valid. With step 2's canonical check, every single-character change to a key is
     rejected (a test changes every position).
- **Expiry:** `--days N` means N × 24 h from issuance on the vendor's clock, not from activation.
  `--expires <instant>` (with `Z` or an offset) sets an explicit expiry; a date in the past is
  allowed (with a warning) so the "rejected tomorrow" case can be produced today.
- **When the key is checked:** at every start (operator decision). An expired trial opens the
  Activate screen with "expired"; a permanent key never asks again. About offers "Change key"
  (e.g. a trial upgraded to permanent); the stored key is replaced only by a key that verifies.
- **Generator** `tools/generate-license.mjs` (plain Node, no dependencies, never packaged):
  `--init` creates the key pair in `%USERPROFILE%\.nazeer-license\`; it refuses any folder inside a
  git work tree (this repository is nested in another one) or under OneDrive, Desktop or Documents,
  and gives the folder an owner-only ACL. `--force` keeps the old pair as a timestamped backup. The
  public key is written to `app/src/main/license/publicKey.ts` (or `--public-key-out`); no PEM text
  is ever printed. Issuing refuses when the key folder's public key differs from the app's baked
  key. Each issued key adds a line to `issued.log` (fingerprint, kind, customer, dates — not the
  key).
- **Production flag:** builds made for packaging define `__NAZEER_DIST__`; `isProduction() =
  __NAZEER_DIST__ || app.isPackaged`. Production always requires a licence and ignores every
  development switch (`NAZEER_*` variables, `--data-root`, `ELECTRON_RENDERER_URL`). `app.isPackaged`
  alone only compares the executable's name with `electron.exe`, so renaming the installed exe
  would otherwise switch licensing off. Development builds keep their own profile
  (`%APPDATA%\Nazeer Desktop (dev)`), so they never write into the packaged app's.
- **Gate:** main checks the stored key at startup and starts the engine only once the licence is
  active (no engine token exists before then). IPC: `license.getStatus()`, `license.activate(key)`
  (sender-checked; the key is a string of at most 4096 characters). The marker
  `<userData>\app-license.json` = `{v, key, activatedAt}` (atomic write; files over 64 KiB are
  ignored). If writing the marker fails after a good key, the session continues and the screen
  says the key was not saved. The Activate screen shows Arabic and English together, whatever the
  UI language.
- **Development and tests:** a licence is required only in production, or when
  `NAZEER_LICENSE_ENFORCE=1`; `NAZEER_LICENSE_PUBLIC_KEY=<pem file>` replaces the baked key (tests
  sign with throwaway keys). A non-production build without a baked key reports
  `license_not_configured`; packaging refuses to build without the vendor's key.

## Decision — installer (Stage B, as built)

- **Installer** (`app/electron-builder.yml`, electron-builder 26.15.3): NSIS, x64, assisted
  (`oneClick: false`), "Only for me" by default (no administrator; "Anyone who uses this
  computer" is offered and asks for elevation), install folder changeable, desktop and Start-menu
  shortcuts, "Nazeer Desktop Setup ${version}.exe". Uninstalling keeps `%APPDATA%\Nazeer Desktop`
  (sessions, candidates, the licence marker). No auto-update, no publishing.
- **Not code-signed** (a non-goal). electron-builder logs "signing with signtool.exe" for each .exe
  but signs nothing without a certificate: the bundled `python.exe` keeps its Python Software
  Foundation signature, byte-identical. A future certificate would make electron-builder sign
  those .exe files too; decide then whether the PSF-signed ones are excluded.
- **Publisher:** "Nazeer" (`package.json` `author`; operator, 2026-10-12). Without an author the
  app's executable kept electron.exe's CompanyName "GitHub, Inc.".
- **Icon:** the operator's logo (2026-10-12), kept as given in `app/build/logo.png` (64 × 64 px).
  `app/scripts/make_icon.py` writes `app/build/icon.ico` (16–256 px: the executable, the installer,
  the uninstaller and the window; development runs set it on the window, since electron.exe carries
  Electron's logo) and `app/src/renderer/favicon.png` (the page icon). Frames up to 64 px are the
  logo's own pixels; Windows also wants 128 and 256 px, which are smooth enlargements and look soft
  until a larger master (256 px or more, or vector) exists.
- **Languages:** Arabic and English (operator, 2026-10-12). A language dialog comes first, titled
  in both languages and defaulting to the Windows language; silent installs skip it (NSIS
  `MUI_LANGDLL_DISPLAY` checks `${Silent}`). electron-builder 26.15.3 has Arabic for only 4 of its
  26 installer messages; `app/build/installer.nsh` supplies the other 22 (the "Only for me / Anyone
  who uses this computer" page, the uninstaller's choices, five common messages) through
  electron-builder's `customHeader` hook, which comes after its own message tables. Redefining a
  message makes makensis warn (6030), silenced in that file only; a test installer confirmed that
  the later, Arabic definition is the one shown. The pages themselves come from NSIS's Arabic
  language file (right to left).
- **app.asar** = `out/**` + `package.json` (42 entries, no `node_modules`: Vite bundles the
  renderer libraries, main and the preloads need none); no `default_app.asar`. **Fuses:**
  RunAsNode, NODE_OPTIONS, `--inspect` arguments, cookie encryption, the browser V8 snapshot and
  file:// privileges off; embedded asar integrity (electron-builder writes the executable's
  INTEGRITY resource) and load-only-from-asar on. A ninth fuse slot that @electron/fuses 1.8 does
  not name keeps Electron's default.
- **Packaging guards** (`app/scripts/dist-checks.mjs`): `npm run dist` first checks the baked
  licence key (present, consistent with its id, equal to the vendor key folder's when that folder
  is on the build machine); electron-builder's `beforePack` repeats it and also requires `out\`
  built with `NAZEER_DIST=1` and a staged engine, so packaging refuses even when electron-builder
  is started by hand.
- **Engine bundled as an embedded CPython 3.11.9** (`app/scripts/stage-engine.mjs` →
  `app/dist-engine/` → `<resources>\engine`), run as `python\python.exe -I -u -B -m nazeer_engine`
  with cwd `<resources>\engine` (D9 "Spawn"):
  - the python.org embeddable zip, SHA-256 pinned (`009d6bf7…cfd3b`; python.org publishes only
    the MD5, `6d9aa085…17c4`, which matched). All 28 of its binaries are checked as signed by the
    Python Software Foundation. `python311._pth` = `python311.zip`, `.`, `Lib\site-packages`, `..`,
    `import site`; a `._pth` file also puts the interpreter in isolated mode (environment
    variables and the current folder ignored), verified by importing from `engine\`, where the
    source package lives: the bundle's copy is imported;
  - the Visual C++ runtime 14.44.35211 (10 DLLs from Visual Studio's redistributable folder,
    Microsoft-signed) next to `python.exe`: torch imports `msvcp140.dll`,
    `msvcp140_atomic_wait.dll` and `vcruntime140_threads.dll`, which the embeddable zip lacks and
    the build laptop's System32 would otherwise hide;
  - the runtime packages: every pin of `engine/requirements.txt` except the test pins (pytest,
    pluggy, iniconfig, Pygments), closed over the installed requirements (markers for Windows and
    Python 3.11), each version equal to its pin, each file copied from its RECORD with its SHA-256
    checked (`app/scripts/engine_bundle.py`, run by the venv). 51 distributions, 10,537 files.
    **setuptools is left out on purpose:** torch 2.14.1 declares `setuptools>=77.0.3`, but imports
    it only in `torch.utils.cpp_extension` (building C++ extensions; the other hit is in a
    docstring). `torch/include` (40 MB of C++ headers, the deepest paths) is pruned. pip, ruff,
    httpx2, pytest and stray `.pth` files are refused. polars (172 MB) stays although the engine
    never imports it: ultralytics declares it (operator, 2026-10-12: keep it);
  - `nazeer_engine` (no `__pycache__`) and `models/best.pt` (SHA-256 = the pinned
    `MODEL_SHA256_PINNED`); bytecode precompiled by the embedded interpreter (`unchecked-hash`,
    8,236 `.pyc`). One file does not compile on 3.11, `torch/testing/_internal/py312_intrinsics.py`
    (Python 3.12 syntax); the venv has no bytecode for it either, and the step accepts only such
    files;
  - **DLL closure** (a PE import-table reader, `app/scripts/lib/pe-imports.mjs`): 224 executables
    and DLLs; every import, delay-loaded ones included, resolves inside the bundle or to one of 40
    Windows DLLs, each checked as Microsoft-signed. A Visual C++ runtime name never counts as part
    of Windows. cv2 needs `mf.dll`, `mfplat.dll` and `mfreadwrite.dll` (Windows N editions need the
    Media Feature Pack);
  - 18,862 files, 1,254 MB; the longest path is 146 characters below `resources\engine` (the
    default per-user install adds about 85, so about 231 of Windows' 259).
- **Rejected: PyInstaller** (the original plan). A freeze step re-packs torch, ultralytics,
  matplotlib and pyrealsense2 through hooks into a runtime that differs from the one the tests ran,
  and its bootloader exe is unsigned and new for every build. The embedded interpreter is the
  tested runtime, signed, with no freeze step.

## Smart App Control (measured on the dev laptop)

- **State:** enforcing (`HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy`
  `VerifiedAndReputablePolicyState = 1`).
- **What it blocked** (Code Integrity events 3033/3077, policy
  `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`):
  - 2026-10-11 14:57: `torch_cpu.dll`, once;
  - 2026-10-12: `pyrealsense2.cp311-win_amd64.pyd` (12:40–12:49), matplotlib's
    `_c_internal_utils` (12:40–13:13) and `_pydantic_core` (12:40);
  - Node's optional native canvas module for pdf.js (during Vitest runs).
- **They loaded again:** at 14:56 the same files loaded, with Smart App Control still enforcing,
  and the whole engine suite passed (435 tests).
- **Reading:** its decisions are reputation-based and intermittent (cloud lookups). How it
  behaves on an **offline** machine (the field laptop runs offline) is not measured.
- **Later the same day:** with the blocks gone, the stub-walk EventSource check on bag 004 passed
  (`e2e/connectivity.spec.ts`).
- **Stage B, the same afternoon:**
  - staging: one block (3033 + 3077 at 17:05) of polars' runtime DLL
    (`_polars_runtime_32\_polars_runtime.pyd`, 170 MB) loaded from the new staging folder; the
    import sweep still imported polars (in 17 s), and the next three staging runs logged nothing.
    The engine never loads polars: ultralytics imports it only to turn results into a table or
    CSV;
  - building: `npm run dist:dir` and `npm run dist` (electron-builder's own tools, 7-Zip, NSIS)
    logged no Code Integrity event;
  - installing and running: the unsigned installer, the rebranded app executable (unsigned, a new
    file) and the bundled engine went through the whole install-and-run smoke (17:29–17:41,
    24 checks) without a Code Integrity event.
  - **Reading:** these files were built on this laptop and carry no Mark of the Web. An installer
    downloaded or received by mail is judged differently, earlier blocks came and went, and the
    field laptop runs offline; so this result is no promise for another PC.
  - **the rebuild (18:19–19:00):** electron-builder runs a freshly compiled stub to write the
    uninstaller; at 18:19 Smart App Control refused it (`spawn UNKNOWN`, the build failed), and the
    retry at 18:20 ran. The finished installer was then refused twice (18:40, 18:59). Building and
    install-checking here depends on Smart App Control's verdict on each new unsigned file.
  - **re-checked before Stage 6 (19:18–19:25):** still enforcing; no engine file blocked since
    13:13. All 16 compiled modules of the real flow (`pyrealsense2`, matplotlib's, `pydantic_core`,
    `cv2`, `torch`, …) imported in the venv; `tools\real_run.py` passed 34/34 on bag 006 (bag walk,
    real model, overlay, headless Edge print, sealed PDF); then the same rebuilt installer that was
    refused at 18:40 and 18:59 ran through the whole install-and-run smoke (24/24). No Code
    Integrity event from 19:18 on.
- **2026-10-13, Stage 8:** from 16:33:04 to 18:33 it blocked the venv's
  `_pydantic_core.cp311-win_amd64.pyd` (events 3033 + 3077 + 3118 on every try; nothing else),
  a file it had allowed for a day. For those two hours the engine started (`--check` returns before
  FastAPI is imported) but could not serve: the sidecar died with "An Application Control policy
  has blocked this file" right after its checks, so no app, no e2e and no API test could run. An
  import retried once a minute was allowed again at 18:33:53. The longest block measured so far:
  on the field laptop, a block like it would stop the whole app, not one feature.
- **Consequences:**
  - the engine now reports a blocked matplotlib as a missing Arabic stack (Stage A1);
  - the field laptop needs Smart App Control off (irreversible without resetting Windows) or a
    signed product; the operator tests it there once a signed installer exists (2026-10-12).

## Known limits (an offline deterrent, as scoped)

- A clock set backwards extends a trial.
- A patched `app.asar` defeats the check (without code signing, the integrity fuse is only as
  strong as the exe).
- The engine runs without a licence when started directly (`python.exe -m nazeer_engine`).
- `--remote-debugging-port` works on a packaged app (fuses do not cover Chromium switches), which
  exposes the engine token to the same Windows user.
- There is no hardware lock (a non-goal).
- The installer and the app are unsigned (a non-goal for now): SmartScreen warns about a
  downloaded copy, and Smart App Control may block it on a PC where it is enforced. torch also ships
  an unsigned `torch\bin\protoc.exe`, which the engine never runs.

## Stage A result (2026-10-12)

- `tools/generate-license.mjs`; `app/src/main/license/{verify,store,service,publicKey}.ts`;
  `app/src/main/runtime.ts`; IPC + preload; `LicenseGate`, the Activate screen and About's licence
  card.
- **Generator round trip:** the generator's keys are checked with the app's verifier, using a
  temp key folder and a temp `--public-key-out`; the committed `publicKey.ts` stays untouched.
- **Tamper test:** every single-character substitution, at every position, of a valid key is
  rejected. The test fails when the canonical check is removed (mutation run).
- **End to end** (`e2e/license.spec.ts`, built app, throwaway key pair):
  - malformed, tampered and expired keys show their reasons in Arabic and English;
  - the engine does not start before activation;
  - a `--days 1` key starts it;
  - a relaunch on the same profile asks nothing;
  - a stored trial that ran out opens the Activate screen with its date.
- **Vendor key pair:** created on 2026-10-12 with `--init` at the operator's request, key id
  `2f8696292b9d9ec0`, in `%USERPROFILE%\.nazeer-license` (`signing-key.pem`, `public-key.pem`);
  `publicKey.ts` holds its public half. The folder is readable only by the operator's account
  (SYSTEM and Administrators removed), so a backup tool running as SYSTEM may skip it; the
  operator backs it up by hand before keys are issued against it.

## Stage B result (2026-10-12)

- **Staging** (`npm run stage:engine`, 66 s on this laptop): the steps above, then a smoke with the
  embedded interpreter: an import sweep of all 100 runtime modules (57 third-party top-level
  modules, 43 engine modules: all import); `--check` (the real model loaded and warmed up in
  0.2–0.5 s, Arabic stack ok); a serve-mode start with the exact production command → the
  ready-line pid equals the spawned pid (no launcher) → `/health` → `/versions` reports the bundle's
  library versions (none "NOT INSTALLED") → 401 without the token → shutdown → exit 0. A final
  check that none of this wrote into the bundle caught a bug in the smoke itself (ultralytics falls
  back to the current folder, the bundle, for its settings when its configured folder's parent is
  missing; the engine creates that folder first, so the installed app is not affected).
- **The real-bag check on the bundled interpreter:** `app\dist-engine\python\python.exe
  engine\tools\real_run.py` (bag 006) passed 34/34 checks: walk (46 s), session, measurements,
  finalize, headless Edge print, strict probes, sealed PDF. With the `._pth` file the spawned engine
  imports the bundle's `nazeer_engine` and packages (sys.path verified), so this is the packaged
  engine, integration-tested.
- **`npm run dist:dir`:** `release\win-unpacked` (1,606 MB): fuses as configured
  (`@electron/fuses read`), `app.asar` 42 entries without `node_modules`, no `default_app.asar`, all
  18,862 engine files including the 8,236 `.pyc` (electron-builder's default exclusion of `.pyc`
  applies to app files only, not to `extraResources`).
- **`npm run dist`** (12 minutes end to end on this laptop, most of it NSIS compression):
  `release\Nazeer Desktop Setup 0.1.0.exe`, 333 MB (333,201,801 bytes, SHA-256
  `53f3efe0…f000c23b`), unsigned; it installs 1,643 MB.
- **`npm run smoke:packaged -- --move-profile-aside`: 24/24 checks passed** on this laptop.
  - **Install:** silent per-user install in 154 s; the uninstall entry, `app.asar`, the engine and
    the model are in place; no `default_app.asar`.
  - **First launch:** run with development switches set that production must ignore
    (`NAZEER_STUB_MODEL`, `NAZEER_DATA_ROOT`, `NAZEER_USER_DATA_DIR`, `NAZEER_LICENSE_ENFORCE=0`,
    `ELECTRON_RENDERER_URL`) and `ELECTRON_RUN_AS_NODE=1`. The app started normally (the fuse holds)
    and showed the Activate screen in both languages: licence required, no engine. The malformed,
    tampered and expired keys each showed their reason in Arabic and English.
  - **Activation:** a fresh `--days 1` vendor key started the real-model engine in 11.5 s (warm-up
    0.16 s, Arabic stack ok) on `%APPDATA%\Nazeer Desktop`, and wrote the licence marker; the
    development folders stayed empty.
  - **Quit and relaunch:** closing the window ended the app (exit 0) and the engine; a relaunch
    verified the stored key again and skipped the Activate screen.
  - **Renamed exe:** a copy renamed `electron.exe` still required the licence (the dist flag).
  - **Uninstall:** silent, and the uninstall entry is gone.
  - Screenshots of the installed app (Activate, the expired reason, Home, About) are in
    `runs\app_snaps\stageB_packaged\`. About shows the bundle's library versions and the trial
    licence.
- **Publisher:** the first `dist:dir` exe said CompanyName "GitHub, Inc."; with `author` set, the
  installed exe said "Nazeer Desktop", and after the operator's answer it says "Nazeer".
- **Rebuilt with the operator's answers** (2026-10-12, 18:20–18:32): publisher "Nazeer", the logo
  as the icon (a development window's title bar checked: the logo, not Electron's), Arabic and
  English installer pages. `release\Nazeer Desktop Setup 0.1.0.exe`, 333,368,030 bytes, SHA-256
  `602ce3c7…9fbdd22e`. The generated NSIS script (`release\builder-debug.yml`) shows both
  languages, `installer.nsh` included and `customHeader` inserted after electron-builder's message
  tables. The first installer (placeholder icon, English only) is kept in
  `runs\stageB\first-build\`.
- **The rebuilt installer, install-checked on this laptop at the third attempt:** Smart App Control
  refused to run it at 18:40 and again at 18:59 (Code Integrity 3077), then let it run at 19:21:
  `npm run smoke:packaged -- --move-profile-aside` passed 24/24 (silent per-user install 156 s,
  1,643 MB; real-model engine ready 11.4 s after activation, Arabic stack ok; quit, relaunch, the
  renamed exe, silent uninstall; the profile restored). The silent install skips the language
  dialog and the installer pages, so the Arabic pages are checked only by the operator's clean-PC
  run below, which still stands: this laptop is not a clean PC.

## Install check on a clean PC (operator)

The smoke above ran on the build laptop, which has the development tools and the Visual C++
runtime installed and runs files it built itself. What remains is a clean Windows 10/11 x64 PC or a
fresh virtual machine, receiving the installer the way a customer would. Note whether Smart App
Control is on there; the field laptop itself waits for a signed installer (below). The keys for the
check are in `runs\stageB\install-check-keys.txt` (gitignored): a 14-day trial key, an expired key
and a tampered key, issued 2026-10-12 with the vendor key.

1. Copy `app\release\Nazeer Desktop Setup 0.1.0.exe`. SmartScreen says "Windows protected your PC"
   (unsigned, no reputation yet): More info → Run anyway. This is expected until the product is
   signed. The installer first asks for its language: choose العربية; every page should read in
   Arabic, right to left (try English once too). The icons (installer, shortcut, window, taskbar)
   show the Nazeer logo.
2. Install with the defaults ("Only for me", no administrator prompt) and note how long it takes.
   The program needs about 1.6 GB, and `%TEMP%` needs room for the compressed archive while
   installing.
3. Start Nazeer Desktop from the Start menu: the Activate screen, in Arabic and English.
4. Paste the tampered key: "This key was not issued for Nazeer, or it has been changed." and its
   Arabic line. Paste the expired key: "This licence key has expired." with its date. Paste the
   trial key: the app opens. The first engine start can take up to a minute.
5. Open About: the licence card says Trial with its end date; the engine card shows `best.pt` and
   the Arabic stack as available.
6. Close the window. Task Manager then shows no `Nazeer Desktop.exe` and no `python.exe` from the
   install folder.
7. Start it again: no Activate screen.
8. Settings → Apps → Nazeer Desktop → Uninstall: the program folder goes;
   `%APPDATA%\Nazeer Desktop` (the licence, sessions, logs) stays by design.
9. Repeat steps 2–8 with "Anyone who uses this computer" (asks for administrator; installs under
   Program Files, which the app cannot write to: the engine must still start in step 5).
10. If possible, also try a Windows account whose name has Arabic letters, a PC that never had the
    Visual C++ redistributable (the app carries its own), a Windows N edition (it needs the Media
    Feature Pack, or the engine cannot load OpenCV), and a PC with no network at all.
11. Send back screenshots of steps 3–5, the install time, and on any failure the two logs in
    `%APPDATA%\Nazeer Desktop\logs\` (`app-engine-stderr.log`, `engine.log`).

Smart App Control on the field laptop stays an open item: it is tested there once a signed
installer exists, not before, and no Smart App Control setting is changed (operator, 2026-10-12).

## Consequences

- Preload surface: `license.getStatus`, `license.activate` (D9's list).
- The signing key must be backed up by the operator: losing it means no new keys for installed
  copies; rotating it means a rebuild, and earlier keys stop verifying.
- Packaging is `npm run dist` (CLAUDE.md "Commands"); `npm run smoke:packaged` re-checks an
  installer on a machine where it may run; the clean-PC checklist above is the operator's.
- `engine/requirements.txt` is now also the installer's package list: a new runtime dependency
  must be pinned there, or staging refuses it.

## Clean-PC check in Windows Sandbox (tool, 2026-10-12)

The operator asked for the clean-PC check above to run in Windows Sandbox on this laptop rather
than on a spare machine ("that's preferable to tying up a spare physical machine for a repeatable
check"). Windows Sandbox was turned on on 2026-10-12 at 23:48 (`Enable-WindowsOptionalFeature
-Online -FeatureName Containers-DisposableClientVM -All -NoRestart`, from an administrator prompt
the operator approved; `RestartNeeded: True`); it works after the next restart, which the operator
set for the Stage 7 report. No Smart App Control setting was touched.

`npm run check:sandbox` (`app/scripts/sandbox-check.mjs`, with `app/scripts/sandbox/`): the
checklist above, run twice on a clean, disposable copy of this laptop's Windows — no development
tools, no Visual C++ runtime, nothing installed:

- **Host:** checks the feature and that no sandbox runs; issues the keys with the vendor key (a
  3-day trial, an expired key, a tampered key: only keys enter the sandbox, never the private key);
  writes a `.wsb` per run (the run's io folder read-write; the installer's folder, this Node,
  playwright-core, the scripts and the bag's folder read-only; 8 GB; clipboard and printers off),
  starts `WindowsSandbox.exe`, waits for `done.json`, and writes `runs\sandbox_check_<UTC>\summary.md`
  with one verdict per item.
- **Inside** (`sandbox-run.ps1`, run at logon; ASCII only, Arabic built from code points):
  - *network on* — the installer copied with the Mark of the Web (as if downloaded) and started
    through the shell: SmartScreen's warning, More info → Run anyway; the language dialog, Arabic
    chosen; every page screenshotted, its texts saved, and checked right to left (`WS_EX_LAYOUTRTL`);
    "Only for me" chosen by its Arabic label; the install time; the shortcuts and the icons saved;
    then the app (`sandbox-app.mjs`, over the DevTools protocol like `packaged-smoke.mjs`): the
    Activate screen in both languages, the tampered and expired keys refused with their reasons, the
    trial key, the engine (real model), About, a bag through the frame search, a session, finalize,
    approval, **print and seal** (probes PASS), close (app and engine gone), relaunch (no Activate);
    the GUI uninstall (the profile stays); an all-users install under Program Files run by this
    account; a **standard Windows user named «مستخدم»** running that install from Program Files
    (its own profile under `C:\Users\مستخدم`, the Activate path, the bag and the print again); the
    all-users uninstall; the facts (no VC++ runtime in System32; Windows N is not testable: the
    sandbox runs the host's edition);
  - *network off* — a silent per-user install, the same app run with the bag and the print, a silent
    uninstall.
- Status: written, its pure parts unit-tested (the `.wsb`, the verdicts, the summary), and run in
  the Sandbox on 2026-10-13 (results below). Keep the Sandbox window visible and untouched while it
  runs: its screenshots are of that screen, and keys pressed while it has the focus reach it.

**The installer rebuilt with Stages 6 and 7** (2026-10-13 01:25–01:36 local time, 22:25–22:36 UTC on the 12th): `release\Nazeer
Desktop Setup 0.1.0.exe`, 333,577,746 bytes, SHA-256 `0ab0dcf9…f441e0`, unsigned; the engine
restaged with report model 1.1 and the new status label.

**The new installer on this laptop, driven by the Sandbox run's app driver** (2026-10-13 01:51–01:57
local; `scripts/sandbox/sandbox-app.mjs` against a silent per-user install, the packaged profile
moved aside and restored): 12/12 checks — the Activate screen in both languages; the tampered and
expired keys refused with their reasons; the trial key started the real-model engine in 14.3 s
(Arabic stack ok); About (trial, end date, `best.pt`); bag 004 read and searched (7 frames in
19 s); a session, two measurements, finalize (the overlay drawn); approval and **print and seal in
the installed app** (verdict PASS, 4 pages, the only font `AAAAAA+IBMPlexSansArabic`: the
packaged app reads the face from `<resources>\engine\nazeer_engine\assets`); close (app and engine
gone); relaunch without the Activate screen; silent uninstall. Two earlier attempts stopped on the
driver's own mistakes (fixed: it now reloads the page after finishing the session through the
engine's API, and switches the UI to English with the header's own control). Smart App Control
(enforcing) blocked nothing of it. This laptop is not a clean PC: the Sandbox runs still stand.

**The Sandbox runs** (2026-10-13, `runs\sandbox_check_20261013T124217Z`, the installer above): every
item of the checklist passed in a clean Windows 11 Enterprise 24H2 (build 26100) without the Visual
C++ runtime, once with the network (14.3 min) and once without (6.0 min); two findings remain.

| Item | Result | Evidence |
|---|---|---|
| 1 | pass, one layout finding | SmartScreen warned ("Windows protected your PC … prevented an unrecognized app"), More info → Run anyway; 9 s later the language dialog offered English / العربية, and العربية was chosen; every page reads in Arabic, its window mirrored (RTL reading order, the buttons placed mirrored); shortcuts on the desktop and in Start; the icons show the logo. **Finding:** the install-mode page's own controls (electron-builder's page, built at run time) are not mirrored: the radio buttons sit left of their labels and its text starts at the left |
| 2 | pass | through the Arabic pages, «لي وحدي» chosen: 158 s from Install to the last page; silent and offline: 167 s; 1.5 GB needed |
| 3 | pass | the Activate screen first, in Arabic and English (three profiles) |
| 4 | pass | the tampered and the expired key refused with their reasons in both languages; the trial key started the engine with the real model in 5–12 s |
| 5 | pass | About: trial and its end date, `best.pt`, the Arabic stack available (libraqm, the pinned font) |
| 6 | pass | closing the window ended the app and the engine (eight closes) |
| 7 | pass | the second start had no Activate screen |
| 8 | pass, one finding | uninstall through its pages 114 s, silent 17 s; the program and its entry gone, the profile kept. **Finding:** the uninstaller's pages are in English after an Arabic install (the chosen language is not stored for it) |
| 9 | pass | "Anyone who uses this computer": under Program Files in 156 s; the app and its engine ran from there (6/6); uninstalled |
| 10 | pass; Windows N not testable | a standard user «مستخدم» (profile `C:\Users\مستخدم`) ran the all-users install with the bag, print and seal (13/13); no Visual C++ runtime in System32 (the engine used the app's own); no network (the whole offline run); the Sandbox runs Enterprise, not an N edition |
| 11 | pass | 37 screenshots and the logs of every profile in the run folder |
| beyond | pass | in all three profiles: bag 004 read, 7 frames in 20–24 s on CPU, two measurements, the overlay drawn, print and seal PASS (4 pages, only the Plex font) |

Smart App Control inside the Sandbox is in evaluation mode (state 2), so these runs say nothing about
it; it stays an open item for the field laptop with a signed installer. Also seen: the installer's
Arabic mixes NSIS's own «تنصيب» (title, the Install button, the folder page, with «إختر» / «إضغط»)
with this installer's «تثبيت» (the install-mode page).

**Operator, 2026-10-13 — for the next installer rebuild, not now:** the two findings and the
installer's Arabic wording are fixed together in that rebuild, which ends with a Sandbox run: mirror
the install-mode page's controls; store the language chosen in the language dialog so the uninstaller
uses it; one verb for install throughout the installer and the uninstaller (the installer's own
strings replace NSIS's «تنصيب» and its «إختر» / «إضغط»; the operator picks the word at that rebuild).
The installer's wording is handled there, not in the app's batched wording review, which keeps its
planned slot. The `AllowVGPU = 0` policy stays: Sandbox runs on this laptop need it.

What the first attempts showed (the tool and this laptop, not the product):

- Windows Sandbox updated itself to the Store version 0.8.107.0 during the first run (14:03). From the
  next start on no session logged on: inside, `dwm.exe` crashed (0xC00001AD in `udwm.dll`) and Remote
  Desktop closed with reason 16, also with `<VGpu>Disable</VGpu>` and with an empty configuration.
  This laptop has two GPUs (Intel UHD, NVIDIA RTX A3000) and three screens. The documented workaround
  fixed it: the machine policy "Allow vGPU sharing for Windows Sandbox" turned off
  (`HKLM\SOFTWARE\Policies\Microsoft\Windows\Sandbox` `AllowVGPU = 0`, set with the operator's
  approval on 2026-10-13; deleting the value undoes it). The `.wsb` also asks for no vGPU now.
- UI Automation inside the Sandbox reports every control of the NSIS installer as a pane (the language
  list, OK, Cancel), so the tool drives the installer and the uninstaller through their window
  handles: window class, control id, and the messages a click sends. SmartScreen is read with UI
  Automation as before.
- Started with `Start-Process`, the downloaded installer showed no SmartScreen; started through
  Explorer, as a double-click does, it does.
- NSIS mirrors an Arabic dialog with `WS_EX_RTLREADING | WS_EX_RIGHT` and flipped positions, not
  `WS_EX_LAYOUTRTL`; the tool checks those styles and the mirrored buttons. A missing dialog is now a
  failed check of its item, and the run goes on; the summary shows each item per run.
- Closing the Sandbox's window and server by force can leave its virtual machine running for minutes;
  `wsb stop --id <id>` stops it cleanly, and `wsb exec --id <id> -r System` runs a command inside (the
  tool's `C:\nz\io` folder carries the output out).
