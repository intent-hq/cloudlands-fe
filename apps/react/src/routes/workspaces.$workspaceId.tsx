import { createFileRoute } from '@tanstack/react-router';
import { createClientOnlyFn } from '@tanstack/react-start';
import { lazy } from 'react';

const Overview = lazy(
  createClientOnlyFn(async () => ({
    default: (await import('@/features/workspace/workspace-overview')).WorkspaceOverview,
  })),
);

export const Route = createFileRoute('/workspaces/$workspaceId')({
  ssr: false,
  component: WorkspacePage,
});

function WorkspacePage() {
  const { workspaceId } = Route.useParams();
  return <Overview workspaceId={workspaceId} />;
}
