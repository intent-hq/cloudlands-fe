import { createFileRoute, retainSearchParams } from '@tanstack/react-router';
import { createClientOnlyFn } from '@tanstack/react-start';
import { lazy } from 'react';
import { WorkspaceRouteLoading } from '@/features/workspace/workspace-content-loading';
import { normalizeHomeConfiguration } from '../../../../src/features/home/home-workspaces-persistence';
import type { HomeFilter } from '../../../../src/features/home/home-model';

const Overview = lazy(
  createClientOnlyFn(async () => ({
    default: (await import('@/features/workspace/workspace-overview')).WorkspaceOverview,
  })),
);

export const Route = createFileRoute('/workspaces/$workspaceId')({
  ssr: false,
  pendingComponent: WorkspaceRouteLoading,
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    agent?: string;
    message?: string;
    note?: string;
    q?: string;
    file?: string;
    line?: number;
    fileQuery?: string;
    homeQuery?: string;
    homeFilter?: HomeFilter;
  } => {
    const homeFilter = normalizeHomeConfiguration({ filter: search.homeFilter }).filter;
    return {
      ...(typeof search.agent === 'string' && search.agent ? { agent: search.agent } : {}),
      ...(typeof search.agent === 'string' &&
      search.agent &&
      typeof search.message === 'string' &&
      search.message
        ? { message: search.message }
        : {}),
      ...(typeof search.note === 'string' && search.note ? { note: search.note } : {}),
      ...(typeof search.q === 'string' && search.q ? { q: search.q } : {}),
      ...(typeof search.file === 'string' && search.file ? { file: search.file } : {}),
      ...(typeof search.fileQuery === 'string' && search.fileQuery
        ? { fileQuery: search.fileQuery }
        : {}),
      ...(Number.isSafeInteger(Number(search.line)) && Number(search.line) > 0
        ? { line: Number(search.line) }
        : {}),
      ...(typeof search.homeQuery === 'string' && search.homeQuery
        ? { homeQuery: search.homeQuery }
        : {}),
      ...(homeFilter !== 'all' ? { homeFilter } : {}),
    };
  },
  search: { middlewares: [retainSearchParams(['homeQuery', 'homeFilter'])] },
  component: WorkspacePage,
});

function WorkspacePage() {
  const { workspaceId } = Route.useParams();
  const { agent, message, note, q, file, line, fileQuery, homeQuery, homeFilter } =
    Route.useSearch();
  return (
    <Overview
      workspaceId={workspaceId}
      agentId={agent}
      messageId={message}
      noteId={note}
      query={q}
      filePath={file}
      line={line}
      fileQuery={fileQuery}
      homeQuery={homeQuery}
      homeFilter={homeFilter}
    />
  );
}
