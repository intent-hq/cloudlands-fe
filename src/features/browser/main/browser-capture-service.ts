/**
 * Browser Capture Service
 *
 * Provides uisnap-style browser snapshot and capture functionality.
 * Captures accessibility trees, console logs, network requests, and performance traces.
 *
 * Design principles:
 * - Capture is intentional - no background listeners by default
 * - Browser tabs are general-purpose, not always for debugging
 * - Agent explicitly instruments when they need to debug
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { webContents } from 'electron';
import { Logger } from '../../../shared/logger';
import { WorkspaceConfig } from '../../../shared/main/config';
import { embeddedBrowserCdp } from './embedded-browser-cdp-service';
import type {
  SnapshotOptions,
  SnapshotResult,
  SessionOptions,
  CaptureSession,
  SessionResult,
  CaptureStepOptions,
  ConsoleMessage,
  NetworkRequest,
  WaitForOptions,
  CaptureSummary,
} from './browser-capture-types';

const logger = new Logger('BrowserCapture');

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    // Return 'unknown' if hostname is empty (e.g., about:blank)
    return parsed.hostname || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Sanitize a name for use in file/directory paths.
 * Removes path traversal characters and restricts to safe filename characters.
 */
function sanitizePathName(name: string): string {
  // Replace path separators and traversal patterns
  let sanitized = name
    .replace(/\.\./g, '_') // Remove path traversal
    .replace(/[/\\]/g, '_') // Remove path separators
    .replace(/[<>:"|?*]/g, '_') // Remove Windows-invalid chars
    .replace(/[\x00-\x1f]/g, '_'); // Remove control characters

  // Trim leading/trailing dots and spaces (problematic on some filesystems)
  sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, '_');

  // Fallback if result is empty
  return sanitized || 'unnamed';
}

/**
 * Generate timestamp string for directory names
 */
function generateTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Write JSONL file (one JSON object per line)
 */
async function writeJsonl(filePath: string, items: unknown[]): Promise<void> {
  const content = items.map((item) => JSON.stringify(item)).join('\n');
  await fs.writeFile(filePath, `${content}${items.length > 0 ? '\n' : ''}`, 'utf-8');
}

/**
 * Categorize MIME type into a simple category
 */
function categorizeMimeType(mimeType?: string): string {
  if (!mimeType) return 'other';
  if (mimeType.includes('javascript') || mimeType.includes('ecmascript')) return 'script';
  if (mimeType.includes('css')) return 'stylesheet';
  if (mimeType.includes('image')) return 'image';
  if (mimeType.includes('font')) return 'font';
  if (mimeType.includes('json')) return 'fetch';
  if (mimeType.includes('html')) return 'document';
  if (mimeType.includes('xml')) return 'fetch';
  return 'other';
}

/**
 * Generate a summary from console messages and network requests
 */
function generateSummary(
  consoleMessages: ConsoleMessage[],
  networkRequests: NetworkRequest[],
  metadata: { url: string; title: string; timestamp: string },
): CaptureSummary {
  // Console summary
  const consoleCounts = { error: 0, warn: 0, info: 0, log: 0, debug: 0 };
  const errorMessages = new Map<string, number>();
  const warningMessages = new Map<string, number>();

  for (const msg of consoleMessages) {
    const level = msg.level === 'warn' ? 'warn' : msg.level;
    if (level in consoleCounts) {
      consoleCounts[level as keyof typeof consoleCounts]++;
    }

    // Track error/warning messages for top lists
    if (msg.level === 'error') {
      const text = msg.text.slice(0, 200); // Truncate long messages
      errorMessages.set(text, (errorMessages.get(text) || 0) + 1);
    } else if (msg.level === 'warn') {
      const text = msg.text.slice(0, 200);
      warningMessages.set(text, (warningMessages.get(text) || 0) + 1);
    }
  }

  // Sort and take top 5 errors/warnings
  const topErrors = [...errorMessages.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([message, count]) => ({ message, count }));

  const topWarnings = [...warningMessages.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([message, count]) => ({ message, count }));

  // Network summary
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const failures: Array<{ url: string; status?: number; error?: string }> = [];
  const requestsWithDuration: Array<{ url: string; duration: number; status?: number }> = [];

  for (const req of networkRequests) {
    // Count by status
    const statusKey = req.status ? String(req.status) : 'pending';
    byStatus[statusKey] = (byStatus[statusKey] || 0) + 1;

    // Count by type
    const typeKey = categorizeMimeType(req.mimeType);
    byType[typeKey] = (byType[typeKey] || 0) + 1;

    // Track failures
    if (req.failed || (req.status && req.status >= 400)) {
      failures.push({
        url: req.url,
        status: req.status,
        error: req.failureReason,
      });
    }

    // Track duration for slowest
    if (req.duration !== undefined) {
      requestsWithDuration.push({
        url: req.url,
        duration: req.duration,
        status: req.status,
      });
    }
  }

  // Sort and take top 5 slowest
  const slowest = requestsWithDuration
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 5);

  return {
    capturedAt: metadata.timestamp,
    url: metadata.url,
    title: metadata.title,
    console: {
      total: consoleMessages.length,
      errors: consoleCounts.error,
      warnings: consoleCounts.warn,
      info: consoleCounts.info,
      log: consoleCounts.log,
      debug: consoleCounts.debug,
      topErrors,
      topWarnings,
    },
    network: {
      total: networkRequests.length,
      failed: failures.length,
      byStatus,
      byType,
      slowest,
      failures: failures.slice(0, 10), // Limit to 10 failures
    },
  };
}

class BrowserCaptureService {
  /** Active capture sessions */
  private sessions = new Map<string, CaptureSession>();

  /** CDP event listeners by webContentsId */
  private eventListeners = new Map<number, { cleanup: () => void }>();

  /**
   * Simple snapshot - point-in-time capture without a session
   */
  async snapshot(options: SnapshotOptions): Promise<SnapshotResult> {
    const { tabId, workspaceId, name, reload, waitFor } = options;

    // Get tab info
    const tabs = await embeddedBrowserCdp.listAllTabs();
    const tab = tabId ? tabs.find((t) => t.tabId === tabId) : tabs[0];

    if (!tab) {
      throw new Error(tabId ? `Tab ${tabId} not found` : 'No browser tabs available');
    }

    if (!tab.mounted) {
      throw new Error(
        // i18n-ignore (agent-facing protocol error, not user-facing)
        `Tab ${tab.tabId} is not mounted. Use { action: "focusTab", tabId: "${tab.tabId}" } first.`,
      );
    }

    const url = tab.url || 'about:blank';
    const domain = extractDomain(url);
    // Sanitize user-provided name to prevent path traversal
    const snapshotName = sanitizePathName(name || generateTimestamp());
    const outputDir = WorkspaceConfig.paths.browserSnapshotSession(workspaceId, domain, snapshotName);

    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });

    // Start listening for console/network if we're reloading
    const consoleMessages: ConsoleMessage[] = [];
    const networkRequests: NetworkRequest[] = [];

    if (reload) {
      // Set up listeners before reload
      const listeners = await this.setupCdpListeners(
        tab.webContentsId,
        (msg) => consoleMessages.push(msg),
        (req) => networkRequests.push(req),
      );

      try {
        // Reload the page
        await embeddedBrowserCdp.evaluate(tab.tabId, 'location.reload()');

        // Wait for conditions
        await this.waitForConditions(tab.tabId, waitFor);
      } finally {
        // Clean up listeners
        listeners.cleanup();
      }
    } else if (waitFor) {
      // Just wait for conditions without reload
      await this.waitForConditions(tab.tabId, waitFor);
    }

    // Capture accessibility tree
    const a11yTree = await embeddedBrowserCdp.getAccessibilityTree(tab.tabId);
    const a11yPath = path.join(outputDir, 'a11y.yaml');
    await fs.writeFile(a11yPath, a11yTree, 'utf-8');

    // Capture screenshot
    const screenshot = await embeddedBrowserCdp.screenshot(tab.tabId);
    const screenshotPath = path.join(outputDir, 'screenshot.jpg');
    await fs.writeFile(screenshotPath, Buffer.from(screenshot.base64, 'base64'));

    // Write console/network if captured
    let consolePath: string | undefined;
    let networkPath: string | undefined;

    if (consoleMessages.length > 0) {
      consolePath = path.join(outputDir, 'console.jsonl');
      await writeJsonl(consolePath, consoleMessages);
    }

    if (networkRequests.length > 0) {
      networkPath = path.join(outputDir, 'network.jsonl');
      await writeJsonl(networkPath, networkRequests);
    }

    // Write metadata
    const wc = webContents.fromId(tab.webContentsId);
    const metadata = {
      url: wc?.getURL() || url,
      title: wc?.getTitle() || tab.title || '',
      timestamp: new Date().toISOString(),
      domain,
    };
    await fs.writeFile(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

    // Generate and write summary for easy triage
    const summary = generateSummary(consoleMessages, networkRequests, metadata);
    await fs.writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));

    logger.info('Snapshot captured', { outputDir, domain });

    return {
      dir: outputDir,
      a11y: a11yPath,
      screenshot: screenshotPath,
      console: consolePath,
      network: networkPath,
      metadata,
    };
  }

  /**
   * Start a capture session for multi-step flows
   */
  async startSession(options: SessionOptions): Promise<CaptureSession> {
    const { tabId, workspaceId, name } = options;

    // Get tab info
    const tabs = await embeddedBrowserCdp.listAllTabs();
    const tab = tabId ? tabs.find((t) => t.tabId === tabId) : tabs[0];

    if (!tab) {
      throw new Error(tabId ? `Tab ${tabId} not found` : 'No browser tabs available');
    }

    if (!tab.mounted) {
      throw new Error(
        // i18n-ignore (agent-facing protocol error, not user-facing)
        `Tab ${tab.tabId} is not mounted. Use { action: "focusTab", tabId: "${tab.tabId}" } first.`,
      );
    }

    const url = tab.url || 'about:blank';
    const domain = extractDomain(url);
    // Sanitize user-provided name to prevent path traversal
    const sessionName = sanitizePathName(name || generateTimestamp());
    const sessionId = `session-${randomUUID()}`;
    const outputDir = WorkspaceConfig.paths.browserSnapshotSession(workspaceId, domain, sessionName);

    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });

    const session: CaptureSession = {
      id: sessionId,
      tabId: tab.tabId,
      workspaceId,
      name: sessionName,
      domain,
      outputDir,
      stepCount: 0,
      captureActive: false,
      activeTraces: new Map(),
      consoleBuffer: [],
      networkBuffer: [],
    };

    this.sessions.set(sessionId, session);
    logger.info('Session started', { sessionId, outputDir, domain });

    return session;
  }

  /**
   * Start capturing console/network events within a session
   */
  async startCapture(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.captureActive) {
      logger.warn('Capture already active for session', { sessionId });
      return;
    }

    // Get webContentsId for the tab
    const tabs = await embeddedBrowserCdp.listAllTabs();
    const tab = tabs.find((t) => t.tabId === session.tabId);

    if (!tab || !tab.mounted) {
      throw new Error(`Tab ${session.tabId} is not mounted`);
    }

    // Set up CDP listeners
    const listeners = await this.setupCdpListeners(
      tab.webContentsId,
      (msg) => session.consoleBuffer.push(msg),
      (req) => session.networkBuffer.push(req),
    );

    this.eventListeners.set(tab.webContentsId, listeners);
    session.captureActive = true;

    logger.info('Capture started', { sessionId });
  }

  /**
   * Stop capturing console/network events within a session
   */
  async endCapture(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!session.captureActive) {
      logger.warn('Capture not active for session', { sessionId });
      return;
    }

    // Get webContentsId for the tab
    const tabs = await embeddedBrowserCdp.listAllTabs();
    const tab = tabs.find((t) => t.tabId === session.tabId);

    if (tab) {
      const listeners = this.eventListeners.get(tab.webContentsId);
      if (listeners) {
        listeners.cleanup();
        this.eventListeners.delete(tab.webContentsId);
      }
    }

    session.captureActive = false;
    logger.info('Capture ended', { sessionId });
  }

  /**
   * Capture a step within a session
   */
  async captureStep(
    sessionId: string,
    stepName: string,
    options?: CaptureStepOptions,
  ): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.stepCount++;
    // Sanitize user-provided stepName to prevent path traversal
    const safeStepName = sanitizePathName(stepName);
    const stepDir = path.join(session.outputDir, `step-${session.stepCount}-${safeStepName}`);
    await fs.mkdir(stepDir, { recursive: true });

    // Handle reload if requested
    if (options?.reload) {
      // If capture wasn't active, start it temporarily
      const wasActive = session.captureActive;
      if (!wasActive) {
        await this.startCapture(sessionId);
      }

      await embeddedBrowserCdp.evaluate(session.tabId, 'location.reload()');
      await this.waitForConditions(session.tabId, options.waitFor);

      if (!wasActive) {
        await this.endCapture(sessionId);
      }
    } else if (options?.waitFor) {
      await this.waitForConditions(session.tabId, options.waitFor);
    }

    // Capture accessibility tree
    const a11yTree = await embeddedBrowserCdp.getAccessibilityTree(session.tabId);
    await fs.writeFile(path.join(stepDir, 'a11y.yaml'), a11yTree, 'utf-8');

    // Capture screenshot
    const screenshot = await embeddedBrowserCdp.screenshot(session.tabId);
    await fs.writeFile(path.join(stepDir, 'screenshot.jpg'), Buffer.from(screenshot.base64, 'base64'));

    // Write step metadata
    const tabs = await embeddedBrowserCdp.listAllTabs();
    const tab = tabs.find((t) => t.tabId === session.tabId);
    await fs.writeFile(
      path.join(stepDir, 'metadata.json'),
      JSON.stringify(
        {
          step: session.stepCount,
          name: stepName,
          url: tab?.url || '',
          title: tab?.title || '',
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    logger.info('Step captured', { sessionId, stepName, stepDir });
    return stepDir;
  }

  /**
   * Start a performance trace (named, like setTimeout/clearTimeout)
   */
  async startTrace(sessionId: string, traceName: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.activeTraces.has(traceName)) {
      throw new Error(`Trace '${traceName}' is already active`);
    }

    // Get webContentsId for the tab
    const tabs = await embeddedBrowserCdp.listAllTabs();
    const tab = tabs.find((t) => t.tabId === session.tabId);

    if (!tab || !tab.mounted) {
      throw new Error(`Tab ${session.tabId} is not mounted`);
    }

    // Use centralized debugger management
    await embeddedBrowserCdp.ensureAttached(tab.webContentsId);

    // Use ReportEvents so we get Tracing.dataCollected events
    // Categories: devtools.timeline for rendering, v8.execute for JS execution
    try {
      await embeddedBrowserCdp.sendCdpCommand(tab.webContentsId, 'Tracing.start', {
        categories: '-*,devtools.timeline,v8.execute,disabled-by-default-devtools.timeline',
        transferMode: 'ReportEvents',
      });
    } catch (traceErr) {
      const errMsg = (traceErr as Error).message || '';
      if (errMsg.includes('already been started')) {
        // Try to end the stale trace and start fresh
        logger.warn('Tracing already started, attempting to reset', { tabId: session.tabId });
        try {
          await embeddedBrowserCdp.sendCdpCommand(tab.webContentsId, 'Tracing.end');
          // Wait a bit for the trace to fully end
          await new Promise((r) => setTimeout(r, 100));
          await embeddedBrowserCdp.sendCdpCommand(tab.webContentsId, 'Tracing.start', {
            categories: '-*,devtools.timeline,v8.execute,disabled-by-default-devtools.timeline',
            transferMode: 'ReportEvents',
          });
        } catch (restartErr) {
          throw new Error(
            // i18n-ignore (agent-facing protocol error, not user-facing)
            `Failed to restart tracing: ${(restartErr as Error).message}. Try { action: "resetTab" } first.`,
          );
        }
      } else {
        throw traceErr;
      }
    }

    session.activeTraces.set(traceName, {
      name: traceName,
      startTime: Date.now(),
    });

    logger.info('Trace started', { sessionId, traceName });
    return traceName;
  }

  /**
   * Stop a performance trace and save to file
   */
  async stopTrace(sessionId: string, traceName: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const traceState = session.activeTraces.get(traceName);
    if (!traceState) {
      throw new Error(`Trace '${traceName}' is not active`);
    }

    // Get webContentsId for the tab
    const tabs = await embeddedBrowserCdp.listAllTabs();
    const tab = tabs.find((t) => t.tabId === session.tabId);

    if (!tab || !tab.mounted) {
      throw new Error(`Tab ${session.tabId} is not mounted`);
    }

    // Stop tracing and collect data
    // IMPORTANT: Set up listener BEFORE calling Tracing.end to not miss events
    const traceData: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for trace data'));
      }, 30000);

      const handler = (method: string, params: unknown) => {
        if (method === 'Tracing.dataCollected') {
          const data = params as { value: unknown[] };
          traceData.push(...data.value);
        } else if (method === 'Tracing.tracingComplete') {
          clearTimeout(timeout);
          cleanup();
          resolve();
        }
      };

      // Use centralized CDP message subscription
      const cleanup = embeddedBrowserCdp.onCdpMessage(tab.webContentsId, handler);

      // Now send the end command
      embeddedBrowserCdp.sendCdpCommand(tab.webContentsId, 'Tracing.end').catch((err) => {
        clearTimeout(timeout);
        cleanup();
        reject(err);
      });
    });

    // Write trace file
    const tracePath = path.join(session.outputDir, `${traceName}.json`);
    await fs.writeFile(tracePath, JSON.stringify(traceData, null, 2));

    session.activeTraces.delete(traceName);
    logger.info('Trace stopped', { sessionId, traceName, tracePath });

    return tracePath;
  }

  /**
   * End a capture session and write final files
   */
  async endSession(sessionId: string): Promise<SessionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Stop capture if active
    if (session.captureActive) {
      await this.endCapture(sessionId);
    }

    // Stop any active traces
    for (const traceName of session.activeTraces.keys()) {
      await this.stopTrace(sessionId, traceName);
    }

    // Write console logs
    const consolePath = path.join(session.outputDir, 'console.jsonl');
    await writeJsonl(consolePath, session.consoleBuffer);

    // Write network requests
    const networkPath = path.join(session.outputDir, 'network.jsonl');
    await writeJsonl(networkPath, session.networkBuffer);

    // Get current tab info for metadata
    const tabs = await embeddedBrowserCdp.listAllTabs();
    const tab = tabs.find((t) => t.tabId === session.tabId);

    // Write session metadata
    const metadata = {
      url: tab?.url || '',
      title: tab?.title || '',
      domain: session.domain,
      startTime: new Date(parseInt(session.id.split('-')[1])).toISOString(),
      endTime: new Date().toISOString(),
      stepCount: session.stepCount,
    };
    await fs.writeFile(
      path.join(session.outputDir, 'session.json'),
      JSON.stringify(metadata, null, 2),
    );

    // Collect step directories
    const steps: string[] = [];
    const entries = await fs.readdir(session.outputDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('step-')) {
        steps.push(path.join(session.outputDir, entry.name));
      }
    }

    // Collect trace files
    const traces: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json') && !['session.json', 'metadata.json', 'summary.json'].includes(entry.name)) {
        traces.push(path.join(session.outputDir, entry.name));
      }
    }

    // Generate and write summary for easy triage
    const summary = generateSummary(session.consoleBuffer, session.networkBuffer, {
      url: metadata.url,
      title: metadata.title,
      timestamp: metadata.endTime,
    });
    await fs.writeFile(path.join(session.outputDir, 'summary.json'), JSON.stringify(summary, null, 2));

    // Note: We don't detach the debugger here anymore.
    // The centralized EmbeddedBrowserCdpService manages debugger lifecycle.
    // Detaching here would break other operations that expect the debugger to stay attached.

    this.sessions.delete(sessionId);
    logger.info('Session ended', { sessionId, outputDir: session.outputDir });

    return {
      dir: session.outputDir,
      steps,
      console: consolePath,
      network: networkPath,
      traces,
      metadata,
    };
  }

  /**
   * Force reset a tab's CDP connection.
   * Use this to recover from stale sessions or failed captures.
   */
  async resetTab(tabId?: string): Promise<{ reset: boolean; tabId: string; details: string[] }> {
    const tabs = await embeddedBrowserCdp.listAllTabs();
    const tab = tabId ? tabs.find((t) => t.tabId === tabId) : tabs.find((t) => t.mounted);

    if (!tab) {
      throw new Error(tabId ? `Tab ${tabId} not found` : 'No mounted tabs found');
    }

    const details: string[] = [];

    // Report initial state for debugging
    const isAttachedBefore = embeddedBrowserCdp.isDebuggerAttached(tab.webContentsId);
    // i18n-ignore (agent-facing diagnostic detail, not user-facing)
    details.push(`Initial state: isAttached=${isAttachedBefore}`);

    // Clean up any event listeners we have for this tab
    const listeners = this.eventListeners.get(tab.webContentsId);
    if (listeners) {
      listeners.cleanup();
      this.eventListeners.delete(tab.webContentsId);
      // i18n-ignore (agent-facing diagnostic detail, not user-facing)
      details.push('Cleaned up event listeners');
    }

    // Clean up any sessions using this tab
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.tabId === tab.tabId) {
        this.sessions.delete(sessionId);
        // i18n-ignore (agent-facing diagnostic detail, not user-facing)
        details.push(`Cleaned up session ${sessionId}`);
        logger.info('Cleaned up stale session', { sessionId, tabId: tab.tabId });
      }
    }

    // Force detach via centralized service (clears tracking state too)
    const didDetach = embeddedBrowserCdp.forceDetachDebugger(tab.webContentsId);
    if (didDetach) {
      // i18n-ignore (agent-facing diagnostic detail, not user-facing)
      details.push('Force detached debugger');
    } else {
      // i18n-ignore (agent-facing diagnostic detail, not user-facing)
      details.push('No debugger to detach');
    }

    const isAttachedAfter = embeddedBrowserCdp.isDebuggerAttached(tab.webContentsId);
    // i18n-ignore (agent-facing diagnostic detail, not user-facing)
    details.push(`Final state: isAttached=${isAttachedAfter}`);

    logger.info('Tab reset complete', { tabId: tab.tabId, details });

    return {
      reset: details.length > 0,
      tabId: tab.tabId,
      details,
    };
  }

  /**
   * Set up CDP listeners for console and network events
   */
  private async setupCdpListeners(
    webContentsId: number,
    onConsole: (msg: ConsoleMessage) => void,
    onNetwork: (req: NetworkRequest) => void,
  ): Promise<{ cleanup: () => void }> {
    // Use centralized debugger management
    await embeddedBrowserCdp.ensureAttached(webContentsId);

    // Enable domains
    await embeddedBrowserCdp.sendCdpCommand(webContentsId, 'Console.enable');
    await embeddedBrowserCdp.sendCdpCommand(webContentsId, 'Network.enable');
    await embeddedBrowserCdp.sendCdpCommand(webContentsId, 'Runtime.enable');

    // Track pending network requests
    const pendingRequests = new Map<string, NetworkRequest>();

    // Message handler
    const messageHandler = (method: string, params: unknown) => {
      const p = params as Record<string, unknown>;

      // Console messages
      if (method === 'Runtime.consoleAPICalled') {
        const args = (p.args as Array<{ value?: unknown; description?: string }>) || [];
        const text = args.map((a) => a.value ?? a.description ?? '').join(' ');
        onConsole({
          timestamp: new Date().toISOString(),
          level: (p.type as string) === 'warning' ? 'warn' : ((p.type as string) as ConsoleMessage['level']),
          text,
        });
      }

      // Console errors/warnings from Console domain
      if (method === 'Console.messageAdded') {
        const message = p.message as { level: string; text: string; url?: string; line?: number };
        onConsole({
          timestamp: new Date().toISOString(),
          level: message.level === 'warning' ? 'warn' : (message.level as ConsoleMessage['level']),
          text: message.text,
          url: message.url,
          lineNumber: message.line,
        });
      }

      // Network request started
      if (method === 'Network.requestWillBeSent') {
        const request = p.request as { method: string; url: string };
        const now = Date.now();
        pendingRequests.set(p.requestId as string, {
          timestamp: new Date(now).toISOString(),
          requestId: p.requestId as string,
          method: request.method,
          url: request.url,
          _startTime: now, // Internal field for duration calculation
        } as NetworkRequest & { _startTime: number });
      }

      // Network response received
      if (method === 'Network.responseReceived') {
        const pending = pendingRequests.get(p.requestId as string);
        if (pending) {
          const response = p.response as { status: number; statusText: string; mimeType: string };
          pending.status = response.status;
          pending.statusText = response.statusText;
          pending.mimeType = response.mimeType;
        }
      }

      // Network request finished
      if (method === 'Network.loadingFinished') {
        const pending = pendingRequests.get(p.requestId as string) as
          | (NetworkRequest & { _startTime?: number })
          | undefined;
        if (pending) {
          pending.size = (p.encodedDataLength as number) || 0;
          // Calculate duration from start time
          if (pending._startTime) {
            pending.duration = Date.now() - pending._startTime;
            delete pending._startTime; // Remove internal field before storing
          }
          onNetwork(pending);
          pendingRequests.delete(p.requestId as string);
        }
      }

      // Network request failed
      if (method === 'Network.loadingFailed') {
        const pending = pendingRequests.get(p.requestId as string) as
          | (NetworkRequest & { _startTime?: number })
          | undefined;
        if (pending) {
          pending.failed = true;
          // i18n-ignore (agent-facing trace data, not user-facing)
          pending.failureReason = (p.errorText as string) || 'Unknown error';
          // Calculate duration even for failed requests
          if (pending._startTime) {
            pending.duration = Date.now() - pending._startTime;
            delete pending._startTime;
          }
          onNetwork(pending);
          pendingRequests.delete(p.requestId as string);
        }
      }
    };

    // Use centralized CDP message subscription
    const unsubscribe = embeddedBrowserCdp.onCdpMessage(webContentsId, messageHandler);

    return {
      cleanup: () => {
        unsubscribe();
        // Flush any pending requests
        for (const req of pendingRequests.values()) {
          onNetwork(req);
        }
        pendingRequests.clear();
      },
    };
  }

  /**
   * Wait for specified conditions
   */
  private async waitForConditions(tabId: string, waitFor?: WaitForOptions): Promise<void> {
    if (!waitFor) return;

    const timeout = waitFor.timeout || 30000;
    const startTime = Date.now();

    // Wait for console message
    if (waitFor.console) {
      await this.waitForConsoleMessage(tabId, waitFor.console, timeout);
    }

    // Wait for network idle
    if (waitFor.networkIdle) {
      const remaining = timeout - (Date.now() - startTime);
      if (remaining > 0) {
        await this.waitForNetworkIdle(tabId, waitFor.networkIdle, remaining);
      }
    }

    // Wait for selector
    if (waitFor.selector) {
      const remaining = timeout - (Date.now() - startTime);
      if (remaining > 0) {
        await this.waitForSelector(tabId, waitFor.selector, remaining);
      }
    }
  }

  /**
   * Wait for a console message matching a pattern
   */
  private async waitForConsoleMessage(
    tabId: string,
    pattern: string | RegExp,
    timeout: number,
  ): Promise<void> {
    const tabs = await embeddedBrowserCdp.listAllTabs();
    const tab = tabs.find((t) => t.tabId === tabId);
    if (!tab || !tab.mounted) {
      throw new Error(`Tab ${tabId} is not mounted`);
    }

    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    return new Promise((resolve, reject) => {
      let cleanup: (() => void) | null = null;

      const timeoutId = setTimeout(() => {
        cleanup?.();
        reject(new Error(`Timeout waiting for console message: ${pattern}`));
      }, timeout);

      const handler = (method: string, params: unknown) => {
        if (method === 'Runtime.consoleAPICalled') {
          const p = params as { args: Array<{ value?: unknown; description?: string }> };
          const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
          if (regex.test(text)) {
            clearTimeout(timeoutId);
            cleanup?.();
            resolve();
          }
        }
      };

      cleanup = embeddedBrowserCdp.onCdpMessage(tab.webContentsId, handler);
    });
  }

  /**
   * Wait for network to be idle
   */
  private async waitForNetworkIdle(tabId: string, idleTime: number, timeout: number): Promise<void> {
    const tabs = await embeddedBrowserCdp.listAllTabs();
    const tab = tabs.find((t) => t.tabId === tabId);
    if (!tab || !tab.mounted) {
      throw new Error(`Tab ${tabId} is not mounted`);
    }

    return new Promise((resolve, reject) => {
      let pendingRequests = 0;
      let idleTimer: NodeJS.Timeout | null = null;
      let cleanup: (() => void) | null = null;

      const timeoutId = setTimeout(() => {
        if (idleTimer) clearTimeout(idleTimer);
        cleanup?.();
        reject(new Error('Timeout waiting for network idle'));
      }, timeout);

      const checkIdle = () => {
        if (pendingRequests === 0) {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            clearTimeout(timeoutId);
            cleanup?.();
            resolve();
          }, idleTime);
        } else if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      };

      const handler = (method: string) => {
        if (method === 'Network.requestWillBeSent') {
          pendingRequests++;
          checkIdle();
        } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
          pendingRequests = Math.max(0, pendingRequests - 1);
          checkIdle();
        }
      };

      cleanup = embeddedBrowserCdp.onCdpMessage(tab.webContentsId, handler);
      checkIdle(); // Check immediately in case network is already idle
    });
  }

  /**
   * Wait for an element matching a selector
   */
  private async waitForSelector(tabId: string, selector: string, timeout: number): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 100;

    while (Date.now() - startTime < timeout) {
      const exists = await embeddedBrowserCdp.evaluate(
        tabId,
        `!!document.querySelector(${JSON.stringify(selector)})`,
      );
      if (exists) return;
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    throw new Error(`Timeout waiting for selector: ${selector}`);
  }

  /**
   * Get a session by ID (for internal use)
   */
  getSession(sessionId: string): CaptureSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Read a capture summary from a snapshot/session directory
   */
  async getSummary(captureDir: string): Promise<CaptureSummary | null> {
    const summaryPath = path.join(captureDir, 'summary.json');
    try {
      const content = await fs.readFile(summaryPath, 'utf-8');
      return JSON.parse(content) as CaptureSummary;
    } catch {
      return null;
    }
  }
}

// Singleton instance
export const browserCapture = new BrowserCaptureService();
