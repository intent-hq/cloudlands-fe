#!/usr/bin/env node
"use strict";
/**
 * CDP MCP STDIO Server
 *
 * Standalone STDIO-based MCP server that connects to Chrome DevTools Protocol
 * for debugging Electron applications.
 *
 * Usage:
 *   node dist/cdp-mcp-stdio-server.js
 *
 * Environment Variables:
 *   CDP_PORT - CDP debugging port (default: 9223)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const chrome_remote_interface_1 = __importDefault(require("chrome-remote-interface"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Override console to log to stderr only (stdout is for JSON-RPC)
const logToStderr = (level, message, context) => {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    process.stderr.write(`[${timestamp}] [${level}] [CdpMcpStdio] ${message}${contextStr}\n`);
};
console.log = (...args) => logToStderr('LOG', args.join(' '));
console.error = (...args) => logToStderr('ERROR', args.join(' '));
console.warn = (...args) => logToStderr('WARN', args.join(' '));
console.info = (...args) => logToStderr('INFO', args.join(' '));
console.debug = (...args) => logToStderr('DEBUG', args.join(' '));
// CDP client
let cdpClient = null;
// CDP helpers code (loaded once at startup)
let cdpHelpersCode = '';
const MAX_CONSOLE_LOGS = 1000;
const consoleLogs = [];
// Load CDP helpers
function loadCdpHelpers() {
    try {
        // cdp-helpers.js is always in the same directory as this file
        // Works both when running with tsx (cdp-mcp-server/server.ts) and built (cdp-mcp-server/dist/server.js)
        const helpersPath = path_1.default.join(path_1.default.dirname(__filename), 'cdp-helpers.js');
        logToStderr('DEBUG', `Loading CDP helpers from: ${helpersPath}`);
        logToStderr('DEBUG', `__filename: ${__filename}`);
        cdpHelpersCode = fs_1.default.readFileSync(helpersPath, 'utf-8');
        logToStderr('INFO', `Loaded CDP helpers (${cdpHelpersCode.length} bytes)`);
    }
    catch (error) {
        logToStderr('ERROR', `Failed to load CDP helpers: ${error.message}`);
        logToStderr('ERROR', `Attempted path: ${path_1.default.join(path_1.default.dirname(__filename), 'cdp-helpers.js')}`);
        throw error;
    }
}
// Connect to CDP
async function connectCDP() {
    const port = parseInt(process.env.CDP_PORT || '9223', 10);
    try {
        logToStderr('INFO', `Connecting to CDP on port ${port}`);
        // Get list of available targets and filter out DevTools pages
        const targets = await chrome_remote_interface_1.default.List({ port });
        logToStderr('DEBUG', `Found ${targets.length} CDP targets`);
        // Find the main app page (not DevTools)
        const appTarget = targets.find((t) => t.type === 'page' &&
            !t.url.startsWith('devtools://') &&
            !t.title.toLowerCase().includes('devtools'));
        if (appTarget) {
            logToStderr('INFO', `Connecting to target: ${appTarget.title} (${appTarget.url})`);
            cdpClient = await (0, chrome_remote_interface_1.default)({ port, target: appTarget.id });
        }
        else {
            // Fallback to default connection if no suitable target found
            logToStderr('WARN', 'No app target found, using default connection');
            cdpClient = await (0, chrome_remote_interface_1.default)({ port });
        }
        // Enable required domains
        await cdpClient.Runtime.enable();
        await cdpClient.DOM.enable();
        await cdpClient.Accessibility.enable();
        // Enable console log capture
        await setupConsoleCapture();
        logToStderr('INFO', `Connected to CDP on port ${port}`);
        // Handle disconnection
        cdpClient.on('disconnect', () => {
            logToStderr('WARN', 'CDP disconnected - Electron app may have been closed or restarted');
            cdpClient = null;
        });
    }
    catch (error) {
        logToStderr('ERROR', `Failed to connect to CDP: ${error.message}`);
        throw new Error(`Cannot connect to Electron app. Is it running with --remote-debugging-port=${port}?`);
    }
}
// Helper function to sleep
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// Setup console log capture
async function setupConsoleCapture() {
    if (!cdpClient) {
        return;
    }
    try {
        // Listen to Runtime.consoleAPICalled events
        cdpClient.Runtime.consoleAPICalled((params) => {
            const entry = {
                timestamp: Date.now(),
                type: params.type,
                args: params.args.map((arg) => {
                    // Extract the value from the RemoteObject
                    if (arg.value !== undefined) {
                        return arg.value;
                    }
                    else if (arg.description !== undefined) {
                        return arg.description;
                    }
                    else if (arg.type === 'undefined') {
                        return undefined;
                    }
                    else {
                        return `[${arg.type}]`;
                    }
                }),
                stackTrace: params.stackTrace,
            };
            // Add to circular buffer
            consoleLogs.push(entry);
            if (consoleLogs.length > MAX_CONSOLE_LOGS) {
                consoleLogs.shift(); // Remove oldest entry
            }
        });
        logToStderr('INFO', 'Console log capture enabled');
    }
    catch (error) {
        logToStderr('WARN', `Failed to setup console capture: ${error.message}`);
    }
}
// Attempt to reconnect to CDP if disconnected
async function ensureCDPConnected() {
    if (cdpClient) {
        return; // Already connected
    }
    const retryDelays = [0, 500, 1000]; // Try immediately, then after 500ms, then after 1s
    const port = parseInt(process.env.CDP_PORT || '9223', 10);
    let lastError = null;
    for (let attempt = 0; attempt < retryDelays.length; attempt++) {
        try {
            if (attempt === 0) {
                logToStderr('INFO', 'CDP not connected, attempting to reconnect...');
            }
            else {
                logToStderr('INFO', `Reconnection attempt ${attempt + 1}/${retryDelays.length}`);
            }
            await connectCDP();
            logToStderr('INFO', 'Successfully reconnected to CDP');
            return;
        }
        catch (error) {
            lastError = error;
            if (attempt < retryDelays.length - 1) {
                const delay = retryDelays[attempt + 1];
                logToStderr('WARN', `Reconnection attempt ${attempt + 1} failed, retrying in ${delay}ms`);
                await sleep(delay);
            }
        }
    }
    // All retries exhausted
    throw new Error(`Failed to reconnect to CDP after ${retryDelays.length} attempts.\n` +
        `Last error: ${lastError?.message}\n\n` +
        `Please ensure the Electron app is running with CDP enabled:\n` +
        `  pnpm run dev:cdp\n` +
        `Or start Electron with --remote-debugging-port=${port}`);
}
// CDP Tools
const tools = [
    {
        name: 'cdp_hello',
        description: `Test CDP connection and get basic page information.

Returns page title, current URL, and connection status.`,
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'cdp_api_reference',
        description: `Get the complete API reference for CDP tools.

Call this tool when you need detailed documentation on:
- The Playwright-style API available in cdp_run_script (cdp.getByRole, locators, actions, etc.)
- How to use cdp_get_accessibility_tree effectively
- Best practices and workflow patterns
- Code examples

This keeps the main tool descriptions concise while providing full documentation on-demand.`,
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'cdp_run_script',
        description: `Execute JavaScript in the Electron renderer to interact with the UI or inspect page state.

The script has access to a 'cdp' global object with a Playwright-style API for reliable UI automation (element finding, clicking, filling forms, waiting, etc.).

Call cdp_api_reference for full API documentation and examples.`,
        inputSchema: {
            type: 'object',
            properties: {
                script: {
                    type: 'string',
                    description: 'JavaScript code with access to the cdp Playwright-style API. Runs in async function context. Use return to send results back.',
                },
            },
            required: ['script'],
        },
    },
    {
        name: 'cdp_get_dom',
        description: `Get raw HTML structure of the page or a specific element.

Use cdp_get_accessibility_tree for finding interactive elements. Use this for inspecting HTML attributes, CSS classes, or raw markup.`,
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'Optional CSS selector to get specific element. If not provided, returns full document HTML.',
                },
            },
            required: [],
        },
    },
    {
        name: 'cdp_get_accessibility_tree',
        description: `Get the accessibility tree for the page or a specific element. Returns structured accessibility information including roles, names, properties, and ARIA attributes. Use this to understand the accessibility structure before writing interaction scripts.`,
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'Optional CSS selector to get accessibility tree for a specific element and its descendants. If not provided, returns the full page accessibility tree. Using a selector is more efficient for large pages.',
                },
                depth: {
                    type: 'integer',
                    description: 'Maximum depth of descendants to retrieve when getting the full tree (no selector). If omitted, returns the complete tree. Only applies when selector is not provided.',
                },
                fetchRelatives: {
                    type: 'boolean',
                    description: 'When using a selector, whether to include parent and sibling nodes for context. Default: false.',
                },
            },
            required: [],
        },
    },
    {
        name: 'cdp_get_console_logs',
        description: `Get browser console logs captured from the Electron renderer process.

Console logs are automatically captured when the CDP connection is established. This tool retrieves the buffered logs with optional filtering.`,
        inputSchema: {
            type: 'object',
            properties: {
                count: {
                    type: 'integer',
                    description: 'Maximum number of recent logs to return. Default: 100. Maximum: 1000.',
                },
                filter: {
                    type: 'string',
                    description: 'Optional filter string. Only logs containing this string (case-insensitive) will be returned. Useful for filtering by log level like "[DEBUG]" or "[ERROR]", or by specific keywords.',
                },
                types: {
                    type: 'array',
                    description: 'Optional array of console types to include. Valid types: "log", "error", "warn", "info", "debug". If not specified, all types are included.',
                    items: {
                        type: 'string',
                    },
                },
            },
            required: [],
        },
    },
    {
        name: 'cdp_screenshot',
        description: `Take a screenshot of the current page or a specific element.

Returns the screenshot as a base64-encoded PNG image. Useful for:
- Debugging visual issues
- Verifying UI state after interactions
- Documenting the current state of the application`,
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'Optional CSS selector to screenshot a specific element. If not provided, captures the full viewport.',
                },
                fullPage: {
                    type: 'boolean',
                    description: 'If true, captures the full scrollable page instead of just the viewport. Default: false. Ignored when selector is provided.',
                },
                quality: {
                    type: 'integer',
                    description: 'Image quality for JPEG format (0-100). Default: 80. Only applies when format is jpeg.',
                },
                format: {
                    type: 'string',
                    description: 'Image format: "png" or "jpeg". Default: "png".',
                    enum: ['png', 'jpeg'],
                },
            },
            required: [],
        },
    },
    {
        name: 'cdp_reload',
        description: `Reload the current page.

Useful for:
- Testing changes after modifying code
- Resetting the application state
- Clearing cached data`,
        inputSchema: {
            type: 'object',
            properties: {
                ignoreCache: {
                    type: 'boolean',
                    description: 'If true, bypasses the browser cache and forces a full reload. Default: false.',
                },
            },
            required: [],
        },
    },
    {
        name: 'cdp_wait',
        description: `Wait for a specified amount of time or for an element to appear.

Useful for:
- Waiting for async operations to complete
- Waiting for UI elements to appear after navigation
- Adding delays between interactions`,
        inputSchema: {
            type: 'object',
            properties: {
                ms: {
                    type: 'integer',
                    description: 'Time to wait in milliseconds. Default: 1000.',
                },
                selector: {
                    type: 'string',
                    description: 'Optional CSS selector to wait for. If provided, waits until the element exists in the DOM.',
                },
                timeout: {
                    type: 'integer',
                    description: 'Maximum time to wait for selector in milliseconds. Default: 5000. Only applies when selector is provided.',
                },
            },
            required: [],
        },
    },
];
// Tool handlers
async function handleCdpHello() {
    await ensureCDPConnected();
    const result = await cdpClient.Runtime.evaluate({
        expression: 'document.title',
        returnByValue: true,
    });
    if (result.exceptionDetails) {
        throw new Error(`Script error: ${result.exceptionDetails.text}`);
    }
    return {
        content: [
            {
                type: 'text',
                text: `Page title: ${result.result.value}`,
            },
        ],
    };
}
function handleCdpApiReference() {
    return {
        content: [
            {
                type: 'text',
                text: `# CDP Tools API Reference

## Overview

The CDP tools provide Playwright-style UI automation for Electron applications via Chrome DevTools Protocol.

**Typical Workflow:**
1. Use \`cdp_get_accessibility_tree\` to inspect page structure and find interactive elements
2. Write a script using \`cdp_run_script\` with the Playwright-style API to interact with elements
3. Verify results and repeat as needed

---

## cdp_run_script - Playwright-Style API

When you call \`cdp_run_script\`, your JavaScript code has access to a global \`cdp\` object with the following API:

### Element Finding (Locators)

**cdp.getByRole(role, options?)**
Find elements by ARIA role. Most reliable method for accessibility-friendly selection.
- \`role\`: string - ARIA role (button, link, textbox, checkbox, dialog, etc.)
- \`options.name\`: string | RegExp - Filter by accessible name
- Returns: Locator

Example:
\`\`\`javascript
const button = cdp.getByRole('button', { name: /new workspace/i });
const link = cdp.getByRole('link', { name: 'Settings' });
\`\`\`

**cdp.getByText(text, options?)**
Find elements by visible text content.
- \`text\`: string | RegExp - Text to match
- \`options.exact\`: boolean - Exact match (default: false)
- Returns: Locator

Example:
\`\`\`javascript
const heading = cdp.getByText('Welcome');
const item = cdp.getByText(/workspace.*created/i);
\`\`\`

**cdp.getByTestId(testId)**
Find elements by data-testid attribute. Useful for elements with explicit test identifiers.
- \`testId\`: string - The data-testid value
- Returns: Locator

Example:
\`\`\`javascript
const chatInput = cdp.getByTestId('chat-input');
const submitBtn = cdp.getByTestId('submit-button');
\`\`\`

**cdp.getByLabel(label, options?)**
Find elements by their associated label (aria-label or <label> element).
- \`label\`: string | RegExp - Label text to match
- \`options.exact\`: boolean - Exact match (default: false)
- Returns: Locator

Example:
\`\`\`javascript
const input = cdp.getByLabel('Email address');
const checkbox = cdp.getByLabel(/remember me/i);
\`\`\`

**cdp.getByPlaceholder(placeholder, options?)**
Find elements by placeholder attribute.
- \`placeholder\`: string | RegExp - Placeholder text to match
- \`options.exact\`: boolean - Exact match (default: false)
- Returns: Locator

Example:
\`\`\`javascript
const searchInput = cdp.getByPlaceholder('Search...');
const emailField = cdp.getByPlaceholder(/enter.*email/i);
\`\`\`

**cdp.locator(selector)**
Find elements by CSS selector.
- \`selector\`: string - CSS selector
- Returns: Locator

Example:
\`\`\`javascript
const input = cdp.locator('input[type="text"]');
const dialog = cdp.locator('[role="dialog"]');
\`\`\`

### Locator Actions (Auto-waiting)

All actions automatically wait for the element to be ready (visible, enabled, stable).

**locator.click(options?)**
Click the element.
- \`options.timeout\`: number - Max wait time in ms (default: 30000)
- Returns: Promise<void>

Example:
\`\`\`javascript
await cdp.getByRole('button', { name: 'Submit' }).click();
\`\`\`

**locator.fill(value, options?)**
Fill an input or textarea.
- \`value\`: string - Text to fill
- \`options.timeout\`: number - Max wait time in ms (default: 30000)
- Returns: Promise<void>

Example:
\`\`\`javascript
await cdp.locator('input[name="email"]').fill('user@example.com');
\`\`\`

**locator.clear(options?)**
Clear an input or textarea.
- \`options.timeout\`: number - Max wait time in ms (default: 30000)
- Returns: Promise<void>

Example:
\`\`\`javascript
await cdp.locator('input[name="search"]').clear();
\`\`\`

### Locator Queries

**locator.textContent()**
Get the text content of the element.
- Returns: Promise<string | null>

**locator.innerText()**
Get the visible text of the element.
- Returns: Promise<string>

**locator.isVisible()**
Check if the element is visible.
- Returns: Promise<boolean>

**locator.count()**
Count matching elements.
- Returns: Promise<number>

Example:
\`\`\`javascript
const text = await cdp.getByRole('heading').textContent();
const isVisible = await cdp.locator('.modal').isVisible();
const buttonCount = await cdp.getByRole('button').count();
\`\`\`

### Locator Filtering

**locator.first()**
Get the first matching element.
- Returns: Locator

**locator.last()**
Get the last matching element.
- Returns: Locator

**locator.nth(index)**
Get the nth matching element (0-based).
- \`index\`: number
- Returns: Locator

Example:
\`\`\`javascript
await cdp.getByRole('button').first().click();
await cdp.locator('li').nth(2).click();
\`\`\`

### Waiting

**locator.waitFor(options?)**
Wait for the element to reach a specific state.
- \`options.state\`: 'visible' | 'hidden' | 'attached' (default: 'visible')
- \`options.timeout\`: number - Max wait time in ms (default: 30000)
- Returns: Promise<void>

Example:
\`\`\`javascript
await cdp.locator('.loading-spinner').waitFor({ state: 'hidden' });
await cdp.getByRole('dialog').waitFor({ state: 'visible' });
\`\`\`

**cdp.waitForURL(pattern, options?)**
Wait for the URL to match a pattern.
- \`pattern\`: string | RegExp - URL pattern to match
- \`options.timeout\`: number - Max wait time in ms (default: 30000)
- Returns: Promise<void>

Example:
\`\`\`javascript
await cdp.waitForURL(/workspace\\/\\d+/);
await cdp.waitForURL('https://example.com/dashboard');
\`\`\`

### Navigation & Page Info

**cdp.url()**
Get the current URL.
- Returns: string

**cdp.title()**
Get the page title.
- Returns: string

Example:
\`\`\`javascript
const currentUrl = cdp.url();
const pageTitle = cdp.title();
\`\`\`

### Storage

**cdp.storage.getLocal(key)**
Get a value from localStorage.
- \`key\`: string
- Returns: string | null

**cdp.storage.setLocal(key, value)**
Set a value in localStorage.
- \`key\`: string
- \`value\`: string
- Returns: void

**cdp.storage.keysLocal()**
Get all keys from localStorage.
- Returns: string[]

**cdp.storage.getSession(key)**
Get a value from sessionStorage.
- \`key\`: string
- Returns: string | null

**cdp.storage.setSession(key, value)**
Set a value in sessionStorage.
- \`key\`: string
- \`value\`: string
- Returns: void

**cdp.storage.keysSession()**
Get all keys from sessionStorage.
- Returns: string[]

Example:
\`\`\`javascript
const token = cdp.storage.getLocal('auth_token');
cdp.storage.setLocal('theme', 'dark');
const allKeys = cdp.storage.keysLocal();
\`\`\`

---

## cdp_get_accessibility_tree

Get the accessibility tree to understand page structure before writing interaction scripts.

**What you get:**
- ARIA roles (button, link, textbox, dialog, etc.)
- Accessible names (what screen readers announce)
- Properties (focusable, disabled, checked, etc.)
- Tree structure (parent/child relationships)

**Parameters:**
- \`selector\` (optional): CSS selector to get tree for specific element
- \`depth\` (optional): Maximum depth for full tree (no selector)
- \`fetchRelatives\` (optional): Include parent/sibling nodes for context

**Performance tips:**
- Use \`selector\` to focus on specific areas (more efficient)
- Use \`depth\` to limit tree size for large pages
- Use \`fetchRelatives: true\` to get context around an element

**Example use cases:**
\`\`\`javascript
// Find all buttons on a page
cdp_get_accessibility_tree({})

// Inspect a specific dialog
cdp_get_accessibility_tree({ selector: '[role="dialog"]' })

// Get button with context
cdp_get_accessibility_tree({
  selector: 'button',
  fetchRelatives: true
})
\`\`\`

---

## cdp_get_dom

Get raw HTML structure of the page or a specific element.

**When to use:**
- Inspecting HTML attributes
- Checking CSS classes
- Debugging layout issues
- Analyzing raw markup

**When NOT to use:**
- Finding interactive elements → Use \`cdp_get_accessibility_tree\`
- Writing interaction scripts → Use \`cdp_run_script\` with Playwright API

**Parameters:**
- \`selector\` (optional): CSS selector to get specific element

**Performance:** Use \`selector\` to limit scope and reduce response size.

---

## cdp_get_console_logs

Get browser console logs captured from the Electron renderer process.

Console logs are automatically captured when the CDP connection is established. This tool retrieves the buffered logs (up to 1000 most recent entries) with optional filtering.

**Parameters:**
- \`count\` (optional): Maximum number of recent logs to return (default: 100, max: 1000)
- \`filter\` (optional): Filter string - only logs containing this string (case-insensitive) will be returned
- \`types\` (optional): Array of console types to include (e.g., ["error", "warn"])

**Valid console types:**
- \`log\` - Regular console.log() messages
- \`error\` - console.error() messages
- \`warn\` - console.warn() messages
- \`info\` - console.info() messages
- \`debug\` - console.debug() messages

**Example use cases:**
\`\`\`javascript
// Get last 50 logs
cdp_get_console_logs({ count: 50 })

// Get only error logs
cdp_get_console_logs({ types: ["error"] })

// Get logs containing "[DEBUG]"
cdp_get_console_logs({ filter: "[DEBUG]" })

// Get last 20 error and warning logs containing "API"
cdp_get_console_logs({
  count: 20,
  types: ["error", "warn"],
  filter: "API"
})
\`\`\`

**Note:** The buffer stores up to 1000 logs in a circular buffer. Older logs are automatically removed when the buffer is full.

---

## Best Practices

1. **Use accessibility-first selectors:**
   \`\`\`javascript
   // ✅ Good - uses accessible name
   await cdp.getByRole('button', { name: 'Submit' }).click();

   // ❌ Avoid - brittle CSS selector
   await cdp.locator('.btn-primary.submit-btn').click();
   \`\`\`

2. **Let auto-waiting do its job:**
   \`\`\`javascript
   // ✅ Good - click() waits automatically
   await cdp.getByRole('button', { name: 'Save' }).click();

   // ❌ Avoid - manual setTimeout
   setTimeout(() => button.click(), 1000);
   \`\`\`

3. **Return structured data for verification:**
   \`\`\`javascript
   // ✅ Good - returns useful data
   await cdp.getByRole('button', { name: 'Create' }).click();
   await cdp.waitForURL(/workspace/);
   return {
     success: true,
     url: cdp.url(),
     title: cdp.title()
   };
   \`\`\`

4. **Use try/catch for error handling:**
   \`\`\`javascript
   try {
     await cdp.getByRole('button', { name: 'Submit' }).click();
     return { success: true };
   } catch (error) {
     return { success: false, error: error.message };
   }
   \`\`\`

5. **Inspect before interacting:**
   \`\`\`javascript
   // Step 1: Inspect with accessibility tree
   cdp_get_accessibility_tree({ selector: '[role="dialog"]' })

   // Step 2: Write script based on what you found
   cdp_run_script({
     script: \`
       await cdp.getByRole('button', { name: 'Confirm' }).click();
       return { confirmed: true };
     \`
   })
   \`\`\`

---

## Complete Example

\`\`\`javascript
// 1. Inspect the page
cdp_get_accessibility_tree({})
// → Find button with role="button" name="New Workspace"

// 2. Write interaction script
cdp_run_script({
  script: \`
    // Click the button
    await cdp.getByRole('button', { name: /new workspace/i }).click();

    // Wait for dialog to appear
    await cdp.getByRole('dialog').waitFor({ state: 'visible' });

    // Fill the form
    await cdp.getByRole('textbox', { name: 'Workspace Name' })
      .fill('My New Workspace');

    // Submit
    await cdp.getByRole('button', { name: 'Create' }).click();

    // Wait for navigation
    await cdp.waitForURL(/workspace\\/\\d+/);

    // Return results
    return {
      success: true,
      url: cdp.url(),
      title: cdp.title()
    };
  \`
})
\`\`\`
`,
            },
        ],
    };
}
async function handleCdpRunScript(args) {
    await ensureCDPConnected();
    const { script } = args;
    if (!script) {
        throw new Error('Missing required parameter: script');
    }
    // Inject CDP helpers + user script
    const fullScript = `
    ${cdpHelpersCode}

    (async function() {
      try {
        ${script}
      } catch (error) {
        return {
          __error: true,
          message: error.message,
          stack: error.stack,
          name: error.name
        };
      }
    })()
  `;
    const result = await cdpClient.Runtime.evaluate({
        expression: fullScript,
        returnByValue: true,
        awaitPromise: true,
    });
    if (result.exceptionDetails) {
        const error = result.exceptionDetails;
        const exception = error.exception;
        // Try to extract more useful error information
        let errorMessage = exception?.description || error.text || 'Unknown error';
        // Parse out the actual error from the wrapped function
        const match = errorMessage.match(/Error: (.+?)(?:\n|$)/);
        if (match) {
            errorMessage = match[1];
        }
        throw new Error(`Script execution failed: ${errorMessage}\n` +
            `Line: ${error.lineNumber}, Column: ${error.columnNumber}\n\n` +
            `Script:\n${script}`);
    }
    const value = result.result.value;
    const type = result.result.type;
    // Check if the script returned an error object
    if (value && typeof value === 'object' && value.__error) {
        throw new Error(`Script error: ${value.message}\n\n` +
            `Stack trace:\n${value.stack}\n\n` +
            `Script:\n${script}`);
    }
    return {
        content: [
            {
                type: 'text',
                text: `Result (${type}):\n${JSON.stringify(value, null, 2)}`,
            },
        ],
        metadata: {
            type,
            value,
        },
    };
}
async function handleCdpGetDom(args) {
    await ensureCDPConnected();
    const { selector } = args;
    if (selector) {
        // Get specific element by selector
        const result = await cdpClient.Runtime.evaluate({
            expression: `document.querySelector(${JSON.stringify(selector)})?.outerHTML || null`,
            returnByValue: true,
        });
        if (result.exceptionDetails) {
            throw new Error(`Script error: ${result.exceptionDetails.text}`);
        }
        if (result.result.value === null) {
            throw new Error(`No element found matching selector: ${selector}`);
        }
        return {
            content: [
                {
                    type: 'text',
                    text: `HTML for selector "${selector}":\n\n${result.result.value}`,
                },
            ],
            metadata: {
                selector,
                length: result.result.value.length,
            },
        };
    }
    else {
        // Get full document
        const { root } = await cdpClient.DOM.getDocument({ depth: -1 });
        const { outerHTML } = await cdpClient.DOM.getOuterHTML({ nodeId: root.nodeId });
        return {
            content: [
                {
                    type: 'text',
                    text: `Full document HTML:\n\n${outerHTML}`,
                },
            ],
            metadata: {
                length: outerHTML.length,
            },
        };
    }
}
async function handleCdpGetConsoleLogs(args) {
    const { count = 100, filter, types } = args;
    // Validate count
    const maxCount = Math.min(Math.max(1, count), MAX_CONSOLE_LOGS);
    // Filter logs
    let filteredLogs = [...consoleLogs];
    // Filter by types if specified
    if (types && Array.isArray(types) && types.length > 0) {
        filteredLogs = filteredLogs.filter((log) => types.includes(log.type));
    }
    // Filter by string if specified
    if (filter && typeof filter === 'string') {
        const filterLower = filter.toLowerCase();
        filteredLogs = filteredLogs.filter((log) => {
            // Check if any arg contains the filter string
            return log.args.some((arg) => {
                const argStr = String(arg).toLowerCase();
                return argStr.includes(filterLower);
            });
        });
    }
    // Get the most recent logs
    const recentLogs = filteredLogs.slice(-maxCount);
    // Format logs for display
    const formattedLogs = recentLogs
        .map((log) => {
        const timestamp = new Date(log.timestamp).toISOString();
        const argsStr = log.args
            .map((arg) => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                }
                catch {
                    return String(arg);
                }
            }
            return String(arg);
        })
            .join(' ');
        return `[${timestamp}] [${log.type}] ${argsStr}`;
    })
        .join('\n');
    const summary = `Retrieved ${recentLogs.length} console log(s)` +
        (filter ? ` matching filter "${filter}"` : '') +
        (types ? ` of types [${types.join(', ')}]` : '') +
        ` (total buffered: ${consoleLogs.length})`;
    return {
        content: [
            {
                type: 'text',
                text: `${summary}\n\n${formattedLogs || '(no logs)'}`,
            },
        ],
        metadata: {
            totalBuffered: consoleLogs.length,
            returned: recentLogs.length,
            filtered: filteredLogs.length,
            filter: filter || null,
            types: types || null,
        },
    };
}
async function handleCdpScreenshot(args) {
    await ensureCDPConnected();
    const { selector, fullPage = false, quality = 80, format = 'png' } = args;
    // Enable Page domain for screenshots
    await cdpClient.Page.enable();
    let screenshotParams = {
        format: format,
        quality: format === 'jpeg' ? quality : undefined,
    };
    if (selector) {
        // Get element bounds for clipping
        const result = await cdpClient.Runtime.evaluate({
            expression: `
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          };
        })()
      `,
            returnByValue: true,
        });
        if (result.exceptionDetails) {
            throw new Error(`Script error: ${result.exceptionDetails.text}`);
        }
        if (!result.result.value) {
            throw new Error(`No element found matching selector: ${selector}`);
        }
        const bounds = result.result.value;
        screenshotParams.clip = {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            scale: 1,
        };
    }
    else if (fullPage) {
        // Get full page dimensions
        const layoutMetrics = await cdpClient.Page.getLayoutMetrics();
        screenshotParams.clip = {
            x: 0,
            y: 0,
            width: layoutMetrics.contentSize.width,
            height: layoutMetrics.contentSize.height,
            scale: 1,
        };
        screenshotParams.captureBeyondViewport = true;
    }
    const screenshot = await cdpClient.Page.captureScreenshot(screenshotParams);
    return {
        content: [
            {
                type: 'image',
                data: screenshot.data,
                mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
            },
        ],
        metadata: {
            format,
            selector: selector || null,
            fullPage,
            size: screenshot.data.length,
        },
    };
}
async function handleCdpReload(args) {
    await ensureCDPConnected();
    const { ignoreCache = false } = args;
    // Enable Page domain
    await cdpClient.Page.enable();
    // Reload the page
    await cdpClient.Page.reload({ ignoreCache });
    // Wait a moment for the page to start loading
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
        content: [
            {
                type: 'text',
                text: `Page reloaded${ignoreCache ? ' (cache bypassed)' : ''}`,
            },
        ],
        metadata: {
            ignoreCache,
        },
    };
}
async function handleCdpWait(args) {
    await ensureCDPConnected();
    const { ms = 1000, selector, timeout = 5000 } = args;
    if (selector) {
        // Wait for element to appear
        const startTime = Date.now();
        let found = false;
        while (Date.now() - startTime < timeout) {
            const result = await cdpClient.Runtime.evaluate({
                expression: `document.querySelector(${JSON.stringify(selector)}) !== null`,
                returnByValue: true,
            });
            if (result.result.value === true) {
                found = true;
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!found) {
            throw new Error(`Timeout waiting for element: ${selector} (waited ${timeout}ms)`);
        }
        const elapsed = Date.now() - startTime;
        return {
            content: [
                {
                    type: 'text',
                    text: `Element found: ${selector} (after ${elapsed}ms)`,
                },
            ],
            metadata: {
                selector,
                elapsed,
            },
        };
    }
    else {
        // Simple wait
        await new Promise((resolve) => setTimeout(resolve, ms));
        return {
            content: [
                {
                    type: 'text',
                    text: `Waited ${ms}ms`,
                },
            ],
            metadata: {
                ms,
            },
        };
    }
}
async function handleCdpGetAccessibilityTree(args) {
    await ensureCDPConnected();
    const { selector, depth, fetchRelatives = false } = args;
    if (selector) {
        // Get partial tree for specific element
        logToStderr('DEBUG', `Getting partial accessibility tree for selector: ${selector}`);
        // First, find the element using Runtime.evaluate to get its objectId
        const result = await cdpClient.Runtime.evaluate({
            expression: `document.querySelector(${JSON.stringify(selector)})`,
            returnByValue: false,
        });
        if (result.exceptionDetails) {
            throw new Error(`Script error: ${result.exceptionDetails.text}`);
        }
        if (result.result.type === 'undefined' || result.result.subtype === 'null') {
            throw new Error(`No element found matching selector: ${selector}`);
        }
        // Get the accessibility tree for this element
        const { nodes } = await cdpClient.Accessibility.getPartialAXTree({
            objectId: result.result.objectId,
            fetchRelatives,
        });
        logToStderr('DEBUG', `Retrieved ${nodes.length} accessibility nodes for selector: ${selector}`);
        return {
            content: [
                {
                    type: 'text',
                    text: `Accessibility tree for selector "${selector}":\n\n${JSON.stringify(nodes, null, 2)}`,
                },
            ],
            metadata: {
                selector,
                nodeCount: nodes.length,
                fetchRelatives,
            },
        };
    }
    else {
        // Get full tree
        logToStderr('DEBUG', `Getting full accessibility tree${depth ? ` with depth ${depth}` : ''}`);
        const options = {};
        if (depth !== undefined) {
            options.depth = depth;
        }
        const { nodes } = await cdpClient.Accessibility.getFullAXTree(options);
        logToStderr('DEBUG', `Retrieved ${nodes.length} accessibility nodes for full tree`);
        return {
            content: [
                {
                    type: 'text',
                    text: `Full accessibility tree${depth ? ` (depth: ${depth})` : ''}:\n\n${JSON.stringify(nodes, null, 2)}`,
                },
            ],
            metadata: {
                nodeCount: nodes.length,
                depth: depth || 'full',
            },
        };
    }
}
// Handle JSON-RPC requests
async function handleRequest(request) {
    const { method, params, id } = request;
    logToStderr('DEBUG', `Handling request: ${method}`, { id });
    try {
        if (method === 'initialize') {
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        tools: {},
                    },
                    serverInfo: {
                        name: 'cdp-mcp-stdio-server',
                        version: '1.0.0',
                    },
                },
            };
        }
        if (method === 'tools/list') {
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    tools,
                },
            };
        }
        if (method === 'tools/call') {
            const { name, arguments: args } = params;
            let result;
            if (name === 'cdp_hello') {
                result = await handleCdpHello();
            }
            else if (name === 'cdp_api_reference') {
                result = handleCdpApiReference();
            }
            else if (name === 'cdp_run_script') {
                result = await handleCdpRunScript(args);
            }
            else if (name === 'cdp_get_dom') {
                result = await handleCdpGetDom(args);
            }
            else if (name === 'cdp_get_accessibility_tree') {
                result = await handleCdpGetAccessibilityTree(args);
            }
            else if (name === 'cdp_get_console_logs') {
                result = await handleCdpGetConsoleLogs(args);
            }
            else if (name === 'cdp_screenshot') {
                result = await handleCdpScreenshot(args);
            }
            else if (name === 'cdp_reload') {
                result = await handleCdpReload(args);
            }
            else if (name === 'cdp_wait') {
                result = await handleCdpWait(args);
            }
            else {
                throw new Error(`Unknown tool: ${name}`);
            }
            return {
                jsonrpc: '2.0',
                id,
                result,
            };
        }
        throw new Error(`Unknown method: ${method}`);
    }
    catch (error) {
        logToStderr('ERROR', `Request failed: ${error.message}`, { method, id });
        return {
            jsonrpc: '2.0',
            id,
            error: {
                code: -32603,
                message: error.message,
            },
        };
    }
}
// Main
async function main() {
    try {
        logToStderr('INFO', 'Starting CDP MCP STDIO Server');
        // Load CDP helpers
        loadCdpHelpers();
        // Connect to CDP
        await connectCDP();
        logToStderr('INFO', 'CDP MCP STDIO Server ready');
        // Read from stdin
        let buffer = '';
        process.stdin.on('data', async (chunk) => {
            buffer += chunk.toString();
            // Process complete JSON-RPC messages (one per line)
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer
            for (const line of lines) {
                if (!line.trim())
                    continue;
                try {
                    const request = JSON.parse(line);
                    const response = await handleRequest(request);
                    // Write response to stdout
                    process.stdout.write(JSON.stringify(response) + '\n');
                }
                catch (error) {
                    logToStderr('ERROR', `Failed to process request: ${error.message}`);
                }
            }
        });
        process.stdin.on('end', () => {
            logToStderr('INFO', 'Stdin closed, exiting');
            if (cdpClient) {
                cdpClient.close();
            }
            process.exit(0);
        });
        process.on('SIGINT', () => {
            logToStderr('INFO', 'Received SIGINT, exiting');
            if (cdpClient) {
                cdpClient.close();
            }
            process.exit(0);
        });
        process.on('SIGTERM', () => {
            logToStderr('INFO', 'Received SIGTERM, exiting');
            if (cdpClient) {
                cdpClient.close();
            }
            process.exit(0);
        });
    }
    catch (error) {
        logToStderr('ERROR', `Fatal error: ${error.message}`);
        process.exit(1);
    }
}
main();
