/**
 * Browser Action Executor
 *
 * Executes a declarative sequence of browser actions instead of arbitrary code.
 * This is a secure alternative to executeCode() that validates each action
 * against a known schema before execution.
 *
 * Actions are executed sequentially, with each action's result available
 * to subsequent actions via variable references.
 */

import { z } from 'zod';
import { Logger } from '../../../shared/logger';
import { embeddedBrowserCdp } from './embedded-browser-cdp-service';
import { browserCapture } from './browser-capture-service';
import type { SnapshotOptions, SessionOptions, CaptureStepOptions } from './browser-capture-types';

const logger = new Logger('BrowserActionExecutor');

// ============================================================================
// Action Schemas
// ============================================================================

const ListTabsActionSchema = z.object({
  action: z.literal('listTabs'),
});

const FocusTabActionSchema = z.object({
  action: z.literal('focusTab'),
  tabId: z.string().optional(),
});

const GetAccessibilityTreeActionSchema = z.object({
  action: z.literal('getAccessibilityTree'),
  tabId: z.string().optional(),
});

const ScreenshotActionSchema = z.object({
  action: z.literal('screenshot'),
  tabId: z.string().optional(),
});

const EvaluateActionSchema = z.object({
  action: z.literal('evaluate'),
  expression: z.string(),
  tabId: z.string().optional(),
});

const WaitForOptionsSchema = z.object({
  console: z.string().optional(),
  networkIdle: z.number().optional(),
  selector: z.string().optional(),
  timeout: z.number().optional(),
});

const SnapshotActionSchema = z.object({
  action: z.literal('snapshot'),
  workspaceId: z.string(),
  tabId: z.string().optional(),
  name: z.string().optional(),
  reload: z.boolean().optional(),
  waitFor: WaitForOptionsSchema.optional(),
});

const StartSessionActionSchema = z.object({
  action: z.literal('startSession'),
  workspaceId: z.string(),
  tabId: z.string().optional(),
  name: z.string().optional(),
});

const StartCaptureActionSchema = z.object({
  action: z.literal('startCapture'),
  sessionId: z.string(),
});

const EndCaptureActionSchema = z.object({
  action: z.literal('endCapture'),
  sessionId: z.string(),
});

const CaptureStepActionSchema = z.object({
  action: z.literal('captureStep'),
  sessionId: z.string(),
  stepName: z.string(),
  reload: z.boolean().optional(),
  waitFor: WaitForOptionsSchema.optional(),
});

const StartTraceActionSchema = z.object({
  action: z.literal('startTrace'),
  sessionId: z.string(),
  traceName: z.string(),
});

const StopTraceActionSchema = z.object({
  action: z.literal('stopTrace'),
  sessionId: z.string(),
  traceName: z.string(),
});

const EndSessionActionSchema = z.object({
  action: z.literal('endSession'),
  sessionId: z.string(),
});

const ResetTabActionSchema = z.object({
  action: z.literal('resetTab'),
  tabId: z.string().optional(),
});

const GetSummaryActionSchema = z.object({
  action: z.literal('getSummary'),
  captureDir: z.string(),
});

const OpenTabActionSchema = z.object({
  action: z.literal('openTab'),
  url: z.string(),
  position: z.enum(['adjacent', 'replace', 'same']).optional(),
});

// Union of all action schemas
const BrowserActionSchema = z.discriminatedUnion('action', [
  ListTabsActionSchema,
  FocusTabActionSchema,
  GetAccessibilityTreeActionSchema,
  ScreenshotActionSchema,
  EvaluateActionSchema,
  SnapshotActionSchema,
  StartSessionActionSchema,
  StartCaptureActionSchema,
  EndCaptureActionSchema,
  CaptureStepActionSchema,
  StartTraceActionSchema,
  StopTraceActionSchema,
  EndSessionActionSchema,
  ResetTabActionSchema,
  GetSummaryActionSchema,
  OpenTabActionSchema,
]);

export type BrowserAction = z.infer<typeof BrowserActionSchema>;

// Schema for the full action sequence
const ActionSequenceSchema = z.object({
  actions: z.array(BrowserActionSchema),
  tabId: z.string().optional(), // Default tabId for all actions
});

export type ActionSequence = z.infer<typeof ActionSequenceSchema>;

// ============================================================================
// Execution Result Types
// ============================================================================

export interface ActionResult {
  action: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface ExecutionResult {
  success: boolean;
  results: ActionResult[];
  error?: string;
}

// ============================================================================
// Action Executor
// ============================================================================

/**
 * Execute a single browser action.
 * If agentId is provided, tab leases are touched on every tab-targeting action.
 */
async function executeAction(
  action: BrowserAction,
  defaultTabId?: string,
  openTabFn?: (
    url: string,
    position?: 'adjacent' | 'replace' | 'same',
  ) => { success: boolean; message: string },
  agentId?: string,
  workspaceId?: string,
): Promise<ActionResult> {
  const tabId = ('tabId' in action ? action.tabId : undefined) || defaultTabId;

  // Touch the lease for any action that targets a specific tab
  if (tabId && agentId) {
    embeddedBrowserCdp.touchLease(tabId, agentId);
  }

  try {
    switch (action.action) {
      case 'listTabs': {
        const result = await embeddedBrowserCdp.listAllTabs(workspaceId);
        return { action: 'listTabs', success: true, result };
      }

      case 'focusTab': {
        const result = embeddedBrowserCdp.focusTab(tabId || '', workspaceId);
        return { action: 'focusTab', success: true, result };
      }

      case 'getAccessibilityTree': {
        const result = await embeddedBrowserCdp.getAccessibilityTree(tabId);
        return { action: 'getAccessibilityTree', success: true, result };
      }

      case 'screenshot': {
        const result = await embeddedBrowserCdp.screenshot(tabId);
        return { action: 'screenshot', success: true, result };
      }

      case 'evaluate': {
        const result = await embeddedBrowserCdp.evaluate(tabId, action.expression);
        return { action: 'evaluate', success: true, result };
      }

      case 'snapshot': {
        const options: SnapshotOptions = {
          workspaceId: action.workspaceId,
          tabId,
          name: action.name,
          reload: action.reload,
          waitFor: action.waitFor,
        };
        const result = await browserCapture.snapshot(options);
        return { action: 'snapshot', success: true, result };
      }

      case 'startSession': {
        const options: SessionOptions = {
          workspaceId: action.workspaceId,
          tabId,
          name: action.name,
        };
        const result = await browserCapture.startSession(options);
        return { action: 'startSession', success: true, result };
      }

      case 'startCapture': {
        await browserCapture.startCapture(action.sessionId);
        return { action: 'startCapture', success: true };
      }

      case 'endCapture': {
        await browserCapture.endCapture(action.sessionId);
        return { action: 'endCapture', success: true };
      }

      case 'captureStep': {
        const options: CaptureStepOptions | undefined =
          action.reload || action.waitFor
            ? { reload: action.reload, waitFor: action.waitFor }
            : undefined;
        const result = await browserCapture.captureStep(action.sessionId, action.stepName, options);
        return { action: 'captureStep', success: true, result };
      }

      case 'startTrace': {
        const result = await browserCapture.startTrace(action.sessionId, action.traceName);
        return { action: 'startTrace', success: true, result };
      }

      case 'stopTrace': {
        const result = await browserCapture.stopTrace(action.sessionId, action.traceName);
        return { action: 'stopTrace', success: true, result };
      }

      case 'endSession': {
        const result = await browserCapture.endSession(action.sessionId);
        return { action: 'endSession', success: true, result };
      }

      case 'resetTab': {
        const result = await browserCapture.resetTab(tabId);
        return { action: 'resetTab', success: true, result };
      }

      case 'getSummary': {
        const result = await browserCapture.getSummary(action.captureDir);
        return { action: 'getSummary', success: true, result };
      }

      case 'openTab': {
        // When called by an agent, try to reuse an idle browser tab instead of opening a new one
        if (agentId) {
          const idleTabId = embeddedBrowserCdp.findIdleTab(agentId);
          if (idleTabId) {
            logger.info('Reusing idle browser tab instead of opening new one', {
              tabId: idleTabId,
              url: action.url,
              agentId,
            });
            // Navigate the existing tab to the new URL
            // Note: findIdleTab already claimed the lease atomically, so no
            // concurrent agent can grab the same tab across the await below.
            try {
              await embeddedBrowserCdp.evaluate(
                idleTabId,
                `window.location.href = ${JSON.stringify(action.url)}`,
              );
              // Focus the tab so the user can see it
              embeddedBrowserCdp.focusTab(idleTabId, workspaceId);
              return {
                action: 'openTab',
                success: true,
                result: { reused: true, tabId: idleTabId, url: action.url },
              };
            } catch (err) {
              logger.warn('Failed to reuse idle tab, falling back to opening new tab', {
                tabId: idleTabId,
                error: (err as Error).message,
              });
              // Release the lease we claimed since we couldn't use this tab
              embeddedBrowserCdp.releaseLease(idleTabId);
              // Fall through to open a new tab
            }
          }
        }

        if (!openTabFn) {
          return {
            action: 'openTab',
            success: false,
            error: 'openTab not available in this context',
          };
        }
        const result = openTabFn(action.url, action.position);
        return { action: 'openTab', success: result.success, result };
      }

      default: {
        // TypeScript exhaustiveness check
        const _exhaustive: never = action;
        return {
          action: 'unknown',
          success: false,
          error: `Unknown action: ${(_exhaustive as any).action}`,
        };
      }
    }
  } catch (error) {
    logger.error('Action execution failed', { action: action.action, error });
    return {
      action: action.action,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Execute a sequence of browser actions.
 *
 * Actions are executed sequentially. If any action fails, execution stops
 * and the error is returned along with results from successful actions.
 *
 * @param agentId - If provided, enables tab lease tracking and idle tab reuse
 */
export async function executeActions(
  input: unknown,
  openTabFn?: (
    url: string,
    position?: 'adjacent' | 'replace' | 'same',
  ) => { success: boolean; message: string },
  agentId?: string,
  workspaceId?: string,
): Promise<ExecutionResult> {
  // Validate input against schema
  const parseResult = ActionSequenceSchema.safeParse(input);
  if (!parseResult.success) {
    logger.error('Invalid action sequence', { errors: parseResult.error.errors });
    return {
      success: false,
      results: [],
      error: `Invalid action sequence: ${parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
    };
  }

  const { actions, tabId: defaultTabId } = parseResult.data;
  const results: ActionResult[] = [];

  for (const action of actions) {
    const result = await executeAction(action, defaultTabId, openTabFn, agentId, workspaceId);
    results.push(result);

    if (!result.success) {
      return {
        success: false,
        results,
        error: `Action '${action.action}' failed: ${result.error}`,
      };
    }
  }

  return { success: true, results };
}
