import { createFileRoute } from '@tanstack/react-router';
import { createClientOnlyFn } from '@tanstack/react-start';
import { lazy } from 'react';
import { normalizeHomeConfiguration } from '../../../../src/features/home/home-workspaces-persistence';
import type { HomeFilter } from '../../../../src/features/home/home-model';

const Workspaces = lazy(
  createClientOnlyFn(async () => ({
    default: (await import('@/features/workspace/workspace-overview')).WorkspaceList,
  })),
);

export const Route = createFileRoute('/workspaces/')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { q?: string; filter?: HomeFilter } => {
    const filter = normalizeHomeConfiguration({ filter: search.filter }).filter;
    return {
      q: typeof search.q === 'string' && search.q ? search.q : undefined,
      filter: filter !== 'all' ? filter : undefined,
    };
  },
  component: WorkspaceListPage,
});

function WorkspaceListPage() {
  const { q, filter } = Route.useSearch();
  return <Workspaces query={q} filter={filter} />;
}
