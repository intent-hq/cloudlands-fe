import { createFileRoute } from '@tanstack/react-router';
import { createClientOnlyFn } from '@tanstack/react-start';
import { lazy } from 'react';

const Workspaces = lazy(
  createClientOnlyFn(async () => ({
    default: (await import('@/features/workspace/workspace-overview')).WorkspaceList,
  })),
);

export const Route = createFileRoute('/workspaces/')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search.q === 'string' && search.q ? { q: search.q } : {},
  component: WorkspaceListPage,
});

function WorkspaceListPage() {
  const { q } = Route.useSearch();
  return <Workspaces query={q} />;
}
