/**
 * Browser MCP tools for CDP access to embedded browser tabs.
 *
 * Uses a declarative action DSL instead of arbitrary code execution.
 * Each action is validated against a known schema before execution.
 */

import {
  BaseMCPTool,
  createInputSchema,
  stringProperty,
  arrayProperty,
} from './tool';
import type { ToolCall, ToolResult } from './protocol';
import { executeBrowserActions } from '../../../browser/main/browser.ipc';
import { assetsService } from '../../../notes/main/assets.service';
import { Logger } from '../../../../shared/logger';

const logger = new Logger('BrowserTools');

/**
 * Documentation topics for browser_docs tool
 */
const BROWSER_DOCS: Record<string, string> = {
  overview: `# Browser API Overview

The browser API gives you programmatic access to embedded browser tabs via Chrome DevTools Protocol.
Actions are executed as a sequence of declarative operations.

## Basic Actions
- \`{ action: "listTabs" }\` - List all browser tabs
- \`{ action: "getAccessibilityTree", tabId? }\` - Get page structure as YAML
- \`{ action: "screenshot", tabId? }\` - Take a screenshot
- \`{ action: "evaluate", expression, tabId? }\` - Run JavaScript in the page
- \`{ action: "focusTab", tabId? }\` - Focus/remount a tab

## Capture Actions (for debugging)
- \`{ action: "snapshot", workspaceId, name?, reload?, waitFor? }\` - Quick point-in-time capture
- \`{ action: "startSession", workspaceId, name? }\` / \`{ action: "endSession", sessionId }\` - Multi-step capture
- \`{ action: "startCapture", sessionId }\` / \`{ action: "endCapture", sessionId }\` - Event capture
- \`{ action: "captureStep", sessionId, stepName, reload?, waitFor? }\` - Capture a named step
- \`{ action: "startTrace", sessionId, traceName }\` / \`{ action: "stopTrace", sessionId, traceName }\` - Performance traces

## Navigation
- \`{ action: "navigate", url, tabId? }\` - Navigate an existing tab to a new URL

## Recovery
- \`{ action: "resetTab", tabId? }\` - Force reset CDP connection (use if you get "already attached" errors)

## UI Control
- \`{ action: "openTab", url, position? }\` - Open a new browser tab in the UI
  - position: 'adjacent' (default), 'replace', or 'same'

## Supported Protocols
The embedded browser supports http://, https://, and file:// URLs.
You can open local HTML files directly: \`{ action: "openTab", url: "file:///path/to/index.html" }\`

Use \`browser_docs\` with topic="capture" or topic="examples" for detailed usage.`,

  capture: `# Browser Capture API

Capture is **intentional** - no background listeners run by default. You explicitly instrument when debugging.

## Simple Snapshot

For quick debugging, use the snapshot action:

\`\`\`json
{
  "actions": [
    {
      "action": "snapshot",
      "workspaceId": "my-workspace-id",
      "reload": true,
      "waitFor": { "networkIdle": 2000 }
    }
  ]
}
// Returns: { dir, a11y, screenshot, console?, network?, metadata }

// Then read the summary for quick triage:
{
  "actions": [
    { "action": "getSummary", "captureDir": "/path/to/snapshot" }
  ]
}
\`\`\`

## Multi-Step Session

For capturing a flow (login, checkout, etc.):

\`\`\`json
// 1. Start session
{
  "actions": [
    { "action": "startSession", "workspaceId": "my-workspace-id", "name": "login-flow" }
  ]
}
// Returns: { id: "session-id", ... }

// 2. Capture initial state (reload to get console/network from page load)
{
  "actions": [
    { "action": "captureStep", "sessionId": "session-id", "stepName": "initial", "reload": true }
  ]
}

// 3. Start capturing events, do interaction, capture result
{
  "actions": [
    { "action": "startCapture", "sessionId": "session-id" },
    { "action": "evaluate", "expression": "document.querySelector('#login-btn').click()" },
    { "action": "captureStep", "sessionId": "session-id", "stepName": "after-login" },
    { "action": "endCapture", "sessionId": "session-id" }
  ]
}

// 4. End session
{
  "actions": [
    { "action": "endSession", "sessionId": "session-id" }
  ]
}
// Returns: { dir, steps, console, network, traces, metadata }
\`\`\`

## Performance Traces

Named traces work like setTimeout/clearTimeout:

\`\`\`json
{
  "actions": [
    { "action": "startSession", "workspaceId": "my-workspace-id", "name": "scroll-perf" }
  ]
}
// Get session.id from result

{
  "actions": [
    { "action": "startTrace", "sessionId": "session-id", "traceName": "scroll" },
    { "action": "evaluate", "expression": "window.scrollBy(0, 1000)" },
    { "action": "stopTrace", "sessionId": "session-id", "traceName": "scroll" },
    { "action": "endSession", "sessionId": "session-id" }
  ]
}
\`\`\`

## Wait Conditions

Both snapshot and captureStep support wait conditions:

\`\`\`json
"waitFor": {
  "console": "App ready",      // Wait for console message
  "networkIdle": 2000,         // Wait for no network activity for N ms
  "selector": "#loaded",       // Wait for element to appear
  "timeout": 30000             // Max wait time (default 30s)
}
\`\`\``,

  examples: `# Browser API Examples

## Opening Local HTML Files

You can open local files directly using file:// URLs:

\`\`\`json
// Open a local HTML file
{
  "actions": [
    { "action": "openTab", "url": "file:///Users/me/project/index.html" }
  ]
}

// Navigate an existing tab to a different local file
{
  "actions": [
    { "action": "navigate", "url": "file:///Users/me/project/other.html" }
  ]
}
\`\`\`

## Debugging a Page Load

\`\`\`json
// Capture everything from page load
{
  "actions": [
    {
      "action": "snapshot",
      "workspaceId": "my-workspace-id",
      "reload": true,
      "waitFor": { "networkIdle": 2000 }
    }
  ]
}
// Returns: { dir, a11y, screenshot, console?, network?, metadata }

// Then check summary for quick triage:
{
  "actions": [
    { "action": "getSummary", "captureDir": "/path/from/snapshot/result" }
  ]
}
\`\`\`

## Finding and Clicking Elements

\`\`\`json
// Get accessibility tree to understand page structure
{
  "actions": [
    { "action": "getAccessibilityTree" }
  ]
}

// Find button by accessible name and click it
{
  "actions": [
    {
      "action": "evaluate",
      "expression": "const buttons = document.querySelectorAll('button'); for (const btn of buttons) { if (btn.textContent.includes('Submit')) { btn.click(); break; } }"
    },
    { "action": "getAccessibilityTree" }
  ]
}
\`\`\`

## Capturing a Login Flow

\`\`\`json
// 1. Start session
{
  "actions": [
    { "action": "startSession", "workspaceId": "my-workspace-id", "name": "login-flow" }
  ]
}
// Returns: { id: "session-id", ... }

// 2. Capture initial state
{
  "actions": [
    { "action": "captureStep", "sessionId": "session-id", "stepName": "1-initial", "reload": true }
  ]
}

// 3. Fill credentials and capture
{
  "actions": [
    { "action": "startCapture", "sessionId": "session-id" },
    { "action": "evaluate", "expression": "document.querySelector('#email').value = 'test@example.com'; document.querySelector('#password').value = 'password123';" },
    { "action": "captureStep", "sessionId": "session-id", "stepName": "2-filled" },
    { "action": "evaluate", "expression": "document.querySelector('#login-form').submit()" },
    { "action": "captureStep", "sessionId": "session-id", "stepName": "3-after-submit", "waitFor": { "networkIdle": 2000 } },
    { "action": "endCapture", "sessionId": "session-id" },
    { "action": "endSession", "sessionId": "session-id" }
  ]
}
\`\`\`

## Measuring Scroll Performance

\`\`\`json
// Start session and trace
{
  "actions": [
    { "action": "startSession", "workspaceId": "my-workspace-id", "name": "scroll-perf" }
  ]
}

// Run trace (note: for loops need multiple calls or use evaluate)
{
  "actions": [
    { "action": "startTrace", "sessionId": "session-id", "traceName": "scroll" },
    { "action": "evaluate", "expression": "window.scrollBy(0, 2500)" },
    { "action": "stopTrace", "sessionId": "session-id", "traceName": "scroll" },
    { "action": "endSession", "sessionId": "session-id" }
  ]
}
// Trace file saved to {session}/scroll.json - open in Chrome DevTools Performance tab
\`\`\`

## Debugging Network Requests

\`\`\`json
{
  "actions": [
    { "action": "startSession", "workspaceId": "my-workspace-id", "name": "api-debug" }
  ]
}

{
  "actions": [
    { "action": "startCapture", "sessionId": "session-id" },
    { "action": "evaluate", "expression": "fetch('/api/data').then(r => r.json())" },
    { "action": "captureStep", "sessionId": "session-id", "stepName": "after-fetch", "waitFor": { "networkIdle": 2000 } },
    { "action": "endCapture", "sessionId": "session-id" },
    { "action": "endSession", "sessionId": "session-id" }
  ]
}
// Network requests are in result.network (JSONL file)
\`\`\`

## Comparing Before/After States

\`\`\`json
{
  "actions": [
    { "action": "startSession", "workspaceId": "my-workspace-id", "name": "comparison" }
  ]
}

{
  "actions": [
    { "action": "captureStep", "sessionId": "session-id", "stepName": "before" },
    { "action": "evaluate", "expression": "document.body.style.fontSize = '20px'; document.querySelector('.sidebar').remove();" },
    { "action": "captureStep", "sessionId": "session-id", "stepName": "after" },
    { "action": "endSession", "sessionId": "session-id" }
  ]
}
// Compare the a11y trees in before/ and after/ directories
\`\`\``,
};

const BROWSER_DOCS_TOPICS = Object.keys(BROWSER_DOCS);

/**
 * TypeScript type definitions for action results.
 * This helps the LLM understand what data is returned.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BROWSER_API_TYPES = `
// Result types for browser actions

interface BrowserTab {
  tabId: string;
  webContentsId: number;  // -1 if tab is not mounted
  url: string;
  title: string;
  mounted: boolean;  // true if webview is mounted and ready for CDP commands
}

interface ScreenshotResult {
  base64: string;  // PNG image as base64
  width: number;
  height: number;
}

interface WaitForOptions {
  console?: string;          // Wait for console message containing this string
  networkIdle?: number;      // Wait for network idle for N ms
  selector?: string;         // Wait for element to appear
  timeout?: number;          // Max wait time (default 30s)
}

interface SnapshotResult {
  dir: string;               // Output directory
  a11y: string;              // Path to a11y.yaml
  screenshot: string;        // Path to screenshot.png
  console?: string;          // Path to console.jsonl (if captured)
  network?: string;          // Path to network.jsonl (if captured)
  metadata: { url: string; title: string; timestamp: string; domain: string; };
}

interface CaptureSession {
  id: string;                // Session ID for subsequent calls
  tabId: string;
  workspaceId: string;
  name: string;
  domain: string;
  outputDir: string;
}

interface SessionResult {
  dir: string;               // Output directory
  steps: string[];           // Paths to step directories
  console: string;           // Path to console.jsonl
  network: string;           // Path to network.jsonl
  traces: string[];          // Paths to trace files
  metadata: { url: string; title: string; domain: string; startTime: string; endTime: string; stepCount: number; };
}

interface ActionResult {
  action: string;            // The action that was executed
  success: boolean;
  result?: any;              // Action-specific result (see types above)
  error?: string;            // Error message if success=false
}

interface ExecutionResult {
  success: boolean;
  results: ActionResult[];   // Results for each action in sequence
  error?: string;            // Overall error if execution failed
}
`.trim();

/**
 * Tool to execute browser actions via a declarative DSL.
 *
 * Instead of arbitrary code execution, this tool accepts a sequence of
 * validated actions that are executed in order.
 */
export class BrowserExecTool extends BaseMCPTool {
  constructor() {
    super(
      'browser_exec',
      `Execute browser actions via Chrome DevTools Protocol.

This tool gives you programmatic access to browser tabs embedded in the app. You can:
- List open browser tabs
- Get the accessibility tree (useful for understanding page structure)
- Take screenshots
- Evaluate JavaScript in the browser context (sandboxed to the page)
- Capture snapshots for debugging (uisnap-style)
- Record multi-step flows with console/network logs
- Capture performance traces

**For detailed examples, use \`browser_docs\` tool with topic="examples" or topic="capture".**

## Available Actions

Each action is an object with an "action" field and action-specific parameters:

- \`{ action: "listTabs" }\` - List all browser tabs
- \`{ action: "focusTab", tabId?: string }\` - Focus a tab in the UI
- \`{ action: "getAccessibilityTree", tabId?: string }\` - Get accessibility tree (YAML)
- \`{ action: "screenshot", tabId?: string }\` - Take a screenshot (base64 PNG)
- \`{ action: "evaluate", expression: string, tabId?: string }\` - Run JS in page context
- \`{ action: "snapshot", workspaceId: string, name?: string, reload?: boolean, waitFor?: WaitForOptions }\`
- \`{ action: "startSession", workspaceId: string, name?: string }\`
- \`{ action: "captureStep", sessionId: string, stepName: string, reload?: boolean, waitFor?: WaitForOptions }\`
- \`{ action: "startCapture", sessionId: string }\` - Start capturing console/network
- \`{ action: "endCapture", sessionId: string }\` - Stop capturing
- \`{ action: "startTrace", sessionId: string, traceName: string }\` - Start perf trace
- \`{ action: "stopTrace", sessionId: string, traceName: string }\` - Stop perf trace
- \`{ action: "endSession", sessionId: string }\` - End session and save artifacts
- \`{ action: "navigate", url: string, tabId?: string }\` - Navigate existing tab to URL
- \`{ action: "resetTab", tabId?: string }\` - Reset CDP connection
- \`{ action: "getSummary", captureDir: string }\` - Read capture summary
- \`{ action: "openTab", url: string, position?: "adjacent" | "replace" | "same" }\` - Open new tab

Supports http://, https://, and file:// URLs. You can open local HTML files directly.

## WaitForOptions

\`\`\`typescript
interface WaitForOptions {
  console?: string;      // Wait for console message containing this string
  networkIdle?: number;  // Wait for network idle (ms)
  selector?: string;     // Wait for selector to appear
  timeout?: number;      // Max wait time (ms)
}
\`\`\`

## Examples

\`\`\`json
// List tabs
{ "actions": [{ "action": "listTabs" }] }

// Get accessibility tree and screenshot
{
  "actions": [
    { "action": "getAccessibilityTree" },
    { "action": "screenshot" }
  ],
  "tabId": "tab-123"
}

// Evaluate JS in page
{
  "actions": [
    { "action": "evaluate", "expression": "document.title" }
  ]
}

// Click a button
{
  "actions": [
    { "action": "evaluate", "expression": "document.querySelector('button.submit').click()" }
  ]
}

// Quick snapshot
{
  "actions": [
    { "action": "snapshot", "workspaceId": "my-workspace", "reload": true }
  ]
}
\`\`\`
`,
      createInputSchema(
        {
          actions: arrayProperty(
            'Array of browser actions to execute in sequence. Each action is an object with an "action" field.',
            'object',
          ),
          tabId: stringProperty(
            'Optional: default tab ID for all actions. Individual actions can override this.',
          ),
        },
        ['actions'],
      ),
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { actions, tabId } = call.arguments as { actions: unknown[]; tabId?: string };
      const agentId = call.context?.agentId;
      const workspaceId = call.context?.workspaceId;

      if (!actions || !Array.isArray(actions)) {
        return this.error('actions parameter is required and must be an array');
      }

      if (actions.length === 0) {
        return this.error('actions array cannot be empty');
      }

      const result = await executeBrowserActions(actions, tabId, agentId, workspaceId);

      if (!result.success) {
        return this.error(`Browser action failed: ${result.error}`);
      }

      // Save any screenshot results as workspace assets so they survive ACP truncation.
      // The base64 data is replaced with a workspace-asset:// URL that the frontend can render.
      if (workspaceId) {
        for (const actionResult of result.results) {
          const screenshotData = actionResult.result as
            | { base64?: string; width?: number; height?: number }
            | undefined;
          if (
            actionResult.action === 'screenshot' &&
            actionResult.success &&
            screenshotData?.base64
          ) {
            try {
              const saved = await assetsService.saveAsset(
                workspaceId,
                screenshotData.base64,
                'image/jpeg',
                `screenshot-${Date.now()}.jpg`,
              );
              // Replace the base64 data with the asset URL so the text result stays small
              actionResult.result = {
                assetUrl: saved.url,
                width: screenshotData.width,
                height: screenshotData.height,
              };
            } catch (err) {
              logger.warn('Failed to save screenshot as asset, keeping base64 in result', {
                error: (err as Error).message,
              });
              // Fall through — the base64 will be in the text result (may get truncated)
            }
          }
        }
      }

      // Format results - return the last action's result if single action,
      // or all results if multiple actions
      if (result.results.length === 1) {
        const actionResult = result.results[0];
        if (actionResult.result === undefined || actionResult.result === null) {
          return this.success(`Action '${actionResult.action}' completed`, { tabId });
        }
        const output =
          typeof actionResult.result === 'string'
            ? actionResult.result
            : JSON.stringify(actionResult.result, null, 2);
        return this.success(output, { tabId, action: actionResult.action });
      }

      // Multiple actions - return all results
      const output = JSON.stringify(result.results, null, 2);
      return this.success(output, { tabId, actionCount: result.results.length });
    } catch (error) {
      return this.error(`Browser action error: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to get browser API documentation on-demand.
 *
 * This is a "skill" pattern - documentation that can be pulled in
 * when needed rather than always being in context.
 */
export class BrowserDocsTool extends BaseMCPTool {
  constructor() {
    super(
      'browser_docs',
      `Get documentation and examples for the browser API.

Available topics:
- overview: Quick reference of all available methods
- capture: Detailed guide to the capture/snapshot API for debugging
- examples: Code examples for common tasks

Call this tool when you need to understand how to use the browser API.`,
      createInputSchema(
        {
          topic: stringProperty('Documentation topic to retrieve', { enum: BROWSER_DOCS_TOPICS }),
        },
        ['topic'],
      ),
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const { topic } = call.arguments as { topic: string };

    const docs = BROWSER_DOCS[topic];
    if (!docs) {
      return this.error(
        `Unknown topic: ${topic}. Available topics: ${BROWSER_DOCS_TOPICS.join(', ')}`,
      );
    }

    return this.success(docs);
  }
}
