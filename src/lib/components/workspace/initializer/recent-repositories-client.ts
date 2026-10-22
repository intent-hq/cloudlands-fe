import type { AppClient } from '$lib/client/app-client';

/** App-client reads required by the recent-repository loader. */
export interface RecentRepositoriesClient {
  git: Pick<AppClient['git'], 'originUrl'>;
}
