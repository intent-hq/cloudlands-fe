/**
 * IPC handlers for observability features
 *
 * Provides IPC endpoints for accessing agent event data from the renderer process
 */

import {
  ipcMain,
  BrowserWindow,
} from 'electron';
import {
  eventCollector,
  AgentEventFilter,
  AgentEvent,
} from '../event-collector';
import { Logger } from '../../../shared/logger';
import { OBSERVABILITY_CHANNELS } from '../../../shared/ipc/channels';
import * as fs from 'fs';
import * as path from 'path';
import { writeJsonAsync } from '../../../shared/main/async-utils';
import { getSafeHomeDir } from '../../../shared/main/utils';

const logger = new Logger('ObservabilityIPC');

// Storage will be initialized lazily
let storage: any = null;
let storageInitialized = false;

// In-memory event storage as fallback
const inMemoryEvents: AgentEvent[] = [];
const MAX_IN_MEMORY_EVENTS = 1000;

// Temporary file paths for CLI access - lazily initialized to avoid
// calling getSafeHomeDir() at module load time when HOME might not be ready
let _tempDir: string | null = null;
let _tempFile: string | null = null;
let tempDirInitialized = false;

/**
 * Get the temp directory path, lazily initializing it on first access.
 */
function getTempDir(): string {
  if (_tempDir === null) {
    _tempDir = path.join(getSafeHomeDir(), '.augment', 'observability');
  }
  return _tempDir;
}

/**
 * Get the temp file path, lazily initializing it on first access.
 */
function getTempFile(): string {
  if (_tempFile === null) {
    _tempFile = path.join(getTempDir(), 'events.json');
  }
  return _tempFile;
}

/**
 * Ensure the temp directory exists (called lazily on first write)
 */
function ensureTempDirectory(): boolean {
  if (tempDirInitialized) {
    return true;
  }

  try {
    const dir = getTempDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    tempDirInitialized = true;
    return true;
  } catch (error) {
    logger.error('Failed to create temp directory', error as Error);
    return false;
  }
}

/**
 * Write events to temp file for CLI access
 * PERF: Converted to async to prevent blocking main thread
 */
async function writeEventsToTempFile(): Promise<void> {
  try {
    // Ensure temp directory exists before writing
    if (!ensureTempDirectory()) {
      return;
    }

    const data = {
      events: inMemoryEvents,
      lastUpdated: new Date().toISOString(),
      count: inMemoryEvents.length,
    };
    await writeJsonAsync(getTempFile(), data);
    logger.debug('Wrote events to temp file', { count: inMemoryEvents.length });
  } catch (error) {
    logger.error('Failed to write events to temp file', error as Error);
  }
}

// Subscribe to event collector to store events
eventCollector.on('flush', async (events: AgentEvent[]) => {
  // Add to in-memory storage
  inMemoryEvents.push(...events);

  // Keep only the most recent events
  if (inMemoryEvents.length > MAX_IN_MEMORY_EVENTS) {
    inMemoryEvents.splice(0, inMemoryEvents.length - MAX_IN_MEMORY_EVENTS);
  }

  // Write to temp file for CLI access
  writeEventsToTempFile();

  // Try to persist to storage if available
  if (storage) {
    try {
      await storage.batchInsert(events);
      logger.debug('Events persisted to database', { count: events.length });
    } catch (error) {
      logger.error('Failed to persist events to database', error as Error);
    }
  } else {
    logger.debug('Events stored in memory only', {
      count: events.length,
      total: inMemoryEvents.length,
    });
  }
});

// Try to initialize storage lazily
async function initializeStorage() {
  if (storageInitialized) return storage;

  try {
    // Initialize SQLite storage
    const { EventStorage } = await import('./event-storage');
    storage = new EventStorage();
    storageInitialized = true;
    logger.info('SQLite storage initialized successfully');
    logger.info('Events will be persisted to database and available at /observability');
    return storage;
  } catch (error) {
    // Fall back to in-memory storage if SQLite fails
    logger.error('Failed to initialize SQLite storage, using in-memory only', error as Error);
    logger.info('Events will be available through the web dashboard at /observability');
    storageInitialized = true;
    return null;
  }
}

/**
 * Setup observability IPC handlers
 */
export function setupObservabilityIPC(): void {
  logger.info('Setting up observability IPC handlers');

  // Initialize storage asynchronously
  initializeStorage().catch((error) => {
    logger.error('Storage initialization failed', error as Error);
  });

  /**
   * Collect event from renderer process
   */
  ipcMain.handle(OBSERVABILITY_CHANNELS.COLLECT_EVENT, async (_event, event: AgentEvent) => {
    try {
      // Store in memory
      inMemoryEvents.push(event);

      // Trim if too many events
      if (inMemoryEvents.length > MAX_IN_MEMORY_EVENTS) {
        inMemoryEvents.shift();
      }

      // Write to temp file for CLI access
      writeEventsToTempFile();

      // Also send to the main event collector
      // The event will be persisted when the buffer flushes
      eventCollector.collect(event);

      logger.info('Event collected from renderer', {
        type: event.type,
        id: event.id,
        agentId: event.agentId,
        sessionId: event.sessionId,
      });

      return { success: true };
    } catch (error) {
      logger.error('Failed to collect event', error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Get events with optional filter
   */
  ipcMain.handle(
    OBSERVABILITY_CHANNELS.GET_EVENTS,
    async (_, { filter, limit = 100 }: { filter?: AgentEventFilter; limit?: number }) => {
      try {
        const store = await initializeStorage();
        if (!store) {
          // Use in-memory events
          let events = [...inMemoryEvents];

          // Apply filters
          if (filter) {
            if (filter.sessionId) {
              events = events.filter((e) => e.sessionId === filter.sessionId);
            }
            if (filter.agentId) {
              events = events.filter((e) => e.agentId === filter.agentId);
            }
            if (filter.types && filter.types.length > 0) {
              events = events.filter((e) => filter.types!.includes(e.type));
            }
            if (filter.workspaceId) {
              events = events.filter((e) => e.workspaceId === filter.workspaceId);
            }
            if (filter.timeRange) {
              if (filter.timeRange.start) {
                events = events.filter((e) => new Date(e.timestamp) >= filter.timeRange!.start!);
              }
              if (filter.timeRange.end) {
                events = events.filter((e) => new Date(e.timestamp) <= filter.timeRange!.end!);
              }
            }
          }

          // Apply limit
          events = events.slice(-limit);

          return { success: true, data: events };
        }
        const events = await store.query(filter, limit);
        return { success: true, data: events };
      } catch (error) {
        logger.error('Failed to get events', error as Error);
        return { success: false, error: (error as Error).message };
      }
    },
  );

  /**
   * Subscribe to real-time events
   */
  ipcMain.handle(
    OBSERVABILITY_CHANNELS.SUBSCRIBE,
    async (event, { filter }: { filter?: AgentEventFilter }) => {
      try {
        const stream = eventCollector.subscribe(filter);
        const windowId = BrowserWindow.fromWebContents(event.sender)?.id;

        if (!windowId) {
          throw new Error('Could not identify window');
        }

        // Forward events to the renderer
        stream.on('event', (agentEvent: AgentEvent) => {
          const window = BrowserWindow.fromId(windowId);
          if (window && !window.isDestroyed()) {
            window.webContents.send('observability:event', agentEvent);
          }
        });

        // Clean up on window close
        const window = BrowserWindow.fromId(windowId);
        window?.once('closed', () => {
          stream.emit('close');
        });

        return { success: true, data: { streamId: stream.id } };
      } catch (error) {
        logger.error('Failed to subscribe to events', error as Error);
        return { success: false, error: (error as Error).message };
      }
    },
  );

  /**
   * Get session summary
   */
  ipcMain.handle(
    OBSERVABILITY_CHANNELS.GET_SESSION_SUMMARY,
    async (_, { sessionId }: { sessionId: string }) => {
      try {
        const store = await initializeStorage();
        if (!store) {
          // Use in-memory events
          const events = inMemoryEvents.filter((e) => e.sessionId === sessionId);
          return { success: true, data: calculateSessionSummary(events) };
        }
        const events = await store.query({ sessionId });
        const summary = calculateSessionSummary(events);
        return { success: true, data: summary };
      } catch (error) {
        logger.error('Failed to get session summary', error as Error);
        return { success: false, error: (error as Error).message };
      }
    },
  );

  /**
   * Get metrics
   */
  ipcMain.handle(
    OBSERVABILITY_CHANNELS.GET_METRICS,
    async (_, { filter }: { filter?: AgentEventFilter }) => {
      try {
        const store = await initializeStorage();
        if (!store) {
          // Use in-memory events with filter
          let events = [...inMemoryEvents];
          if (filter) {
            if (filter.sessionId) events = events.filter((e) => e.sessionId === filter.sessionId);
            if (filter.agentId) events = events.filter((e) => e.agentId === filter.agentId);
            if (filter.types && filter.types.length > 0) {
              events = events.filter((e) => filter.types!.includes(e.type));
            }
          }
          return { success: true, data: calculateMetrics(events) };
        }
        const events = await store.query(filter);
        const metrics = calculateMetrics(events);
        return { success: true, data: metrics };
      } catch (error) {
        logger.error('Failed to get metrics', error as Error);
        return { success: false, error: (error as Error).message };
      }
    },
  );

  /**
   * Export events
   */
  ipcMain.handle(
    OBSERVABILITY_CHANNELS.EXPORT,
    async (
      _,
      {
        filter,
        format = 'json',
      }: {
        filter?: AgentEventFilter;
        format?: 'json' | 'csv' | 'otlp';
      },
    ) => {
      try {
        const store = await initializeStorage();
        if (!store) {
          return { success: true, data: '[]' };
        }
        const events = await store.query(filter);
        let exportData: string;

        switch (format) {
          case 'csv':
            exportData = eventsToCSV(events);
            break;
          case 'otlp':
            exportData = eventsToOTLP(events);
            break;
          default:
            exportData = JSON.stringify(events, null, 2);
        }

        return { success: true, data: exportData };
      } catch (error) {
        logger.error('Failed to export events', error as Error);
        return { success: false, error: (error as Error).message };
      }
    },
  );

  /**
   * Clear events (for debugging)
   */
  ipcMain.handle(OBSERVABILITY_CHANNELS.CLEAR, async () => {
    try {
      const store = await initializeStorage();
      if (store) {
        await store.clear();
      }
      return { success: true };
    } catch (error) {
      logger.error('Failed to clear events', error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info('Observability IPC handlers registered');
}

/**
 * Calculate session summary from events
 */
function calculateSessionSummary(events: AgentEvent[]): any {
  const summary = {
    sessionId: events[0]?.sessionId,
    startTime: events[0]?.timestamp,
    endTime: events[events.length - 1]?.timestamp,
    totalEvents: events.length,
    eventTypes: {} as Record<string, number>,
    actors: {} as Record<string, number>,
    errors: [] as any[],
    toolCalls: [] as any[],
    totalTokens: 0,
    totalCost: 0,
  };

  for (const event of events) {
    // Count event types
    summary.eventTypes[event.type] = (summary.eventTypes[event.type] || 0) + 1;

    // Count actors
    const actorKey = `${event.actor.type}:${event.actor.name || event.actor.id}`;
    summary.actors[actorKey] = (summary.actors[actorKey] || 0) + 1;

    // Collect errors
    if (event.type.includes('error')) {
      summary.errors.push({
        timestamp: event.timestamp,
        error: event.metadata?.error,
        context: event.data,
      });
    }

    // Collect tool calls
    if (event.type.includes('tool:call')) {
      summary.toolCalls.push({
        timestamp: event.timestamp,
        tool: event.data.toolName,
        duration: event.metadata?.duration,
      });
    }

    // Sum tokens and cost
    if (event.metadata?.tokenUsage) {
      summary.totalTokens += event.metadata.tokenUsage.total;
    }
    if (event.metadata?.cost) {
      summary.totalCost += event.metadata.cost;
    }
  }

  return summary;
}

/**
 * Calculate metrics from events
 */
function calculateMetrics(events: AgentEvent[]): any {
  const metrics = {
    totalEvents: events.length,
    eventsByType: {} as Record<string, number>,
    eventsByActor: {} as Record<string, number>,
    errorRate: 0,
    avgDuration: 0,
    totalTokens: 0,
    totalCost: 0,
    throughput: 0,
  };

  let totalDuration = 0;
  let durationCount = 0;
  let errorCount = 0;

  for (const event of events) {
    // Count by type
    metrics.eventsByType[event.type] = (metrics.eventsByType[event.type] || 0) + 1;

    // Count by actor
    const actorType = event.actor.type;
    metrics.eventsByActor[actorType] = (metrics.eventsByActor[actorType] || 0) + 1;

    // Count errors
    if (event.type.includes('error')) {
      errorCount++;
    }

    // Sum durations
    if (event.metadata?.duration) {
      totalDuration += event.metadata.duration;
      durationCount++;
    }

    // Sum tokens and cost
    if (event.metadata?.tokenUsage) {
      metrics.totalTokens += event.metadata.tokenUsage.total;
    }
    if (event.metadata?.cost) {
      metrics.totalCost += event.metadata.cost;
    }
  }

  // Calculate averages
  metrics.errorRate = events.length > 0 ? errorCount / events.length : 0;
  metrics.avgDuration = durationCount > 0 ? totalDuration / durationCount : 0;

  // Calculate throughput (events per minute)
  if (events.length > 1) {
    const firstTime = new Date(events[0].timestamp).getTime();
    const lastTime = new Date(events[events.length - 1].timestamp).getTime();
    const durationMinutes = (lastTime - firstTime) / (1000 * 60);
    metrics.throughput = durationMinutes > 0 ? events.length / durationMinutes : 0;
  }

  return metrics;
}

/**
 * Convert events to CSV format
 */
function eventsToCSV(events: AgentEvent[]): string {
  const headers = [
    'id',
    'type',
    'timestamp',
    'sessionId',
    'agentId',
    'workspaceId',
    'actorType',
    'actorId',
    'data',
    'error',
  ];

  const rows = events.map((e) => [
    e.id,
    e.type,
    e.timestamp,
    e.sessionId,
    e.agentId,
    e.workspaceId || '',
    e.actor.type,
    e.actor.id,
    JSON.stringify(e.data),
    e.metadata?.error || '',
  ]);

  return [headers, ...rows].map((row) => row.join(',')).join('\n');
}

/**
 * Convert events to OpenTelemetry format
 */
function eventsToOTLP(events: AgentEvent[]): string {
  const traces = {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'workspaces-agent' } }],
        },
        scopeSpans: [
          {
            spans: events.map((e) => ({
              traceId: e.sessionId,
              spanId: e.id,
              parentSpanId: e.parentEventId,
              name: e.type,
              startTimeUnixNano: new Date(e.timestamp).getTime() * 1000000,
              attributes: [
                ...Object.entries(e.data || {}).map(([k, v]) => ({
                  key: k,
                  value: { stringValue: String(v) },
                })),
                {
                  key: 'actor.type',
                  value: { stringValue: e.actor.type },
                },
                {
                  key: 'actor.id',
                  value: { stringValue: e.actor.id },
                },
              ],
            })),
          },
        ],
      },
    ],
  };

  return JSON.stringify(traces, null, 2);
}

/**
 * Export function to get in-memory events for external access
 */
export function getInMemoryEvents(): AgentEvent[] {
  return [...inMemoryEvents];
}

/**
 * Cleanup observability resources during shutdown.
 * Closes the SQLite database connection to prevent native crashes
 * from better-sqlite3 during process exit (AUGMENT-INTENT-9).
 */
export function cleanupObservability(): void {
  if (storage && typeof storage.close === 'function') {
    try {
      storage.close();
      logger.info('Observability storage closed');
    } catch (error) {
      logger.error('Failed to close observability storage', error as Error);
    }
    storage = null;
  }
}
