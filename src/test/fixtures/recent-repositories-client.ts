import type { RecentRepositoriesClient } from '$lib/components/workspace/initializer/recent-repositories-client';

/** A fresh, provider-free client for picker tests and previews. */
export function createRecentRepositoriesClientFixture(): RecentRepositoriesClient {
  return { git: { originUrl: async () => null } };
}
