/**
 * Event Storage for Observability
 *
 * Provides persistent storage for agent events using SQLite
 */

import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import { AgentEvent, AgentEventFilter, AgentEventType } from '../event-collector';
import { Logger } from '../../../shared/logger';

const logger = new Logger('EventStorage');

/**
 * SQLite-based event storage
 */
export class EventStorage {
  private db: Database.Database;
  private readonly dbPath: string;
  private isClosed = false;

  constructor(dbPath?: string) {
    try {
      // Default to user's home directory
      const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
      const augmentDir = path.join(homeDir, '.augment', 'observability');

      // Ensure directory exists
      if (!fs.existsSync(augmentDir)) {
        logger.debug('Creating observability directory', { augmentDir });
        fs.mkdirSync(augmentDir, { recursive: true });
      }

      this.dbPath = dbPath || path.join(augmentDir, 'events.db');

      // Initialize database
      try {
        this.db = new Database(this.dbPath, {
          verbose: (message: any) => logger.debug('SQLite:', { message }),
        });
      } catch (dbError: any) {
        logger.error('Failed to open database', dbError);
        throw dbError;
      }

      this.initializeSchema();

      logger.debug('Event storage initialized', { dbPath: this.dbPath });
    } catch (error) {
      logger.error('Failed to initialize event storage', error as Error);
      throw error;
    }
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        workspace_id TEXT,
        parent_event_id TEXT,
        correlation_id TEXT,
        turn_id TEXT,
        tool_call_id TEXT,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_name TEXT,
        actor_model TEXT,
        data TEXT NOT NULL,
        metadata TEXT,
        ui TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_agent_id ON events(agent_id);
      CREATE INDEX IF NOT EXISTS idx_events_workspace_id ON events(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_actor_type ON events(actor_type);
      CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events(correlation_id);

      -- Table for session metadata
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        workspace_id TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT,
        event_count INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        total_cost REAL DEFAULT 0,
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_workspace_id ON sessions(workspace_id);
    `);
  }

  /**
   * Insert a single event
   */
  async insert(event: AgentEvent): Promise<void> {
    if (this.isClosed) {
      logger.warn('Attempted to insert event after storage was closed');
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO events (
        id, type, timestamp, session_id, agent_id, workspace_id,
        parent_event_id, correlation_id, turn_id, tool_call_id,
        actor_type, actor_id, actor_name, actor_model,
        data, metadata, ui
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    try {
      stmt.run(
        event.id,
        event.type,
        event.timestamp,
        event.sessionId,
        event.agentId,
        event.workspaceId || null,
        event.parentEventId || null,
        event.correlationId || null,
        event.turnId || null,
        event.toolCallId || null,
        event.actor.type,
        event.actor.id,
        event.actor.name || null,
        event.actor.model || null,
        JSON.stringify(event.data),
        event.metadata ? JSON.stringify(event.metadata) : null,
        event.ui ? JSON.stringify(event.ui) : null,
      );

      // Update session metadata
      this.updateSessionMetadata(event);
    } catch (error) {
      logger.error('Failed to insert event', error as Error, { eventId: event.id });
      throw error;
    }
  }

  /**
   * Batch insert events
   */
  async batchInsert(events: AgentEvent[]): Promise<void> {
    if (this.isClosed) {
      logger.warn('Attempted to batch insert events after storage was closed');
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO events (
        id, type, timestamp, session_id, agent_id, workspace_id,
        parent_event_id, correlation_id, turn_id, tool_call_id,
        actor_type, actor_id, actor_name, actor_model,
        data, metadata, ui
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    const insertMany = this.db.transaction((events: AgentEvent[]) => {
      for (const event of events) {
        stmt.run(
          event.id,
          event.type,
          event.timestamp,
          event.sessionId,
          event.agentId,
          event.workspaceId || null,
          event.parentEventId || null,
          event.correlationId || null,
          event.turnId || null,
          event.toolCallId || null,
          event.actor.type,
          event.actor.id,
          event.actor.name || null,
          event.actor.model || null,
          JSON.stringify(event.data),
          event.metadata ? JSON.stringify(event.metadata) : null,
          event.ui ? JSON.stringify(event.ui) : null,
        );
      }
    });

    try {
      insertMany(events);

      // Update session metadata for all events
      for (const event of events) {
        this.updateSessionMetadata(event);
      }

      logger.debug('Batch inserted events', { count: events.length });
    } catch (error) {
      logger.error('Failed to batch insert events', error as Error);
      throw error;
    }
  }

  /**
   * Query events with filter
   */
  async query(filter?: AgentEventFilter, limit: number = 1000): Promise<AgentEvent[]> {
    if (this.isClosed) {
      logger.warn('Attempted to query events after storage was closed');
      return [];
    }

    let sql = 'SELECT * FROM events WHERE 1=1';
    const params: any[] = [];

    if (filter) {
      if (filter.types && filter.types.length > 0) {
        sql += ` AND type IN (${filter.types.map(() => '?').join(',')})`;
        params.push(...filter.types);
      }

      if (filter.sessionId) {
        sql += ' AND session_id = ?';
        params.push(filter.sessionId);
      }

      if (filter.agentId) {
        sql += ' AND agent_id = ?';
        params.push(filter.agentId);
      }

      if (filter.workspaceId) {
        sql += ' AND workspace_id = ?';
        params.push(filter.workspaceId);
      }

      if (filter.actorType) {
        sql += ' AND actor_type = ?';
        params.push(filter.actorType);
      }

      if (filter.timeRange) {
        if (filter.timeRange.start) {
          sql += ' AND timestamp >= ?';
          params.push(filter.timeRange.start.toISOString());
        }
        if (filter.timeRange.end) {
          sql += ' AND timestamp <= ?';
          params.push(filter.timeRange.end.toISOString());
        }
      }

      if (filter.search) {
        sql += ' AND (data LIKE ? OR metadata LIKE ?)';
        const searchPattern = `%${filter.search}%`;
        params.push(searchPattern, searchPattern);
      }
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params);

      return rows.map((row: any) => ({
        id: row.id,
        type: row.type as AgentEventType,
        timestamp: row.timestamp,
        sessionId: row.session_id,
        agentId: row.agent_id,
        workspaceId: row.workspace_id,
        parentEventId: row.parent_event_id,
        correlationId: row.correlation_id,
        turnId: row.turn_id,
        toolCallId: row.tool_call_id,
        actor: {
          type: row.actor_type,
          id: row.actor_id,
          name: row.actor_name,
          model: row.actor_model,
        },
        data: JSON.parse(row.data),
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        ui: row.ui ? JSON.parse(row.ui) : undefined,
      }));
    } catch (error) {
      logger.error('Failed to query events', error as Error);
      throw error;
    }
  }

  /**
   * Get event by ID
   */
  async getById(id: string): Promise<AgentEvent | null> {
    if (this.isClosed) {
      logger.warn('Attempted to get event by ID after storage was closed');
      return null;
    }

    const stmt = this.db.prepare('SELECT * FROM events WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      type: row.type as AgentEventType,
      timestamp: row.timestamp,
      sessionId: row.session_id,
      agentId: row.agent_id,
      workspaceId: row.workspace_id,
      parentEventId: row.parent_event_id,
      correlationId: row.correlation_id,
      turnId: row.turn_id,
      toolCallId: row.tool_call_id,
      actor: {
        type: row.actor_type,
        id: row.actor_id,
        name: row.actor_name,
        model: row.actor_model,
      },
      data: JSON.parse(row.data),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      ui: row.ui ? JSON.parse(row.ui) : undefined,
    };
  }

  /**
   * Update session metadata
   */
  private updateSessionMetadata(event: AgentEvent): void {
    try {
      // Check if session exists
      const checkStmt = this.db.prepare('SELECT id FROM sessions WHERE id = ?');
      const exists = checkStmt.get(event.sessionId);

      if (!exists) {
        // Create new session
        const insertStmt = this.db.prepare(`
          INSERT INTO sessions (id, agent_id, workspace_id, start_time)
          VALUES (?, ?, ?, ?)
        `);
        insertStmt.run(event.sessionId, event.agentId, event.workspaceId || null, event.timestamp);
      }

      // Update session metrics
      const updateStmt = this.db.prepare(`
        UPDATE sessions
        SET event_count = event_count + 1,
            end_time = ?,
            total_tokens = total_tokens + ?,
            total_cost = total_cost + ?
        WHERE id = ?
      `);

      updateStmt.run(
        event.timestamp,
        event.metadata?.tokenUsage?.total || 0,
        event.metadata?.cost || 0,
        event.sessionId,
      );
    } catch (error) {
      logger.error('Failed to update session metadata', error as Error);
    }
  }

  /**
   * Clear all events
   */
  async clear(): Promise<void> {
    if (this.isClosed) {
      logger.warn('Attempted to clear events after storage was closed');
      return;
    }

    try {
      this.db.exec('DELETE FROM events');
      this.db.exec('DELETE FROM sessions');
      logger.info('Cleared all events');
    } catch (error) {
      logger.error('Failed to clear events', error as Error);
      throw error;
    }
  }

  /**
   * Close database connection gracefully.
   * After calling close(), all subsequent operations will be no-ops.
   */
  close(): void {
    if (this.isClosed) return;

    this.isClosed = true;
    try {
      this.db.close();
      logger.info('Event storage database closed');
    } catch (error) {
      logger.error('Failed to close event storage database', error as Error);
    }
  }
}
