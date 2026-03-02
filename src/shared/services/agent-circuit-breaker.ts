/**
 * Agent Circuit Breaker
 *
 * Production guardrail that prevents runaway agent spawn loops and token burn.
 * Tracks failures, rate-limits, and spawn counts per workspace.
 *
 * Addresses:
 * - Sub-agents spawning 21+ times with no cap
 * - No backoff after rate-limit errors
 * - Burning through 3 full rate-limit windows unattended
 * - 80 agent starts for 13 unique agents (runaway behavior)
 */

import { Logger } from '$shared/logger';

const logger = new Logger('AgentCircuitBreaker');

export interface CircuitBreakerConfig {
  /** Max consecutive failures before tripping circuit */
  maxConsecutiveFailures: number;
  /** Max agent starts per workspace per session */
  maxAgentStartsPerSession: number;
  /** Max rate-limit errors before full stop */
  maxRateLimitErrors: number;
  /** Cooldown period (ms) after circuit trips */
  cooldownMs: number;
  /** Rate-limit cooldown (ms) - longer than normal cooldown */
  rateLimitCooldownMs: number;
  /** Time window (ms) for tracking agent starts */
  sessionWindowMs: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxConsecutiveFailures: 5,
  maxAgentStartsPerSession: 30,
  maxRateLimitErrors: 3,
  cooldownMs: 60_000,
  rateLimitCooldownMs: 5 * 60_000,
  sessionWindowMs: 60 * 60_000,
};

export type CircuitState = 'closed' | 'open' | 'half-open';
export type TripReason = 'consecutive_failures' | 'rate_limit' | 'spawn_limit' | 'manual';

export interface CircuitStatus {
  state: CircuitState;
  tripReason?: TripReason;
  consecutiveFailures: number;
  rateLimitErrors: number;
  agentStartsInSession: number;
  trippedAt?: number;
  cooldownEndsAt?: number;
}

interface WorkspaceCircuitState {
  consecutiveFailures: number;
  rateLimitErrors: number;
  agentStarts: { timestamp: number; agentId: string }[];
  state: CircuitState;
  tripReason?: TripReason;
  trippedAt?: number;
  cooldownMs: number;
  listeners: Set<(status: CircuitStatus) => void>;
}

export class AgentCircuitBreaker {
  private static instance: AgentCircuitBreaker;
  private config: CircuitBreakerConfig;
  private workspaces: Map<string, WorkspaceCircuitState> = new Map();

  private constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  static getInstance(config?: Partial<CircuitBreakerConfig>): AgentCircuitBreaker {
    if (!AgentCircuitBreaker.instance) {
      AgentCircuitBreaker.instance = new AgentCircuitBreaker(config);
    }
    return AgentCircuitBreaker.instance;
  }

  static resetInstance(): void {
    AgentCircuitBreaker.instance = undefined as any;
  }

  private getWorkspaceState(workspaceId: string): WorkspaceCircuitState {
    let state = this.workspaces.get(workspaceId);
    if (!state) {
      state = {
        consecutiveFailures: 0,
        rateLimitErrors: 0,
        agentStarts: [],
        state: 'closed',
        cooldownMs: this.config.cooldownMs,
        listeners: new Set(),
      };
      this.workspaces.set(workspaceId, state);
    }
    return state;
  }

  /**
   * Check if an agent operation is allowed for this workspace.
   * Returns { allowed: true } or { allowed: false, reason: string }.
   */
  canProceed(workspaceId: string): { allowed: boolean; reason?: string; status: CircuitStatus } {
    const ws = this.getWorkspaceState(workspaceId);

    if (ws.state === 'open') {
      const now = Date.now();
      const cooldownEnds = (ws.trippedAt || 0) + ws.cooldownMs;

      if (now < cooldownEnds) {
        const remainingSec = Math.ceil((cooldownEnds - now) / 1000);
        return {
          allowed: false,
          reason: `Circuit breaker open (${ws.tripReason}). Cooldown: ${remainingSec}s remaining.`,
          status: this.getStatus(workspaceId),
        };
      }

      ws.state = 'half-open';
      logger.info('Circuit breaker moving to half-open', { workspaceId });
    }

    this.pruneOldStarts(ws);
    if (ws.agentStarts.length >= this.config.maxAgentStartsPerSession) {
      this.tripCircuit(ws, workspaceId, 'spawn_limit');
      return {
        allowed: false,
        reason: `Agent spawn limit reached: ${ws.agentStarts.length} starts in session (max: ${this.config.maxAgentStartsPerSession}).`,
        status: this.getStatus(workspaceId),
      };
    }

    return { allowed: true, status: this.getStatus(workspaceId) };
  }

  /** Record a successful agent operation. Resets failure counts. */
  recordSuccess(workspaceId: string): void {
    const ws = this.getWorkspaceState(workspaceId);
    ws.consecutiveFailures = 0;
    // Reset rate-limit errors on success — if the agent is working again,
    // the rate-limit window has passed
    ws.rateLimitErrors = 0;

    if (ws.state === 'half-open') {
      ws.state = 'closed';
      ws.tripReason = undefined;
      ws.trippedAt = undefined;
      logger.info('Circuit breaker closed after successful operation', { workspaceId });
    }

    this.notifyListeners(ws, workspaceId);
  }

  /** Record a failed agent operation. */
  recordFailure(workspaceId: string, error?: string): void {
    const ws = this.getWorkspaceState(workspaceId);
    ws.consecutiveFailures++;

    logger.warn('Agent operation failed', {
      workspaceId,
      consecutiveFailures: ws.consecutiveFailures,
      maxAllowed: this.config.maxConsecutiveFailures,
      error: error?.substring(0, 200),
    });

    if (ws.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.tripCircuit(ws, workspaceId, 'consecutive_failures');
    }

    this.notifyListeners(ws, workspaceId);
  }

  /** Record a rate-limit error. These are treated more severely. */
  recordRateLimitError(workspaceId: string): void {
    const ws = this.getWorkspaceState(workspaceId);
    ws.rateLimitErrors++;
    ws.consecutiveFailures++;

    logger.error('Rate limit error recorded', {
      workspaceId,
      rateLimitErrors: ws.rateLimitErrors,
      maxAllowed: this.config.maxRateLimitErrors,
    });

    if (ws.rateLimitErrors >= this.config.maxRateLimitErrors) {
      this.tripCircuit(ws, workspaceId, 'rate_limit', this.config.rateLimitCooldownMs);
    }

    this.notifyListeners(ws, workspaceId);
  }

  /** Record an agent start event. */
  recordAgentStart(workspaceId: string, agentId: string): void {
    const ws = this.getWorkspaceState(workspaceId);
    ws.agentStarts.push({ timestamp: Date.now(), agentId });
    this.pruneOldStarts(ws);

    logger.debug('Agent start recorded', {
      workspaceId,
      agentId,
      totalStartsInSession: ws.agentStarts.length,
      maxAllowed: this.config.maxAgentStartsPerSession,
    });
  }

  /** Get current circuit status for a workspace. */
  getStatus(workspaceId: string): CircuitStatus {
    const ws = this.getWorkspaceState(workspaceId);
    this.pruneOldStarts(ws);

    return {
      state: ws.state,
      tripReason: ws.tripReason,
      consecutiveFailures: ws.consecutiveFailures,
      rateLimitErrors: ws.rateLimitErrors,
      agentStartsInSession: ws.agentStarts.length,
      trippedAt: ws.trippedAt,
      cooldownEndsAt: ws.trippedAt ? ws.trippedAt + ws.cooldownMs : undefined,
    };
  }

  /** Subscribe to circuit state changes for a workspace. */
  onStatusChange(workspaceId: string, listener: (status: CircuitStatus) => void): () => void {
    const ws = this.getWorkspaceState(workspaceId);
    ws.listeners.add(listener);
    return () => ws.listeners.delete(listener);
  }

  /** Manually reset the circuit breaker for a workspace. */
  reset(workspaceId: string): void {
    const ws = this.getWorkspaceState(workspaceId);
    ws.consecutiveFailures = 0;
    ws.rateLimitErrors = 0;
    ws.agentStarts = [];
    ws.state = 'closed';
    ws.tripReason = undefined;
    ws.trippedAt = undefined;
    ws.cooldownMs = this.config.cooldownMs;

    logger.info('Circuit breaker manually reset', { workspaceId });
    this.notifyListeners(ws, workspaceId);
  }

  /** Clean up state for a workspace. */
  removeWorkspace(workspaceId: string): void {
    this.workspaces.delete(workspaceId);
  }

  private tripCircuit(
    ws: WorkspaceCircuitState,
    workspaceId: string,
    reason: TripReason,
    cooldownMs?: number,
  ): void {
    ws.state = 'open';
    ws.tripReason = reason;
    ws.trippedAt = Date.now();
    ws.cooldownMs = cooldownMs || this.config.cooldownMs;

    logger.error('🚨 Circuit breaker TRIPPED', {
      workspaceId,
      reason,
      consecutiveFailures: ws.consecutiveFailures,
      rateLimitErrors: ws.rateLimitErrors,
      agentStarts: ws.agentStarts.length,
      cooldownMs: ws.cooldownMs,
    });

    this.notifyListeners(ws, workspaceId);
  }

  private pruneOldStarts(ws: WorkspaceCircuitState): void {
    const cutoff = Date.now() - this.config.sessionWindowMs;
    ws.agentStarts = ws.agentStarts.filter((s) => s.timestamp > cutoff);
  }

  private notifyListeners(ws: WorkspaceCircuitState, workspaceId: string): void {
    const status = this.getStatus(workspaceId);
    for (const listener of ws.listeners) {
      try {
        listener(status);
      } catch (e) {
        logger.error('Circuit breaker listener error', { error: e });
      }
    }
  }
}

/** Singleton instance */
export const agentCircuitBreaker = AgentCircuitBreaker.getInstance();
