---
name: electron
description: Automate Electron desktop apps (VS Code, Slack, Discord, Figma, Notion, Spotify, etc.) using agent-browser via Chrome DevTools Protocol. Use when the user needs to interact with an Electron app, automate a desktop app, connect to a running app, control a native app, or test an Electron application. Triggers include "automate Slack app", "control VS Code", "interact with Discord app", "test this Electron app", "connect to desktop app", or any task requiring automation of a native Electron application.
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*)
---

# Electron App Automation

Automate any Electron desktop app using agent-browser. Electron apps are built on Chromium and expose a Chrome DevTools Protocol (CDP) port that agent-browser can connect to, enabling the same snapshot-interact workflow used for web pages.

## Core Workflow

1. **Launch** the Electron app with remote debugging enabled
2. **Connect** agent-browser to the CDP port
3. **Snapshot** to discover interactive elements
4. **Interact** using element refs
5. **Re-snapshot** after navigation or state changes

```bash
# Launch an Electron app with remote debugging
open -a "Slack" --args --remote-debugging-port=9222

# Connect agent-browser to the app
agent-browser connect 9222

# Standard workflow from here
agent-browser snapshot -i
agent-browser click @e5
agent-browser screenshot slack-desktop.png
```

## Wait for renderer readiness

Use one self-checking workspace hook when a cold renderer launch may outlive the current
turn. On this dev box, five cold `dev:ui` launches under concurrent unit-test load reached
`[data-preview-ready=true]` in 41.774, 18.466, 19.303, 22.526, and 20.318 seconds. The
nearest-rank p95 was 41.774 seconds, so 3× p95 is 125.322 seconds (round to 126 seconds)
as the expected readiness margin. The hook stays alive for 615 seconds so its explicit
10-minute failure ceiling can run, with one 15-second cadence of TTL margin.

Replace `TARGET_URL` and `EXPECTED_TITLE`, open or reuse the target tab, then schedule:

```javascript
const TARGET_URL = 'http://daemon.localhost:5190/sandbox/button?state=default';
const EXPECTED_TITLE = 'Intent';
const CEILING_MS = 600_000;

return await ws.hook.schedule({
  name: 'Wait for renderer readiness',
  delayMs: 15_000,
  ttlMs: 615_000,
  perpetual: false,
  code: `
    const previous = hookState ?? {
      startedAt: Date.now(), attempts: 0, lastReady: null
    };
    const attempts = previous.attempts + 1;
    const elapsedMs = Date.now() - previous.startedAt;
    if (elapsedMs >= ${CEILING_MS}) {
      return { dispatch: true, message:
        "Renderer was not ready after 10 minutes; treat the launch as broken." };
    }
    const listed = await ws.browser.exec([
      { action: "listTabs", scope: "mine" }
    ]);
    const tabs = listed?.success ? listed.result : [];
    const tab = tabs.find(candidate =>
      [candidate.requestedUrl, candidate.url, candidate.finalUrl]
        .some(url => url?.startsWith(${JSON.stringify(TARGET_URL)}))
    );
    let ready = false;
    if (tab) {
      const probe = await ws.browser.exec([{ action: "evaluate", tabId: tab.tabId,
        expression: ${JSON.stringify(`Boolean(document.querySelector("[data-preview-ready=true]")) || document.title === ${JSON.stringify(EXPECTED_TITLE)}`)} }]);
      ready = probe?.success && probe.result === true;
    }
    const state = { ...previous, attempts, lastReady: ready };
    if (ready && ready !== previous.lastReady) {
      return { dispatch: true, message:
        "Renderer readiness signal appeared after " + elapsedMs + " ms." };
    }
    return { dispatch: false, state };
  `,
});
```

Each run performs the readiness check itself, compares the result with `hookState`, and
returns without dispatch while readiness is unchanged. The two browser calls stay well
inside the hook's 60-second per-run budget. The 10-minute ceiling, not the TTL, is the
failure mechanism because it dispatches the caller-authored diagnostic. Hook expiry also
wakes the owner, but only with the generic expiry notice; it is a backstop that prompts
reassessment, not a reason to silently schedule another hook.

Use `perpetual: false` for one readiness transition: the first dispatch retires the hook.
Use `perpetual: true` only when the caller needs a stream of readiness or health changes;
in that case persist the last observed health in `hookState` and dispatch only when it
changes.

## Launching Electron Apps with CDP

Every Electron app supports the `--remote-debugging-port` flag since it's built into Chromium.

### macOS

```bash
# Slack
open -a "Slack" --args --remote-debugging-port=9222

# VS Code
open -a "Visual Studio Code" --args --remote-debugging-port=9223

# Discord
open -a "Discord" --args --remote-debugging-port=9224

# Figma
open -a "Figma" --args --remote-debugging-port=9225

# Notion
open -a "Notion" --args --remote-debugging-port=9226

# Spotify
open -a "Spotify" --args --remote-debugging-port=9227
```

### Linux

```bash
slack --remote-debugging-port=9222
code --remote-debugging-port=9223
discord --remote-debugging-port=9224
```

### Windows

```bash
"C:\Users\%USERNAME%\AppData\Local\slack\slack.exe" --remote-debugging-port=9222
"C:\Users\%USERNAME%\AppData\Local\Programs\Microsoft VS Code\Code.exe" --remote-debugging-port=9223
```

**Important:** If the app is already running, quit it first, then relaunch with the flag. The `--remote-debugging-port` flag must be present at launch time.

## Connecting

```bash
# Connect to a specific port
agent-browser connect 9222

# Or use --cdp on each command
agent-browser --cdp 9222 snapshot -i

# Auto-discover a running Chromium-based app
agent-browser --auto-connect snapshot -i
```

After `connect`, all subsequent commands target the connected app without needing `--cdp`.

## Tab Management

Electron apps often have multiple windows or webviews. Use tab commands to list and switch between them:

```bash
# List all available targets (windows, webviews, etc.)
agent-browser tab

# Switch to a specific tab by index
agent-browser tab 2

# Switch by URL pattern
agent-browser tab --url "*settings*"
```

## Common Patterns

### Inspect and Navigate an App

```bash
open -a "Slack" --args --remote-debugging-port=9222
sleep 3  # Wait for app to start
agent-browser connect 9222
agent-browser snapshot -i
# Read the snapshot output to identify UI elements
agent-browser click @e10  # Navigate to a section
agent-browser snapshot -i  # Re-snapshot after navigation
```

### Take Screenshots of Desktop Apps

```bash
agent-browser connect 9222
agent-browser screenshot app-state.png
agent-browser screenshot --full full-app.png
agent-browser screenshot --annotate annotated-app.png
```

### Extract Data from a Desktop App

```bash
agent-browser connect 9222
agent-browser snapshot -i
agent-browser get text @e5
agent-browser snapshot --json > app-state.json
```

### Fill Forms in Desktop Apps

```bash
agent-browser connect 9222
agent-browser snapshot -i
agent-browser fill @e3 "search query"
agent-browser press Enter
agent-browser wait 1000
agent-browser snapshot -i
```

### Run Multiple Apps Simultaneously

Use named sessions to control multiple Electron apps at the same time:

```bash
# Connect to Slack
agent-browser --session slack connect 9222

# Connect to VS Code
agent-browser --session vscode connect 9223

# Interact with each independently
agent-browser --session slack snapshot -i
agent-browser --session vscode snapshot -i
```

## Color Scheme

Playwright overrides the color scheme to `light` by default when connecting via CDP. To preserve dark mode:

```bash
agent-browser connect 9222
agent-browser --color-scheme dark snapshot -i
```

Or set it globally:

```bash
AGENT_BROWSER_COLOR_SCHEME=dark agent-browser connect 9222
```

## Troubleshooting

### "Connection refused" or "Cannot connect"

- Make sure the app was launched with `--remote-debugging-port=NNNN`
- If the app was already running, quit and relaunch with the flag
- Check that the port isn't in use by another process: `lsof -i :9222`

### App launches but connect fails

- Wait a few seconds after launch before connecting (`sleep 3`)
- Some apps take time to initialize their webview

### Elements not appearing in snapshot

- The app may use multiple webviews. Use `agent-browser tab` to list targets and switch to the right one
- Use `agent-browser snapshot -i -C` to include cursor-interactive elements (divs with onclick handlers)

### Cannot type in input fields

- Try `agent-browser keyboard type "text"` to type at the current focus without a selector
- Some Electron apps use custom input components; use `agent-browser keyboard inserttext "text"` to bypass key events

## Supported Apps

Any app built on Electron works, including:

- **Communication:** Slack, Discord, Microsoft Teams, Signal, Telegram Desktop
- **Development:** VS Code, GitHub Desktop, Postman, Insomnia
- **Design:** Figma, Notion, Obsidian
- **Media:** Spotify, Tidal
- **Productivity:** Todoist, Linear, 1Password

If an app is built with Electron, it supports `--remote-debugging-port` and can be automated with agent-browser.
