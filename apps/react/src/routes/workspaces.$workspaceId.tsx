import { isCommitHash, parseHistoryOrigin } from '@/features/workspace/workspace-history-target';
import { parseGitDiffOrigin } from '@/features/workspace/workspace-diff-target';
import { parseConversationFileOrigin } from '@/features/workspace/workspace-file-origin';
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
    diff?: string;
    diffStage?: 'staged' | 'unstaged';
    diffOrigin?: string;
    commitDiff?: string;
    historyCommit?: string;
    historyOrigin?: string;
    file?: string;
    fileOrigin?: string;
    attachment?: string;
    attachmentAgent?: string;
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
      ...(typeof search.diff === 'string' &&
      search.diff &&
      (search.diffStage === 'staged' ||
        search.diffStage === 'unstaged' ||
        isCommitHash(search.commitDiff))
        ? {
            diff: search.diff,
            ...(isCommitHash(search.commitDiff)
              ? { commitDiff: search.commitDiff }
              : { diffStage: search.diffStage as 'staged' | 'unstaged' }),
          }
        : {}),
      ...(isCommitHash(search.historyCommit) ? { historyCommit: search.historyCommit } : {}),
      ...(parseHistoryOrigin(search.historyOrigin)
        ? { historyOrigin: search.historyOrigin as string }
        : {}),
      ...(parseGitDiffOrigin(search.diffOrigin) ? { diffOrigin: search.diffOrigin as string } : {}),
      ...(typeof search.file === 'string' &&
      search.file &&
      typeof search.fileOrigin === 'string' &&
      parseConversationFileOrigin(search.fileOrigin)
        ? { fileOrigin: search.fileOrigin }
        : {}),
      ...(typeof search.file === 'string' && search.file ? { file: search.file } : {}),
      ...(typeof search.attachment === 'string' && search.attachment
        ? { attachment: search.attachment }
        : {}),
      ...(typeof search.attachmentAgent === 'string' && search.attachmentAgent
        ? { attachmentAgent: search.attachmentAgent }
        : {}),
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
  const {
    agent,
    message,
    note,
    q,
    file,
    diff,
    diffStage,
    diffOrigin,
    commitDiff,
    historyCommit,
    historyOrigin,
    fileOrigin,
    line,
    fileQuery,
    homeQuery,
    homeFilter,
    attachment,
    attachmentAgent,
  } = Route.useSearch();
  return (
    <Overview
      workspaceId={workspaceId}
      agentId={agent}
      messageId={message}
      noteId={note}
      query={q}
      diffPath={diff}
      diffStaged={diffStage === 'staged'}
      diffOrigin={diffOrigin}
      commitDiff={commitDiff}
      historyCommit={historyCommit}
      historyOrigin={historyOrigin}
      filePath={file}
      fileOrigin={parseConversationFileOrigin(fileOrigin)}
      attachmentId={attachment}
      attachmentAgentId={attachmentAgent}
      line={line}
      fileQuery={fileQuery}
      homeQuery={homeQuery}
      homeFilter={homeFilter}
    />
  );
}
