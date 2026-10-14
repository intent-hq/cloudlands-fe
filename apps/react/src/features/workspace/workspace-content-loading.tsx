import { ContentSkeleton } from '@/components/workspace/content-skeleton';
import { Screen, ScreenBody } from '@/components/patterns/screen';
import { m } from '$shared/paraglide/messages.js';

export function WorkspaceContentLoading() {
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Block layout announces workspace loading while containing the panel skeleton.
      role="status"
      aria-label={m.layout_agentTab_loadingSpace_label()}
      data-testid="workspace-content-loading"
      className="h-80 min-w-0"
    >
      <ContentSkeleton />
    </div>
  );
}

export function WorkspaceRouteLoading() {
  return (
    <Screen className="min-h-screen">
      <ScreenBody>
        <WorkspaceContentLoading />
      </ScreenBody>
    </Screen>
  );
}
