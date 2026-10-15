# Public composer: external desktop file drop

This opt-in native suite runs against the actual `message-composer` / `max-files`
catalog fixture, once per Svelte and React host. It is separate from the ordinary
headless extended project: chooser and internal queue drag tests cannot establish
external file delivery. Missing native prerequisites fail; nothing is skipped.

Use a task-owned isolated Ubuntu 24.04 desktop, with Xvfb (1400×1100×24), Openbox
3.6.1-12build5, PCManFM 1.3.2-4build2, xdotool 1:3.20160805.1-5build1, and
ImageMagick's `import`. The test invokes their `/usr/bin` OS executables directly,
not package-manager binaries. An isolated container may install those packages; do not
reconfigure a user's desktop. Start Openbox under a private D-Bus session. Do not
run another browser/file manager on this display or run these cases concurrently.

The dedicated project requires headed Chromium 153.0.8010.12 (Playwright build1243, revision
971a7443b0c9b0a9b2860529b33331b76077ec62). The test checks the executable SHA-256;
point `PARITY_NATIVE_CHROMIUM` at the real pinned binary, not a wrapper. Node must
satisfy the repository's engine requirement. Use the repository's installed pnpm.

Serve each renderer's real catalog from an owned **daemon-free** static preview.
The host must expose `/sandbox/message-composer`, the real maintained
`ComposerCatalogPreview` / `MessageComposerCatalogPreview`, its declared fixture
metadata and ordinary callbacks. No mock composer or application backend may be
substituted. The fixture has its declared 420px width; the browser viewport is
650×900 to leave desktop room for the file manager. Keep both hosts on identical
source revisions and record the build inputs and dependency provenance. For
source edits, rebuild before running; never edit sources during a run.

From the checkout root, inside the owned desktop environment, run the following
with a fresh evidence directory and the appropriate source root/preview URL for
**each** renderer:

```sh
DISPLAY=:95 \
PARITY_NATIVE_CHROMIUM=/path/to/chromium-1243/chrome-linux64/chrome \
PARITY_RUN_DIR=/absolute/task-evidence/source-drop \
PARITY_CANDIDATE_ROOT="$PWD" \
PARITY_CANDIDATE_URL=http://127.0.0.1:5412 \
pnpm exec playwright test --config packages/view-parity/playwright.config.mjs --project composer-os-drop
```

The suite makes actual task-local PNG/text files. PCManFM supplies native XDND
file data, driven by XTest mouse input. Each single-file directory is selected
with Ctrl+A, avoiding a click-then-press being interpreted as double-click/open.
The first icon coordinates are a pinned desktop contract, backed by retained
full-desktop screenshots. Changed desktop geometry must fail delivery, not be
silently compensated by browser payload injection. The gesture waits for trusted
`dragover`, moves within the target to complete the native acceptance handshake,
and releases the mouse. There is no fixed readiness sleep or drag retry.

Assertions require trusted `dragenter`/`dragover`/`drop`, actual `File` identities,
MIME/name/size/mtime and SHA-256 matching local bytes. They independently verify
accept rejection, repeated-file deduplication, accumulated maxFiles=2 retention,
and the exact ordinary callback payload after Send. Every drop is proven even
when the application should reject it. The fixture only records callbacks; no
live chat send or other backend mutation is allowed. Runtime/resource errors,
source changes, WebSockets, nonlocal requests and non-GET requests fail.

Inspect the desktop source-selection images and component before/after PNGs,
alongside event/geometry/provenance attachments. Preserve failed runs separately.
The suite releases the mouse, closes its owned file-manager processes, and removes
observers in finally. Stop the task-owned browser, previews and desktop/container
at handoff. Do not touch an unrelated maintained preview.

This establishes Linux X11/PCManFM automated OS-input coverage only. It does not
establish Wayland/macOS/Windows delivery, clipboard file paste,
strict native IME completion trust, or live product composer behavior.
