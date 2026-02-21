# CDP MCP Tools for Agents

## Overview

The CDP (Chrome DevTools Protocol) MCP tools allow **agents** to inspect and interact with the running Intent application. These tools provide full visibility into the UI, enabling agents to debug issues, test interactions, and verify changes.

## Quick Start

```bash
# Start the app with CDP enabled (user runs this in a separate terminal)
pnpm run dev:cdp

# The CDP MCP server is automatically available to agents
# Tools are suffixed with _cdp-debug (e.g., cdp_hello_cdp-debug)
```

## IMPORTANT: Check Dev Server First

**Before using any CDP tools, always verify the dev server is running:**

1. **Call `cdp_hello_cdp-debug()` first** — If it returns a page title like "Intent", CDP is ready
2. **If CDP fails to connect**: The user needs to run `pnpm dev:cdp` in the Intent directory
3. **Don't start the dev server yourself** — The user typically runs it in a separate terminal

If `cdp_hello` fails with a connection error, ask the user:

> "CDP tools require the dev server to be running with CDP enabled. Please run `pnpm dev:cdp` in the Intent directory."

## Available Tools

### Inspection Tools

| Tool                         | Description                                        |
| ---------------------------- | -------------------------------------------------- |
| `cdp_hello`                  | Test CDP connection, returns page title            |
| `cdp_get_accessibility_tree` | Get accessibility tree for finding UI elements     |
| `cdp_get_dom`                | Get raw HTML structure                             |
| `cdp_get_console_logs`       | Get browser console logs (with filtering)          |
| `cdp_screenshot`             | Take screenshots (viewport, full page, or element) |
| `cdp_api_reference`          | Get complete API documentation                     |

### Interaction Tools

| Tool             | Description                                  |
| ---------------- | -------------------------------------------- |
| `cdp_run_script` | Execute JavaScript with Playwright-style API |
| `cdp_reload`     | Reload the page (with optional cache bypass) |
| `cdp_wait`       | Wait for time or element to appear           |

## Workflow Patterns

### Pattern 1: Inspect → Interact → Verify

```
1. cdp_get_accessibility_tree  → Find the element
2. cdp_run_script              → Interact with it
3. cdp_screenshot              → Verify the result
```

### Pattern 2: Debug Console Errors

```
1. cdp_get_console_logs({ types: ['error', 'warn'] })  → Find errors
2. cdp_get_accessibility_tree                          → Inspect UI state
3. cdp_run_script                                      → Test fixes
```

### Pattern 3: Test After Code Changes

```
1. cdp_reload({ ignoreCache: true })  → Reload with fresh code
2. cdp_wait({ selector: '.app' })     → Wait for app to load
3. cdp_screenshot                     → Capture current state
```

## Playwright-Style API

The `cdp_run_script` tool provides a `cdp` global object with Playwright-style locators:

```javascript
// Find by role
await cdp.getByRole('button', { name: 'Submit' }).click();

// Find by text
await cdp.getByText('Welcome').textContent();

// Find by test ID
await cdp.getByTestId('status-indicator').isVisible();

// Find by label
await cdp.getByLabel('Email').fill('user@example.com');

// Find by placeholder
await cdp.getByPlaceholder('Search...').fill('query');

// CSS selector
await cdp.locator('.my-class').click();

// Chaining
const count = await cdp.getByRole('listitem').count();
const first = await cdp.getByRole('listitem').first().textContent();
```

## Architecture

```
Agent (Auggie/External)
    |
    | MCP Protocol (STDIO)
    v
CDP MCP Server (cdp-mcp-server/dist/server.cjs)
    |
    | Chrome DevTools Protocol
    v
Electron App (--remote-debugging-port=9223)
    |
    v
Renderer Process (UI)
```

## Environment Variables

| Variable           | Description           | Default |
| ------------------ | --------------------- | ------- |
| `CDP_PORT`         | CDP debugging port    | 9223    |
| `ENABLE_CDP_DEBUG` | Enable CDP tools      | false   |
| `NODE_ENV`         | Must be `development` | -       |

## Troubleshooting

| Issue            | Solution                                      |
| ---------------- | --------------------------------------------- |
| Cannot connect   | Ensure app is running with `pnpm run dev:cdp` |
| CDP disconnected | App was restarted; server will auto-reconnect |
| Port conflict    | Check `lsof -i :9223` for conflicts           |

## Related Files

| File                                                    | Purpose                          |
| ------------------------------------------------------- | -------------------------------- |
| `cdp-mcp-server/server.ts`                              | STDIO MCP server implementation  |
| `cdp-mcp-server/cdp-helpers.js`                         | Playwright-style API helpers     |
| `src/features/agent/instructions/base-system-prompt.ts` | Agent instructions for CDP tools |
