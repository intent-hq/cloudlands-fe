/**
 * Agent Pool Service
 *
 * Pre-warms agent provider processes for faster agent creation.
 * When a workspace is opened, this service spawns a provider process in the background
 * so it's ready when the user creates an agent or sends a message.
 *
 * Benefits:
 * - Eliminates ~600-900ms initialization latency on first message
 * - Provides instant agent responsiveness
 * - Maintains one warm provider per workspace
 */

import { Logger } from '../../../shared/logger';
import { EventEmitter } from 'events';
import { getDefaultProviderConfig } from '$shared/config/provider-config';

const logger = new Logger('AgentPool');

interface WarmProvider {
  provider: any; // BaseAgentProvider
  workspaceId: string;
  workspacePath: string;
  createdAt: Date;
  sessionId?: string;
}

/**
 * Agent Pool Service - Singleton
 *
 * Manages pre-warmed agent providers for fast agent creation.
 */
class AgentPoolService extends EventEmitter {
  private static instance: AgentPoolService;

  // Map of workspaceId -> warm provider (one per workspace)
  private warmProviders = new Map<string, WarmProvider>();

  // Map of workspaceId -> warming promise (to prevent duplicate warming)
  private warmingInProgress = new Map<string, Promise<void>>();

  // Idle timeout - dispose warm providers after this time (5 minutes)
  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000;

  // Timeout handles for idle cleanup
  private idleTimers = new Map<string, NodeJS.Timeout>();

  private constructor() {
    super();
  }

  static getInstance(): AgentPoolService {
    if (!AgentPoolService.instance) {
      AgentPoolService.instance = new AgentPoolService();
    }
    return AgentPoolService.instance;
  }

  /**
   * Start pre-warming a provider for a workspace.
   * Call this when a workspace is opened.
   * This is fire-and-forget - it doesn't block the workspace open flow.
   */
  startWarming(workspaceId: string, workspacePath: string): void {
    // Don't warm if we already have one or warming is in progress
    if (this.warmProviders.has(workspaceId) || this.warmingInProgress.has(workspaceId)) {
      logger.debug('Skipping warmup - already warm or warming', {
        workspaceId,
        hasWarm: this.warmProviders.has(workspaceId),
        isWarming: this.warmingInProgress.has(workspaceId),
      });
      return;
    }

    logger.info('Starting agent pre-warmup for workspace', { workspaceId, workspacePath });

    // Start warming in background (don't await)
    const warmingPromise = this.warmProvider(workspaceId, workspacePath)
      .then(() => {
        logger.info('Agent pre-warmup complete', { workspaceId });
        this.warmingInProgress.delete(workspaceId);
      })
      .catch((error) => {
        logger.warn('Agent pre-warmup failed', { workspaceId, error: error?.message });
        this.warmingInProgress.delete(workspaceId);
      });

    this.warmingInProgress.set(workspaceId, warmingPromise);
  }

  /**
   * Get a warm provider if available, otherwise return null.
   * The caller should create a new provider if null is returned.
   * After retrieving, the warm provider is removed from the pool.
   */
  async getWarmProvider(workspaceId: string): Promise<WarmProvider | null> {
    // If warming is in progress, wait for it to complete
    const warmingPromise = this.warmingInProgress.get(workspaceId);
    if (warmingPromise) {
      logger.debug('Waiting for warming to complete', { workspaceId });
      try {
        await warmingPromise;
      } catch {
        // Warming failed, return null
        return null;
      }
    }

    const warm = this.warmProviders.get(workspaceId);
    if (!warm) {
      return null;
    }

    // Remove from pool (it's now being used)
    this.warmProviders.delete(workspaceId);

    // Clear idle timer
    const timer = this.idleTimers.get(workspaceId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(workspaceId);
    }

    logger.info('Providing warm provider', {
      workspaceId,
      age: Date.now() - warm.createdAt.getTime(),
    });

    return warm;
  }

  /**
   * Check if a warm provider is available (sync check)
   */
  hasWarmProvider(workspaceId: string): boolean {
    return this.warmProviders.has(workspaceId);
  }

  /**
   * Clean up warm providers for a workspace.
   * Call this when a workspace is closed.
   */
  async disposeWorkspace(workspaceId: string): Promise<void> {
    // Cancel any in-progress warming
    this.warmingInProgress.delete(workspaceId);

    // Clear idle timer
    const timer = this.idleTimers.get(workspaceId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(workspaceId);
    }

    // Dispose warm provider if exists
    const warm = this.warmProviders.get(workspaceId);
    if (warm) {
      this.warmProviders.delete(workspaceId);
      await this.disposeProvider(warm.provider);
      logger.info('Disposed warm provider on workspace close', { workspaceId });
    }
  }

  /**
   * Dispose all warm providers.
   * Call this on app shutdown.
   */
  async disposeAll(): Promise<void> {
    logger.info('Disposing all warm providers', { count: this.warmProviders.size });

    // Clear all timers
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    this.warmingInProgress.clear();

    // Dispose all providers in parallel
    const disposePromises = Array.from(this.warmProviders.values()).map((warm) =>
      this.disposeProvider(warm.provider).catch((e) =>
        logger.warn('Error disposing warm provider', { error: e?.message }),
      ),
    );

    await Promise.all(disposePromises);
    this.warmProviders.clear();
  }

  /**
   * Internal: Warm a provider for a workspace
   */
  private async warmProvider(workspaceId: string, workspacePath: string): Promise<void> {
    const startTime = Date.now();

    try {
      // Import ProviderRegistry dynamically to avoid circular deps
      const { ProviderRegistry } = await import('./provider-registry');
      const registry = ProviderRegistry.createDefault();

      // Create and initialize provider using the default provider config
      const defaultConfig = getDefaultProviderConfig();
      const provider = await registry.create('acp', {
        provider: 'acp',
        workspaceId,
        workspacePath,
        // Don't set agentId - it will be assigned when used
        command: defaultConfig.command,
        args: [...defaultConfig.baseArgs],
      });

      // Store warm provider
      this.warmProviders.set(workspaceId, {
        provider,
        workspaceId,
        workspacePath,
        createdAt: new Date(),
        sessionId: (provider as any).sessionId,
      });

      // Set up idle timeout
      this.resetIdleTimer(workspaceId);

      logger.info('Provider pre-warmed successfully', {
        workspaceId,
        elapsed: Date.now() - startTime,
        sessionId: (provider as any).sessionId,
      });

      this.emit('provider:warmed', { workspaceId });
    } catch (error) {
      logger.error('Failed to warm provider', {
        workspaceId,
        elapsed: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Internal: Reset idle timer for a workspace
   */
  private resetIdleTimer(workspaceId: string): void {
    // Clear existing timer
    const existing = this.idleTimers.get(workspaceId);
    if (existing) {
      clearTimeout(existing);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.handleIdleTimeout(workspaceId);
    }, this.IDLE_TIMEOUT_MS);

    this.idleTimers.set(workspaceId, timer);
  }

  /**
   * Internal: Handle idle timeout - dispose warm provider
   */
  private async handleIdleTimeout(workspaceId: string): Promise<void> {
    const warm = this.warmProviders.get(workspaceId);
    if (!warm) return;

    logger.info('Disposing warm provider due to idle timeout', {
      workspaceId,
      age: Date.now() - warm.createdAt.getTime(),
    });

    this.warmProviders.delete(workspaceId);
    this.idleTimers.delete(workspaceId);
    await this.disposeProvider(warm.provider);
  }

  /**
   * Internal: Safely dispose a provider
   */
  private async disposeProvider(provider: any): Promise<void> {
    try {
      if (provider && typeof provider.dispose === 'function') {
        await provider.dispose();
      } else if (provider && typeof provider.destroy === 'function') {
        await provider.destroy();
      }
    } catch (error) {
      logger.warn('Error disposing provider', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get pool stats for debugging
   */
  getStats(): { warmCount: number; warmingCount: number; workspaces: string[] } {
    return {
      warmCount: this.warmProviders.size,
      warmingCount: this.warmingInProgress.size,
      workspaces: Array.from(this.warmProviders.keys()),
    };
  }
}

export const agentPoolService = AgentPoolService.getInstance();
