import type { AppClient } from '$lib/client/app-client';
import type { RecentRepositoriesClient } from '$lib/components/workspace/initializer/recent-repositories-client';
import { createRecentRepositoriesClientFixture } from './recent-repositories-client';

// Renderer tsc includes this file; ordinary *.test.ts files are excluded.
function typecheckRecentRepositoriesClient(appClient: AppClient): void {
  const production: RecentRepositoriesClient = appClient;
  const fixture: RecentRepositoriesClient = createRecentRepositoriesClientFixture();
  const nullOrigin = {
    git: { originUrl: async () => null },
  } satisfies RecentRepositoriesClient;
  const missingOrigin = {
    // @ts-expect-error every fixture must supply the origin read, even when it returns null
    git: {},
  } satisfies RecentRepositoriesClient;
  // @ts-expect-error the git namespace is required
  const missingGit: RecentRepositoriesClient = {};
  const invalidOrigin = {
    // @ts-expect-error originUrl must return a nullable URL, not a success flag
    git: { originUrl: async () => false },
  } satisfies RecentRepositoriesClient;

  void [production, fixture, nullOrigin, missingOrigin, missingGit, invalidOrigin];
}

void typecheckRecentRepositoriesClient;
