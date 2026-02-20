/**
 * Heartbeat Service
 *
 * Monitors agent session health and connectivity
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('Heartbeat');

interface HeartbeatInfo {
  interval: NodeJS.Timeout;
  lastBeat: number;
  callback: () => void;
}

class HeartbeatService {
  private static instance: HeartbeatService;
  private heartbeats = new Map<string, HeartbeatInfo>();

  private constructor() {}

  static getInstance(): HeartbeatService {
    if (!HeartbeatService.instance) {
      HeartbeatService.instance = new HeartbeatService();
    }
    return HeartbeatService.instance;
  }

  /**
   * Start heartbeat for a session (overloaded for different signatures)
   */
  startHeartbeat(sessionId: string, callback: () => void, intervalMs?: number): void;
  startHeartbeat(
    agentId: string,
    sessionId: string,
    workspaceId: string,
    callback: () => void,
  ): void;
  startHeartbeat(
    arg1: string,
    arg2: string | (() => void),
    arg3?: string | number,
    arg4?: () => void,
  ): void {
    let sessionId: string;
    let callback: () => void;
    let intervalMs = 30000;

    if (typeof arg2 === 'function') {
      // Two or three parameter version: (sessionId, callback, intervalMs?)
      sessionId = arg1;
      callback = arg2;
      if (typeof arg3 === 'number') {
        intervalMs = arg3;
      }
    } else {
      // Four parameter version: (agentId, sessionId, workspaceId, callback)
      sessionId = arg1; // Use agentId as the key
      callback = arg4!;
      logger.debug('Starting heartbeat with workspace context', {
        agentId: arg1,
        sessionId: arg2,
        workspaceId: arg3,
      });
    }

    this.stopHeartbeat(sessionId);

    const interval = setInterval(() => {
      const info = this.heartbeats.get(sessionId);
      if (info) {
        const now = Date.now();
        const timeSinceLastBeat = now - info.lastBeat;

        // If no beat received in 60 seconds, trigger callback
        if (timeSinceLastBeat > 60000) {
          logger.warn('Heartbeat timeout', { sessionId, timeSinceLastBeat });
          callback();
          this.stopHeartbeat(sessionId);
        }
      }
    }, intervalMs);

    this.heartbeats.set(sessionId, {
      interval,
      lastBeat: Date.now(),
      callback,
    });
  }

  /**
   * Record a heartbeat
   */
  beat(sessionId: string): void {
    const info = this.heartbeats.get(sessionId);
    if (info) {
      info.lastBeat = Date.now();
      logger.debug('Heartbeat received', { sessionId });
    }
  }

  /**
   * Stop heartbeat for a session
   */
  stopHeartbeat(sessionId: string): void {
    const info = this.heartbeats.get(sessionId);
    if (info) {
      clearInterval(info.interval);
      this.heartbeats.delete(sessionId);
      logger.debug('Stopped heartbeat', { sessionId });
    }
  }

  /**
   * Stop all heartbeats
   */
  stopAll(): void {
    this.heartbeats.forEach((info) => clearInterval(info.interval));
    this.heartbeats.clear();
    logger.info('Stopped all heartbeats');
  }
}

export const heartbeatService = HeartbeatService.getInstance();
