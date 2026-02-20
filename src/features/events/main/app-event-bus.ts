/**
 * AppEventBus - Application-level event bus
 *
 * This is SEPARATE from WorkspaceEventBus:
 * - No workspaceId required or allowed
 * - No persistence (app events are transient)
 * - Simple emit/listen pattern
 * - Used for app lifecycle, auth, system events
 *
 * This replaces the anti-pattern of using `__global__` workspace ID
 * for events that don't belong to any workspace.
 */

import { EventEmitter } from '../../../shared/event-emitter';
import { z } from 'zod';
import { Logger } from '../../../shared/logger';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger('AppEventBus');

// ============================================================================
// App Event Type Schemas (Zod validation)
// ============================================================================

/**
 * App-level event types with Zod schemas for runtime validation
 */
export const AppEventSchemas = {
  'app:startup': z.object({
    version: z.string(),
    environment: z.enum(['development', 'production']).optional(),
    startupTimeMs: z.number().optional(),
  }),
  'app:shutdown': z.object({
    reason: z.enum(['user', 'update', 'crash', 'system']).optional(),
    graceful: z.boolean().optional(),
  }),
  'app:settings-changed': z.object({
    setting: z.string(),
    oldValue: z.unknown().optional(),
    newValue: z.unknown(),
  }),
  'app:update-available': z.object({
    version: z.string(),
    releaseNotes: z.string().optional(),
  }),
  'auth:login': z.object({
    userId: z.string(),
    method: z.enum(['email', 'github', 'google', 'sso', 'token']).optional(),
  }),
  'auth:logout': z.object({
    userId: z.string().optional(),
    reason: z.enum(['user', 'session-expired', 'forced']).optional(),
  }),
  'auth:token-refreshed': z.object({
    userId: z.string().optional(),
  }),
  'auth:required': z.object({
    provider: z.string().optional(),
    reason: z.string().optional(),
  }),
  'system:memory-warning': z.object({
    usedMB: z.number(),
    totalMB: z.number(),
    threshold: z.number(),
  }),
  'system:disk-space-low': z.object({
    availableMB: z.number(),
    threshold: z.number(),
  }),
  'system:error': z.object({
    error: z.string(),
    stack: z.string().optional(),
    fatal: z.boolean().optional(),
  }),
} as const;

export type AppEventType = keyof typeof AppEventSchemas;
export type AppEventPayload<T extends AppEventType> = z.infer<(typeof AppEventSchemas)[T]>;

// ============================================================================
// App Event Interface
// ============================================================================

/**
 * Application-level event record
 */
export interface AppEvent<T extends AppEventType = AppEventType> {
  id: string;
  type: T;
  timestamp: string;
  data: AppEventPayload<T>;
}

// ============================================================================
// AppEventBus Implementation
// ============================================================================

/**
 * AppEventBus - Singleton for application-level events
 *
 * Design decisions:
 * 1. NO workspaceId - app events are not scoped to workspaces
 * 2. NO persistence - app events are transient (unlike workspace events)
 * 3. Zod validation - runtime type safety for all payloads
 * 4. Last event cache - can query the most recent event of each type
 */
export class AppEventBus extends EventEmitter {
  private static instance: AppEventBus | null = null;
  private lastEvents: Map<AppEventType, AppEvent> = new Map();

  private constructor() {
    super();
    this.setMaxListeners(50);
    logger.info('AppEventBus initialized');
  }

  /**
   * Get singleton instance
   */
  static getInstance(): AppEventBus {
    if (!AppEventBus.instance) {
      AppEventBus.instance = new AppEventBus();
    }
    return AppEventBus.instance;
  }

  /**
   * Reset the singleton (for testing)
   */
  static resetInstance(): void {
    if (AppEventBus.instance) {
      AppEventBus.instance.removeAllListeners();
      AppEventBus.instance.lastEvents.clear();
      AppEventBus.instance = null;
    }
  }

  /**
   * Emit a typed app event with Zod validation
   */
  emitAppEvent<T extends AppEventType>(type: T, data: AppEventPayload<T>): AppEvent<T> {
    // Validate payload at runtime
    const schema = AppEventSchemas[type];
    const result = schema.safeParse(data);

    if (!result.success) {
      logger.error('Invalid app event payload', {
        type,
        errors: result.error.errors,
      });
      throw new Error(`Invalid payload for app event '${type}': ${result.error.message}`);
    }

    const event: AppEvent<T> = {
      id: uuidv4(),
      type,
      timestamp: new Date().toISOString(),
      data: result.data as AppEventPayload<T>,
    };

    // Cache last event of this type
    this.lastEvents.set(type, event as AppEvent);

    // Emit to listeners
    super.emit(type, event);
    super.emit('app-event', event); // Catch-all for any app event

    logger.debug('App event emitted', { type, eventId: event.id });

    return event;
  }

  /**
   * Listen for a specific app event type
   */
  onAppEvent<T extends AppEventType>(type: T, listener: (event: AppEvent<T>) => void): this {
    return super.on(type, listener as any);
  }

  /**
   * Listen for any app event
   */
  onAnyAppEvent(listener: (event: AppEvent) => void): this {
    return super.on('app-event', listener);
  }

  /**
   * Listen for a specific app event type once
   */
  onceAppEvent<T extends AppEventType>(type: T, listener: (event: AppEvent<T>) => void): this {
    return super.once(type, listener as any);
  }

  /**
   * Remove app event listener
   */
  offAppEvent<T extends AppEventType>(type: T, listener: (event: AppEvent<T>) => void): this {
    return super.off(type, listener as any);
  }

  /**
   * Get the last event of a specific type
   */
  getLastEvent<T extends AppEventType>(type: T): AppEvent<T> | undefined {
    return this.lastEvents.get(type) as AppEvent<T> | undefined;
  }

  /**
   * Get all cached last events
   */
  getAllLastEvents(): Map<AppEventType, AppEvent> {
    return new Map(this.lastEvents);
  }

  /**
   * Check if an event type is a valid app event type
   */
  static isAppEventType(type: string): type is AppEventType {
    return type in AppEventSchemas;
  }
}

// Export singleton instance
export const appEventBus = AppEventBus.getInstance();
