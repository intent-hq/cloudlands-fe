/**
 * Permission Manager for ACP
 *
 * Handles permission requests, caching, and user decisions.
 * Implements the ACP permission protocol with enhanced UX.
 */

import { EventEmitter } from '../utils/browser-event-emitter';
import type { AgentId } from '$shared/types/branded-ids';
import { Logger } from '../../../shared/logger';
import { invoke as invokeIpc } from '../../../shared/generated/ipc-client';
import type { PermissionOption, RequestPermissionOutcome } from '../types/base';
import { m } from '../../../shared/paraglide/messages.js';

const logger = new Logger('PermissionManager');

// Check if we're in a browser environment
const isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

// Storage key for permission rules
const PERMISSION_RULES_KEY = 'acp_permission_rules';

interface PermissionRequest {
  id: string;
  sessionId: AgentId;
  title: string;
  description?: string | null;
  options: PermissionOption[];
  timestamp: number;
  agentName?: string;
  riskLevel?: 'low' | 'medium' | 'high';
}

interface PermissionDecision {
  requestId: string;
  outcome: RequestPermissionOutcome;
  timestamp: number;
  remember?: boolean;
}

interface PermissionRule {
  pattern: string;
  action: 'allow' | 'deny' | 'ask';
  scope?: 'session' | 'agent' | 'global';
  expiresAt?: number;
}

interface ConfigSetResponse {
  success: boolean;
  error?: unknown;
}

export class PermissionManager extends EventEmitter {
  private pendingRequests = new Map<string, PermissionRequest>();
  private decisions = new Map<string, PermissionDecision>();
  private rules: PermissionRule[] = [];
  private requestCounter = 0;
  private initialized = false;

  constructor() {
    super();
    // Load rules asynchronously
    this.initialize();
  }

  /**
   * Initialize the permission manager
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.loadRules();
    this.initialized = true;
    logger.info('PermissionManager initialized');
  }

  /**
   * Request permission from the user
   */
  async requestPermission(
    sessionId: AgentId,
    title: string,
    description?: string | null,
    options: PermissionOption[] = [],
    metadata?: {
      agentName?: string;
      riskLevel?: 'low' | 'medium' | 'high';
    },
  ): Promise<RequestPermissionOutcome> {
    const requestId = `perm_${Date.now()}_${++this.requestCounter}`;

    // Check if we have a cached rule
    const cachedOutcome = this.checkCachedRules(title, sessionId);
    if (cachedOutcome) {
      logger.info('Using cached permission decision', { title, outcome: cachedOutcome });
      return cachedOutcome;
    }

    // Create the request
    const request: PermissionRequest = {
      id: requestId,
      sessionId,
      title,
      description,
      options: options.length > 0 ? options : this.getDefaultOptions(),
      timestamp: Date.now(),
      agentName: metadata?.agentName,
      riskLevel: metadata?.riskLevel || this.assessRiskLevel(title),
    };

    this.pendingRequests.set(requestId, request);

    // Emit event for UI to handle
    this.emit('permission:request', request);

    // Wait for user decision
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Auto-deny after 2 minutes
        this.handleDecision(requestId, { outcome: 'cancelled' });
        resolve({ outcome: 'cancelled' });
      }, 120000);

      this.once(`permission:decision:${requestId}`, (decision: PermissionDecision) => {
        clearTimeout(timeout);
        resolve(decision.outcome);
      });
    });
  }

  /**
   * Handle user's permission decision
   */
  handleDecision(
    requestId: string,
    outcome: RequestPermissionOutcome,
    remember: boolean = false,
  ): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      logger.warn('Permission request not found', { requestId });
      return;
    }

    const decision: PermissionDecision = {
      requestId,
      outcome,
      timestamp: Date.now(),
      remember,
    };

    // Store decision temporarily for event delivery, then evict immediately.
    // Eviction strategy: per-request. The decisions Map is never queried by key
    // after storage — decision delivery uses EventEmitter, and getStatistics()
    // only reads .size. Deleting after emission prevents unbounded growth while
    // preserving the emit contract. If historical decision logging is needed in
    // the future, add a bounded ring buffer or external persistence instead.
    this.decisions.set(requestId, decision);
    this.pendingRequests.delete(requestId);

    // If user wants to remember, create a rule
    if (remember && outcome.outcome === 'selected') {
      this.addRule({
        pattern: request.title,
        action: this.mapOutcomeToAction(outcome),
        scope: 'session',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      });
    }

    // Emit decision events, then evict from the Map.
    // Each emit is wrapped individually so a throwing listener on the per-request
    // event can't prevent the 'permission:decided' broadcast (and vice-versa).
    // The per-request event (`permission:decision:${requestId}`) is what resolves
    // the promise inside requestPermission(), so it must fire reliably.
    try {
      this.emit(`permission:decision:${requestId}`, decision);
    } catch (err) {
      logger.error('Listener error on permission:decision event', { requestId, error: err });
    }
    try {
      this.emit('permission:decided', decision);
    } catch (err) {
      logger.error('Listener error on permission:decided event', { requestId, error: err });
    }

    // Per-request eviction: remove decision now that all listeners have been notified
    this.decisions.delete(requestId);

    logger.info('Permission decision made', {
      requestId,
      title: request.title,
      outcome: outcome.outcome,
      remember,
    });
  }

  /**
   * Cancel a pending permission request
   */
  cancelRequest(requestId: string): void {
    if (this.pendingRequests.has(requestId)) {
      this.handleDecision(requestId, { outcome: 'cancelled' });
    }
  }

  /**
   * Cancel all pending requests for a session
   */
  cancelSessionRequests(sessionId: AgentId): void {
    for (const [requestId, request] of this.pendingRequests) {
      if (request.sessionId === sessionId) {
        this.cancelRequest(requestId);
      }
    }
  }

  /**
   * Get all pending permission requests
   */
  getPendingRequests(): PermissionRequest[] {
    return Array.from(this.pendingRequests.values());
  }

  /**
   * Check cached rules for a permission
   */

  private checkCachedRules(title: string, _sessionId: AgentId): RequestPermissionOutcome | null {
    // Remove expired rules
    this.rules = this.rules.filter((rule) => !rule.expiresAt || rule.expiresAt > Date.now());

    // Find matching rule
    const matchingRule = this.rules.find((rule) => {
      if (rule.pattern === '*') return true;
      if (rule.pattern === title) return true;
      // Simple wildcard matching
      const regex = new RegExp(rule.pattern.replace(/\*/g, '.*'));
      return regex.test(title);
    });

    if (matchingRule) {
      if (matchingRule.action === 'allow') {
        return { outcome: 'selected', optionId: 'allow' };
      } else if (matchingRule.action === 'deny') {
        return { outcome: 'selected', optionId: 'deny' };
      }
    }

    return null;
  }

  /**
   * Add a permission rule
   */
  addRule(rule: PermissionRule): void {
    this.rules.push(rule);
    // Save asynchronously without blocking
    this.saveRules().catch((error) => {
      logger.error('Failed to save rules after adding', error as Error);
    });
  }

  /**
   * Clear all stored decisions. Called as belt-and-suspenders cleanup alongside
   * per-request eviction, e.g. on AcpServer.dispose().
   */
  clearDecisions(): void {
    const count = this.decisions.size;
    this.decisions.clear();
    if (count > 0) {
      logger.info(`Cleared ${count} permission decisions`);
    }
  }

  /**
   * Clear all rules.
   *
   * AUDIT-P0-2: returns Promise<void> and rejects on `saveRules` failure
   * instead of swallowing the error. The previous fire-and-forget pattern
   * (`.catch(log)`) hid persistence failures from callers, so a UI element
   * that cleared rules would appear to succeed while disk/IPC writes were
   * silently failing. Callers that genuinely want fire-and-forget can opt
   * in explicitly with `void permissionManager.clearRules(...)`.
   */
  async clearRules(scope?: 'session' | 'agent' | 'global'): Promise<void> {
    if (scope) {
      this.rules = this.rules.filter((rule) => rule.scope !== scope);
    } else {
      this.rules = [];
    }
    await this.saveRules();
  }

  /**
   * Get default permission options
   */
  private getDefaultOptions(): PermissionOption[] {
    return [
      {
        id: 'allow',
        label: m.acp_permission_allow_label(),
        description: m.acp_permission_allow_description(),
      },
      {
        id: 'deny',
        label: m.acp_permission_deny_label(),
        description: m.acp_permission_deny_description(),
      },
      {
        id: 'allow_once',
        label: m.acp_permission_allowOnce_label(),
        description: m.acp_permission_allowOnce_description(),
      },
    ];
  }

  /**
   * Assess risk level based on permission title
   */
  private assessRiskLevel(title: string): 'low' | 'medium' | 'high' {
    const lowRiskPatterns = /read|view|list|get/i;
    const highRiskPatterns = /delete|remove|execute|write|modify|create/i;

    if (highRiskPatterns.test(title)) return 'high';
    if (lowRiskPatterns.test(title)) return 'low';
    return 'medium';
  }

  /**
   * Map outcome to action
   */
  private mapOutcomeToAction(outcome: RequestPermissionOutcome): 'allow' | 'deny' | 'ask' {
    if (outcome.outcome === 'selected') {
      const optionId = (outcome as any).optionId;
      if (optionId === 'allow' || optionId === 'allow_once') return 'allow';
      if (optionId === 'deny') return 'deny';
    }
    return 'ask';
  }

  /**
   * Load saved rules from storage
   */
  private async loadRules(): Promise<void> {
    try {
      if (isBrowser) {
        // Browser environment: use localStorage
        const saved = localStorage.getItem(PERMISSION_RULES_KEY);
        if (saved) {
          this.rules = JSON.parse(saved);
          logger.info('Loaded permission rules from localStorage', { count: this.rules.length });
        }
      } else if (typeof window !== 'undefined' && window.electronAPI) {
        // Electron renderer: use IPC to access config store
        try {
          const saved = await invokeIpc<PermissionRule[]>('config:get', {
            key: 'permissions.rules',
          });
          if (saved && Array.isArray(saved)) {
            this.rules = saved;
            logger.info('Loaded permission rules from config store', { count: this.rules.length });
          } else {
            this.rules = [];
            logger.info('No saved permission rules found, starting with empty rules');
          }
        } catch {
          // Config IPC might not be available in tests
          this.rules = [];
          logger.debug('Config IPC not available, starting with empty rules');
        }
      } else {
        // Pure Node.js environment (tests, etc.)
        this.rules = [];
        logger.debug('Pure Node.js environment, starting with empty rules');
      }
    } catch (error) {
      logger.error('Failed to load permission rules', error as Error);
      this.rules = [];
    }
  }

  /**
   * Save rules to storage.
   *
   * AUDIT-P0-2: surfaces persistence failures to the caller instead of
   * swallowing them. `localStorage` write errors and BE-rejected
   * `config:set` responses now throw; the only catch retained is the
   * documented "IPC unavailable in tests" path (`invokeIpc` itself
   * throwing — e.g. no electronAPI wired up in a unit test).
   */
  private async saveRules(): Promise<void> {
    if (isBrowser) {
      // Browser environment: use localStorage. A throwing setItem (quota
      // exceeded, security exception) propagates to the caller.
      localStorage.setItem(PERMISSION_RULES_KEY, JSON.stringify(this.rules));
      logger.debug('Saved permission rules to localStorage');
      return;
    }

    if (typeof window !== 'undefined' && window.electronAPI) {
      // Electron renderer: use IPC to save to config store.
      let result: ConfigSetResponse;
      try {
        result = await invokeIpc<ConfigSetResponse>('config:set', {
          key: 'permissions.rules',
          value: this.rules,
        });
      } catch (error) {
        // Config IPC might not be available in tests — leave persistence
        // unobserved rather than failing the caller.
        logger.debug('Config IPC not available, rules not persisted', {
          error: (error as Error)?.message,
        });
        return;
      }

      if (!result.success) {
        const errMsg =
          typeof result.error === 'string' ? result.error : 'config:set rejected permission rules';
        logger.warn('Failed to save permission rules to config store', { error: result.error });
        throw new Error(errMsg);
      }
      logger.debug('Saved permission rules to config store');
      return;
    }

    // Pure Node.js environment (tests, etc.) — no persistence available.
    logger.debug('Pure Node.js environment, rules not persisted');
  }

  /**
   * Get statistics about permissions
   */
  getStatistics() {
    return {
      pendingCount: this.pendingRequests.size,
      totalDecisions: this.decisions.size,
      activeRules: this.rules.length,
      rulesByScope: this.rules.reduce(
        (acc, rule) => {
          const scope = rule.scope || 'global';
          acc[scope] = (acc[scope] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }
}

// Singleton instance
export const permissionManager = new PermissionManager();
