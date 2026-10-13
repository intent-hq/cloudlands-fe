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
  validateSearch: (search: Record<string, unknown>): { note?: string; q?: string } => ({
    ...(typeof search.note === 'string' && search.note ? { note: search.note } : {}),
    ...(typeof search.q === 'string' && search.q ? { q: search.q } : {}),
  }),
  component: WorkspacePage,
});

function WorkspacePage() {
  const { workspaceId } = Route.useParams();
  const { note, q } = Route.useSearch();
  return <Overview workspaceId={workspaceId} noteId={note} query={q} />;
}
