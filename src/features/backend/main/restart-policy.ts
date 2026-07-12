/**
 * Restart policy for the intentd sidecar daemon.
 *
 * Pure, unit-testable state machine for exponential-backoff auto-restart.
 * Ported from endara's sidecar supervision semantics.
 */

export interface RestartPolicyConfig {
  /** Base backoff delay in milliseconds (default: 1000ms) */
  baseDelayMs: number;
  /** Maximum backoff delay in milliseconds (default: 30000ms) */
  maxDelayMs: number;
  /** Maximum restart attempts before giving up (default: 5) */
  maxAttempts: number;
  /** Healthy uptime threshold in milliseconds (default: 60000ms) */
  healthyUptimeMs: number;
}

export const DEFAULT_RESTART_POLICY_CONFIG: RestartPolicyConfig = {
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  maxAttempts: 5,
  healthyUptimeMs: 60000,
};

export interface RestartDecision {
  /** Whether to restart the daemon */
  shouldRestart: boolean;
  /** Delay before restarting in milliseconds (0 if shouldRestart is false) */
  delayMs: number;
  /** Human-readable reason for the decision */
  reason: string;
  /** Remaining restart attempts after this decision (if applicable) */
  remainingAttempts?: number;
}

/**
 * Pure restart policy state machine.
 *
 * Tracks restart attempts and uptime to make restart decisions.
 */
export class RestartPolicy {
  private config: RestartPolicyConfig;
  private attemptCount = 0;
  private spawnTime: number | null = null;
  private intentionalStop = false;

  constructor(config: Partial<RestartPolicyConfig> = {}) {
    this.config = { ...DEFAULT_RESTART_POLICY_CONFIG, ...config };
  }

  /**
   * Call when the daemon is spawned. Starts tracking uptime.
   */
  onSpawn(): void {
    this.spawnTime = Date.now();
  }

  /**
   * Call when the daemon exits. Returns whether to restart and with what delay.
   *
   * @param exitCode - Process exit code (null if killed by signal)
   * @param signal - Signal that killed the process (null if exited normally)
   */
  onExit(exitCode: number | null, signal: string | null): RestartDecision {
    // Intentional stop suppresses restart
    if (this.intentionalStop) {
      this.reset();
      return {
        shouldRestart: false,
        delayMs: 0,
        reason: 'Intentional stop (teardown)',
      };
    }

    // Check if the daemon ran long enough to be considered healthy
    const uptime = this.spawnTime ? Date.now() - this.spawnTime : 0;
    if (uptime >= this.config.healthyUptimeMs) {
      // Reset attempt counter on healthy uptime
      this.attemptCount = 0;
    }

    // Increment attempt counter
    this.attemptCount++;

    // Check if we've exhausted our attempts
    if (this.attemptCount > this.config.maxAttempts) {
      const reason = `Max restart attempts (${this.config.maxAttempts}) exhausted`;
      this.reset();
      return {
        shouldRestart: false,
        delayMs: 0,
        reason,
      };
    }

    // Calculate exponential backoff delay
    const delayMs = Math.min(
      this.config.baseDelayMs * Math.pow(2, this.attemptCount - 1),
      this.config.maxDelayMs,
    );

    return {
      shouldRestart: true,
      delayMs,
      reason: `Restart attempt ${this.attemptCount}/${this.config.maxAttempts} after ${uptime}ms uptime`,
      remainingAttempts: this.config.maxAttempts - this.attemptCount,
    };
  }

  /**
   * Call when intentionally stopping the daemon (quit, teardown).
   * Suppresses restart on the next exit.
   */
  markIntentionalStop(): void {
    this.intentionalStop = true;
  }

  /**
   * Reset the policy state (clears attempt counter and flags).
   */
  reset(): void {
    this.attemptCount = 0;
    this.spawnTime = null;
    this.intentionalStop = false;
  }

  /**
   * Returns the current attempt count (for testing/diagnostics).
   */
  getAttemptCount(): number {
    return this.attemptCount;
  }

  /**
   * Returns whether an intentional stop is pending (for testing/diagnostics).
   */
  isIntentionalStop(): boolean {
    return this.intentionalStop;
  }
}
