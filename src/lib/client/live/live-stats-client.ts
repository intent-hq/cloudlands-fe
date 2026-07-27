/**
 * Live stats domain backed by the intentd daemon (`stats.getUsage`).
 *
 * Global usage-stats read behind the agentic usage-stats overlay — no
 * `workspaceId`. `period` is "24h" / "month" / "year"; `key` ("YYYY-MM" /
 * "YYYY") is required for month/year and omitted for 24h; `tzOffsetMinutes`
 * (minutes east of UTC) shifts buckets into the client's local time before
 * grouping (Spec D8). Errors are NOT folded: the overlay renders an explicit
 * error state rather than a fabricated zeroed dataset.
 */
import type { AppClient, StatsClient, UsageStatsPeriod, UsageStatsResult } from '../app-client';
import { backendRequest } from './backend-transport';

export class LiveStatsClient implements StatsClient {
  async getUsage(
    period: UsageStatsPeriod,
    key: string | undefined,
    tzOffsetMinutes: number,
  ): Promise<UsageStatsResult> {
    // Omit `key` for 24h per the router contract (it is ignored, but the
    // request should mirror the documented shape).
    const params: Record<string, unknown> = { period, tzOffsetMinutes };
    if (key !== undefined) params.key = key;
    const result = await backendRequest<UsageStatsResult>('stats.getUsage', params);
    // Validate the required rollups at ingest instead of defaulting them
    // downstream (AGENTS.md: no defensive defaults to mask missing fields).
    // A rejection here flows through `usageStatsFailed` and renders as the
    // overlay's error state.
    for (const field of ['byModel', 'byProvider'] as const) {
      if (!Array.isArray(result[field])) {
        throw new Error(
          `stats.getUsage result is missing the required \`${field}\` array ` +
            `(PROTOCOL §5.36) — the daemon is likely outdated and predates this field`,
        );
      }
    }
    return result;
  }
}

// Tied to AppClient["stats"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient['stats'] | undefined = undefined as LiveStatsClient | undefined;
void _interfaceCheck;
