import { call, put, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type { UsageStatsResult } from '$lib/client/app-client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { loadUsageStatsRequested, usageStatsFailed, usageStatsLoaded } from '../stats-slice';

const logger = createLogger('StatsReadSaga');

function* fetchUsageStats(action: ReturnType<typeof loadUsageStatsRequested>): SagaGenerator<void> {
  const [mode, key, tzOffsetMinutes] = action.payload;
  try {
    const data: UsageStatsResult = yield* call(
      [appClient.stats, appClient.stats.getUsage],
      mode,
      mode === '24h' ? undefined : (key ?? undefined),
      tzOffsetMinutes,
    );
    yield* put(usageStatsLoaded(mode, key, data));
  } catch (error) {
    const message = error instanceof Error ? error.message : m.stats_readService_loadFailed_error();
    logger.warn('stats.getUsage failed', { mode, key, error });
    yield* put(usageStatsFailed(mode, key, message));
  }
}

export function* statsReadSaga(): SagaGenerator<void> {
  yield* takeLatest(loadUsageStatsRequested, fetchUsageStats);
}
