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
  validateSearch: (
    search: Record<string, unknown>,
  ): { note?: string; q?: string; file?: string; line?: number } => ({
    ...(typeof search.note === 'string' && search.note ? { note: search.note } : {}),
    ...(typeof search.q === 'string' && search.q ? { q: search.q } : {}),
    ...(typeof search.file === 'string' && search.file ? { file: search.file } : {}),
    ...(Number.isSafeInteger(Number(search.line)) && Number(search.line) > 0
      ? { line: Number(search.line) }
      : {}),
  }),
  component: WorkspacePage,
});

function WorkspacePage() {
  const { workspaceId } = Route.useParams();
  const { note, q, file, line } = Route.useSearch();
  return <Overview workspaceId={workspaceId} noteId={note} query={q} filePath={file} line={line} />;
}
