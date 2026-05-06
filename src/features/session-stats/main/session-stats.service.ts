/**
 * Session Stats Service
 *
 * Main-process service that fetches session credit usage stats
 * by calling `auggie session stats <sessionId> --json`.
 */

import { Logger } from '$shared/logger';
import { executeAuggieCommand } from '../../auggie/main/execute-auggie-command';
import type { SessionStats, AggregatedSessionStats } from '../session-stats-types';

const logger = new Logger('SessionStatsService');

/** Timeout per CLI call (ms). */
const SESSION_STATS_TIMEOUT_MS = 10_000;

/**
 * Validate and parse raw CLI JSON into a {@link SessionStats}.
 * Throws with a descriptive message when the shape is wrong.
 */
function parseSessionStats(raw: unknown, sessionId: string): SessionStats {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`session stats for ${sessionId}: expected JSON object, got ${typeof raw}`);
  }
  const obj = raw as Record<string, unknown>;

  // Required string fields
  for (const field of ['sessionId', 'created', 'modified'] as const) {
    if (typeof obj[field] !== 'string') {
      throw new Error(
        `session stats for ${sessionId}: missing or invalid required field "${field}"`,
      );
    }
  }

  // Required number fields
  for (const field of ['messageCount', 'toolCount'] as const) {
    if (typeof obj[field] !== 'number') {
      throw new Error(
        `session stats for ${sessionId}: missing or invalid required field "${field}"`,
      );
    }
  }

  // Nullable string field
  if (obj.title !== null && typeof obj.title !== 'string') {
    throw new Error(`session stats for ${sessionId}: "title" must be string or null`);
  }

  // Nullable number fields
  for (const field of ['creditsUsed', 'parentCreditsUsed', 'subAgentCreditsUsed'] as const) {
    if (obj[field] !== null && typeof obj[field] !== 'number') {
      throw new Error(`session stats for ${sessionId}: "${field}" must be number or null`);
    }
  }

  return {
    sessionId: obj.sessionId as string,
    created: obj.created as string,
    modified: obj.modified as string,
    title: (obj.title as string | null) ?? null,
    messageCount: obj.messageCount as number,
    toolCount: obj.toolCount as number,
    creditsUsed: (obj.creditsUsed as number | null) ?? null,
    parentCreditsUsed: (obj.parentCreditsUsed as number | null) ?? null,
    subAgentCreditsUsed: (obj.subAgentCreditsUsed as number | null) ?? null,
  };
}
/**
 * Fetch stats for a single session via the auggie CLI.
 */
export async function getSessionStats(sessionId: string): Promise<SessionStats> {
  logger.debug('Fetching session stats', { sessionId });

  const { stdout } = await executeAuggieCommand(`session stats ${sessionId} --json`, {
    timeout: SESSION_STATS_TIMEOUT_MS,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`session stats for ${sessionId}: failed to parse CLI output as JSON`);
  }

  return parseSessionStats(parsed, sessionId);
}

/**
 * Fetch and aggregate stats across multiple sessions.
 *
 * Uses `Promise.allSettled` so a single failed CLI call doesn't sink the
 * entire workspace aggregate. If every call fails, throws an error.
 */
export async function getAggregatedSessionStats(
  sessionIds: string[],
): Promise<AggregatedSessionStats> {
  logger.debug('Fetching aggregated session stats', {
    count: sessionIds.length,
    sessionIds,
  });

  const results = await Promise.allSettled(sessionIds.map(getSessionStats));

  const sessions: SessionStats[] = [];
  let failCount = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      sessions.push(result.value);
    } else {
      failCount++;
      logger.warn('Failed to fetch session stats', {
        sessionId: sessionIds[i],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }

  logger.debug('Aggregated session stats results', {
    requested: sessionIds.length,
    succeeded: sessions.length,
    failed: failCount,
  });

  if (sessions.length === 0 && sessionIds.length > 0) {
    throw new Error(
      `All ${sessionIds.length} session stats requests failed`,
    );
  }

  const totalCreditsUsed =
    Math.round(sessions.reduce((sum, s) => sum + (s.creditsUsed ?? 0), 0) * 100) / 100;
  const totalParentCreditsUsed =
    Math.round(sessions.reduce((sum, s) => sum + (s.parentCreditsUsed ?? 0), 0) * 100) / 100;
  const totalSubAgentCreditsUsed =
    Math.round(sessions.reduce((sum, s) => sum + (s.subAgentCreditsUsed ?? 0), 0) * 100) / 100;
  const totalMessageCount = sessions.reduce((sum, s) => sum + s.messageCount, 0);
  const totalToolCount = sessions.reduce((sum, s) => sum + s.toolCount, 0);

  const hasPendingCredits = sessions.some((s) => s.creditsUsed === null);

  return {
    sessions,
    totalCreditsUsed,
    totalParentCreditsUsed,
    totalSubAgentCreditsUsed,
    totalMessageCount,
    totalToolCount,
    hasPendingCredits,
    isPartial: failCount > 0,
    failedCount: failCount,
  };
}
