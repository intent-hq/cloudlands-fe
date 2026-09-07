import type { TrackedChange } from '$features/file-tracking/types';
import { isUntrackedStatusCode } from '$features/file-tracking/utils/tracking-excludes';
import type { WorkspaceId } from '$shared/types/branded-ids';
import { openWorkspaceDiff } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import type { LocalFileChange } from './types';

function getChangeCategory(change: LocalFileChange) {
  if (change.category) return change.category;
  return change.staged ? 'staged' : 'unstaged';
}

export function filterDiffMapChanges(changes: LocalFileChange[]): LocalFileChange[] {
  return changes.filter(
    (change) =>
      !isUntrackedStatusCode(change.status) &&
      !(
        getChangeCategory(change) === 'unstaged' &&
        ['create', 'add', 'added'].includes(change.action.toLowerCase())
      ),
  );
}

export function isDiffMapOpenModifier(event: MouseEvent | KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function createDiffMapOpenAction(
  workspaceId: WorkspaceId,
  change: LocalFileChange,
  event?: MouseEvent | KeyboardEvent,
  options: {
    branchBaseRef?: string;
    branchBaseCommitSha?: string;
    gitRootId?: string;
    gitRootPath?: string;
  } = {},
): ReturnType<typeof openWorkspaceDiff> {
  const filePath = change.filePath;
  const target = event?.currentTarget || event?.target;
  const panelElement = target instanceof HTMLElement ? target.closest('[data-panel-id]') : null;
  const category = getChangeCategory(change);
  const diffChange = {
    id: `chat-change-${filePath}`,
    file: filePath,
    relativePath: filePath,
    type: 'modified' as const,
    stage:
      category === 'committed'
        ? ('committed' as const)
        : change.staged
          ? ('staged' as const)
          : ('unstaged' as const),
    stats: { additions: change.additions, deletions: change.deletions },
    attribution: { manual: true, timestamp: Date.now() },
  };
  return openWorkspaceDiff(workspaceId, diffChange as unknown as TrackedChange, {
    changeId: `chat-change-${filePath}`,
    filePath,
    openInAdjacentPanel: Boolean(event && isDiffMapOpenModifier(event)),
    sourcePanelId: panelElement?.getAttribute('data-panel-id') ?? undefined,
    ...options,
  });
}

export function scrollDiffMapHeaderIntoView(
  container: HTMLElement,
  content: HTMLElement,
  expandKey: string,
): void {
  const header = [...content.querySelectorAll<HTMLElement>('[data-change-header-key]')].find(
    (candidate) => candidate.dataset.changeHeaderKey === expandKey,
  );
  if (!header) return;

  const containerRect = container.getBoundingClientRect();
  const headerRect = header.getBoundingClientRect();
  const stickyTop = Number.parseFloat(header.dataset.changeStickyTop ?? '0') || 0;
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const nextScrollTop = container.scrollTop + headerRect.top - containerRect.top - stickyTop;

  container.scrollTo({
    top: Math.min(maxScrollTop, Math.max(0, nextScrollTop)),
    behavior: 'auto',
  });
}

export function activeDiffMapPathForScroll(
  container: HTMLElement,
  content: HTMLElement,
): string | undefined {
  const headers = [...content.querySelectorAll<HTMLElement>('[data-change-map-path]')];
  if (headers.length === 0) return undefined;
  const activationTop = container.getBoundingClientRect().top + 32;
  let activeHeader = headers[0];
  let closestPastTop = Number.NEGATIVE_INFINITY;
  let closestFutureTop = Number.POSITIVE_INFINITY;

  for (const header of headers) {
    const card = header.closest<HTMLElement>('[data-change-card-key]');
    const top = (card ?? header).getBoundingClientRect().top;
    if (top <= activationTop && top > closestPastTop) {
      closestPastTop = top;
      activeHeader = header;
    } else if (closestPastTop === Number.NEGATIVE_INFINITY && top < closestFutureTop) {
      closestFutureTop = top;
      activeHeader = header;
    }
  }

  return activeHeader.dataset.changeMapPath;
}
