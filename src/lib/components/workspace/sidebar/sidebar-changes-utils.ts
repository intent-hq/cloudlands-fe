/**
 * Pure utility functions extracted from SidebarChangesPanel.svelte
 * for testability and reuse.
 */

import type { TrackedChange, CommitInfo } from '$features/file-tracking/types';
import type { PullRequestInfo, Workspace } from '$shared/types';
import { PullRequestStatus } from '$shared/types';
import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';
import type {
  AgentChangeGroup,
  PRInfo,
  UIFileChange,
} from '$lib/components/file-tracking/accept-changes/types';
import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';
import { capitalize } from '$shared/utils-client';

/**
 * Validate a git branch name according to git-check-ref-format rules.
 * Returns an error message if invalid, undefined if valid.
 */
export function getBranchNameValidationError(name: string): string | undefined {
  if (!name || name.trim().length === 0) {
    return m.workspace_sidebarHeader_branchEmpty_error();
  }
  if (/[\s~^:\\?*\[\\]/.test(name)) {
    return m.workspace_sidebarHeader_branchInvalidChars_error();
  }
  if (name.includes('@{')) {
    return m.workspace_sidebarChanges_branchAtBrace_error({ seq: '@{' });
  }
  if (name === '@') {
    return m.workspace_sidebarChanges_branchAt_error({ symbol: '@' });
  }
  if (name.startsWith('.')) {
    return m.workspace_sidebarHeader_branchStartsDot_error();
  }
  if (name.endsWith('.lock')) {
    return m.workspace_sidebarHeader_branchEndsLock_error();
  }
  if (name.includes('..')) {
    return m.workspace_sidebarHeader_branchDoubleDot_error();
  }
  if (name.startsWith('/') || name.endsWith('/')) {
    return m.workspace_sidebarHeader_branchSlashEnds_error();
  }
  if (name.includes('//')) {
    return m.workspace_sidebarHeader_branchDoubleSlash_error();
  }
  if (name.startsWith('-')) {
    return m.workspace_sidebarHeader_branchStartsDash_error();
  }
  if (name.endsWith('.')) {
    return m.workspace_sidebarChanges_branchEndsPeriod_error();
  }
  // Per-component validation: each slash-separated component must not start with '.' or end with '.lock'
  const components = name.split('/');
  for (const component of components) {
    if (component.startsWith('.')) {
      return m.workspace_sidebarChanges_branchComponentStartsDot_error();
    }
    if (component.endsWith('.lock')) {
      return m.workspace_sidebarChanges_branchComponentEndsLock_error();
    }
  }
  if (name.length > 250) {
    return m.workspace_sidebarHeader_branchTooLong_error();
  }
  return undefined;
}

/** Construct the correct PR URL from repository info and PR number. */
export function constructPrUrl(
  prNumber: number,
  repoOwner: string | undefined,
  repoName: string | undefined,
  fallbackUrl?: string,
): string {
  if (repoOwner && repoName) {
    return `https://github.com/${repoOwner}/${repoName}/pull/${prNumber}`;
  }
  return fallbackUrl || '';
}

/** Convert PullRequestStatus enum string to PRDisplayStatus. */
export function toPRDisplayStatus(status: string): 'open' | 'merged' | 'closed' | 'draft' {
  if (status === 'Open') return 'open';
  if (status === 'Merged') return 'merged';
  if (status === 'Draft') return 'draft';
  return 'closed';
}

/** Generate a unique key for an agent change group in a section. */
export function getGroupKey(group: AgentChangeGroup, section: 'unstaged' | 'staged'): string {
  return `${section}:${group.agentId ?? 'manual'}`;
}

/** Get the number of unpushed commits from commitIndex to the end of the array. */
export function getCommitsToPushCount(allCommits: CommitInfo[], commitIndex: number): number {
  if (allCommits.length === 0 || commitIndex >= allCommits.length) return 0;
  const clampedIndex = Math.max(0, commitIndex);
  let count = 0;
  for (let i = clampedIndex; i < allCommits.length; i++) {
    if (!allCommits[i].isPushed) {
      count++;
    }
  }
  return count;
}

/** Get the number of pushed commits from index 0 to commitIndex (inclusive). */
export function getCommitsToUndoCount(allCommits: CommitInfo[], commitIndex: number): number {
  if (allCommits.length === 0 || commitIndex < 0) return 0;
  const clampedIndex = Math.min(commitIndex, allCommits.length - 1);
  let count = 0;
  for (let i = 0; i <= clampedIndex; i++) {
    if (allCommits[i].isPushed) {
      count++;
    }
  }
  return count;
}

/** Get the number of unpushed (local) commits from index 0 to commitIndex (inclusive). */
export function getLocalCommitsToUndoCount(
  allCommits: CommitInfo[],
  commitIndex: number,
): number {
  if (allCommits.length === 0 || commitIndex < 0) return 0;
  const clampedIndex = Math.min(commitIndex, allCommits.length - 1);
  let count = 0;
  for (let i = 0; i <= clampedIndex; i++) {
    if (!allCommits[i].isPushed) {
      count++;
    }
  }
  return count;
}

/** Get tooltip text for the push button at a given commit index. */
export function getPushTooltip(
  allCommits: CommitInfo[],
  commitIndex: number,
  hasPR: boolean,
  branchName: string | undefined,
): string {
  const count = getCommitsToPushCount(allCommits, commitIndex);
  const branchSuffix = branchName ? ` (origin/${branchName})` : '';
  if (hasPR) {
    return count === 1
      ? m.workspace_sidebarChanges_addToPr_one({ suffix: branchSuffix })
      : m.workspace_sidebarChanges_addToPr_many({
          count: formatInteger(count),
          suffix: branchSuffix,
        });
  }
  return count === 1
    ? m.workspace_sidebarChanges_pushToRemote_one({ suffix: branchSuffix })
    : m.workspace_sidebarChanges_pushToRemote_many({
        count: formatInteger(count),
        suffix: branchSuffix,
      });
}

/** Get tooltip text for the undo push button at a given commit index. */
export function getUndoTooltip(
  allCommits: CommitInfo[],
  commitIndex: number,
  branchName: string | undefined,
): string {
  const count = getCommitsToUndoCount(allCommits, commitIndex);
  const branchSuffix = branchName ? ` (origin/${branchName})` : '';
  return count === 1
    ? m.workspace_sidebarChanges_undoPush_one({ suffix: branchSuffix })
    : m.workspace_sidebarChanges_undoPush_many({
        count: formatInteger(count),
        suffix: branchSuffix,
      });
}



/** Get tooltip text for the undo commit button (local commits). */
export function getUndoCommitTooltip(allCommits: CommitInfo[], commitIndex: number): string {
  const count = getLocalCommitsToUndoCount(allCommits, commitIndex);
  return count === 1
    ? m.workspace_sidebarChanges_undoCommit_one()
    : m.workspace_sidebarChanges_undoCommit_many({ count: formatInteger(count) });
}

/** Check if a commit at the given index can be amended. Only HEAD (index 0) can. */
export function canAmendCommit(allCommits: CommitInfo[], index: number): boolean {
  return index === 0 && allCommits.length > 0;
}

/** Check if a file should be highlighted as active. */
export function isFileActive(
  filePath: string,
  isStaged: boolean,
  activeFilePath: string | null | undefined,
  activeFileStaged: boolean | null | undefined,
): boolean {
  if (!activeFilePath) return false;
  if (activeFileStaged === null || activeFileStaged === undefined) return false;
  return filePath === activeFilePath && isStaged === activeFileStaged;
}

/** Check if a file is selected in the multi-select set. */
export function isFileSelected(
  path: string,
  staged: boolean,
  selectedFiles: Set<string>,
): boolean {
  const key = `${staged ? 'staged' : 'unstaged'}:${path}`;
  return selectedFiles.has(key);
}

/** Check if a file is focused for keyboard navigation. */
export function isFileFocused(
  path: string,
  staged: boolean,
  focusedFile: { path: string; staged: boolean } | null,
): boolean {
  return focusedFile?.path === path && focusedFile?.staged === staged;
}

/**
 * Aggregate PR files from pushed commits.
 * Deduplicates by path and accumulates additions/deletions across commits.
 * Commits are sorted oldest-first so newer values accumulate properly.
 */
export function aggregatePRFiles(pushedCommits: CommitInfo[]): UIFileChange[] {
  if (pushedCommits.length === 0) return [];

  const fileMap = new Map<string, { additions: number; deletions: number }>();
  const sortedCommits = [...pushedCommits].sort((a, b) => a.timestamp - b.timestamp);

  for (const commit of sortedCommits) {
    for (const file of commit.files ?? []) {
      const existing = fileMap.get(file.path);
      if (existing) {
        fileMap.set(file.path, {
          additions: existing.additions + (file.additions || 0),
          deletions: existing.deletions + (file.deletions || 0),
        });
      } else {
        fileMap.set(file.path, {
          additions: file.additions || 0,
          deletions: file.deletions || 0,
        });
      }
    }
  }

  return Array.from(fileMap.entries()).map(([path, stats]) => ({
    path,
    additions: stats.additions,
    deletions: stats.deletions,
    staged: false,
  }));
}

/**
 * Compute total file-change statistics across unstaged, staged, and committed changes.
 * Returns { totalFilesChanged, totalAdditions, totalDeletions }.
 */
export function computeTotalStats(
  unstagedChanges: TrackedChange[],
  stagedChanges: TrackedChange[],
  allCommits: CommitInfo[],
): { totalFilesChanged: number; totalAdditions: number; totalDeletions: number } {
  const uniquePaths = new Set<string>();
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const change of unstagedChanges) {
    uniquePaths.add(change.relativePath);
    totalAdditions += change.stats?.additions || 0;
    totalDeletions += change.stats?.deletions || 0;
  }
  for (const change of stagedChanges) {
    uniquePaths.add(change.relativePath);
    totalAdditions += change.stats?.additions || 0;
    totalDeletions += change.stats?.deletions || 0;
  }
  for (const commit of allCommits) {
    for (const file of commit.files || []) {
      uniquePaths.add(file.path);
      totalAdditions += file.additions || 0;
      totalDeletions += file.deletions || 0;
    }
  }

  return { totalFilesChanged: uniquePaths.size, totalAdditions, totalDeletions };
}

/** Repo `owner/name` parsed from a canonical GitHub PR URL (the form the
 * daemon synthesizes for merged `pullRequests` entries — see the protocol's
 * workspace.md PR-field ownership section), or undefined for any other URL. */
export function prRepoFromUrl(url: string | undefined): string | undefined {
  const match = url?.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/i);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/**
 * Map workspace pull requests to PRInfo[] for display.
 * Falls back to activePullRequest if workspace.pullRequests is empty.
 *
 * On the list emit paths `workspace.pullRequests` is a daemon-merged pool
 * (stored + git-root + monitor PRs, deduped by URL — intent-hq/intentd#1330),
 * so entries can be cross-repo and each entry's `url` is authoritative for
 * which repo it belongs to: a present `url` is kept as-is and `buildPrUrl`
 * only constructs one for entries lacking a URL. Entries whose URL points at
 * a different repo than `workspaceRepo` are annotated with
 * `crossRepo`/`crossRepoDisplay`, giving downstream merge/section identity
 * matching the correct repo context.
 */
export function mapWorkspacePRs(
  workspacePRs: PullRequestInfo[] | undefined,
  activePR: PullRequestInfo | null | undefined,
  buildPrUrl: (prNumber: number, fallbackUrl?: string) => string,
  getDisplayTitle: (pr: PullRequestInfo) => string,
  workspaceRepo?: string,
): PRInfo[] {
  if (workspacePRs && workspacePRs.length > 0) {
    const workspaceOwner = workspaceRepo?.split('/')[0];
    return workspacePRs.map((pr) => {
      const url = pr.url || buildPrUrl(pr.number);
      const repo = prRepoFromUrl(pr.url);
      const crossRepo =
        repo !== undefined &&
        workspaceRepo !== undefined &&
        repo.toLowerCase() !== workspaceRepo.toLowerCase()
          ? repo
          : undefined;
      return {
        number: pr.number,
        title: getDisplayTitle(pr),
        url,
        htmlUrl: url,
        status: toPRDisplayStatus(pr.status),
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        crossRepo,
        crossRepoDisplay: crossRepo ? shortRepoDisplay(crossRepo, workspaceOwner) : undefined,
      };
    });
  }
  if (activePR) {
    return [{
      number: activePR.number,
      title: getDisplayTitle(activePR),
      url: buildPrUrl(activePR.number, activePR.url),
      htmlUrl: buildPrUrl(activePR.number, activePR.url),
      status: toPRDisplayStatus(activePR.status),
      createdAt: activePR.createdAt,
      updatedAt: activePR.updatedAt,
    }];
  }
  return [];
}

/**
 * The still-supported legacy `Workspace.prNumber`/`prUrl` fields as a
 * `PullRequestInfo`, or null when either is absent. Mirrors the fallback
 * `selectWorkspaceActivePrSummary` applies, so a workspace hydrated with only
 * the legacy fields keeps a route to its PR now that the Changes launcher
 * dropdown is the sidebar's PR surface. Callers pass the result as the
 * `activePR` fallback; `prStatus` is honored when the daemon sent it and the
 * row otherwise reads as open, the only state the legacy link ever recorded.
 */
export function legacyWorkspacePullRequest(
  workspace: Pick<Workspace, 'prNumber' | 'prUrl' | 'prStatus' | 'updatedAt'>,
): PullRequestInfo | null {
  const { prNumber, prUrl } = workspace;
  if (prNumber === undefined || prNumber === null || !prUrl) return null;
  return {
    id: `legacy-pr-${prNumber}`, // i18n-ignore (synthetic identifier)
    number: prNumber,
    url: prUrl,
    title: '',
    status: workspace.prStatus ?? PullRequestStatus.Open,
    createdAt: workspace.updatedAt,
    updatedAt: workspace.updatedAt,
  };
}

/** Display status for a monitored PR row (PROTOCOL §6.9): active monitors
 * read the live snapshot state; completed ones ended merged or closed. */
export function monitorDisplayStatus(
  monitor: PrMonitorRow,
): 'open' | 'merged' | 'closed' | 'draft' {
  const snapshotState = monitor.lastSnapshot?.state?.toLowerCase();
  if (snapshotState === 'merged') return 'merged';
  if (snapshotState === 'closed') return 'closed';
  if (monitor.lastSnapshot?.isDraft) return 'draft';
  // Completed without a snapshot verdict (rare — the terminal sweep persists
  // the final snapshot first): completion covers both merged and closed, so
  // default to the non-celebratory 'closed' rather than falsely claim merged.
  return monitor.state === 'completed' ? 'closed' : 'open';
}

/**
 * Merge agent-monitored PRs (PROTOCOL §6.9) into the workspace PR list.
 * The PR `url` is the primary dedup key (case-insensitive): the daemon's
 * merged `pullRequests` pool is itself deduped by URL
 * (intent-hq/intentd#1330), so a monitor whose PR already reached the list
 * that way only annotates the existing row — opening a workspace never
 * duplicates it. Rows without a comparable URL fall back to the
 * repo-qualified identity match (`crossRepo ? "repo#number" : "number"`,
 * mirroring PRSection's `prKey`); same-repo lookups only match bare
 * (non-`crossRepo`) rows, so a same-repo monitor never annotates a
 * cross-repo row sharing a PR number. Unmatched monitors append as new
 * rows carrying agent attribution (and the `<owner>/<name>` repo context
 * when it differs from the workspace repo).
 */
export function mergeMonitoredPRs(
  basePRs: PRInfo[],
  monitors: PrMonitorRow[],
  workspaceRepo: string | undefined,
): PRInfo[] {
  if (monitors.length === 0) return basePRs;

  const workspaceOwner = workspaceRepo?.split('/')[0];
  const merged = basePRs.map((pr) => ({ ...pr }));
  for (const monitor of monitors) {
    const sameRepo = !workspaceRepo || monitor.repo === workspaceRepo;
    const url = monitor.url ?? `https://github.com/${monitor.repo}/pull/${monitor.prNumber}`;
    const urlLower = url.toLowerCase();
    const existing = merged.find(
      (pr) =>
        pr.url.toLowerCase() === urlLower ||
        (sameRepo
          ? !pr.crossRepo && pr.number === monitor.prNumber
          : pr.crossRepo === monitor.repo && pr.number === monitor.prNumber),
    );
    if (existing) {
      existing.monitorAgentId = monitor.agentId;
      // `lastSnapshot` is absent until a monitor's first successful poll —
      // don't let a snapshotless duplicate monitor clobber a present one.
      existing.monitorSnapshot = monitor.lastSnapshot ?? existing.monitorSnapshot;
      continue;
    }
    merged.push({
      number: monitor.prNumber,
      title: monitor.title ?? `${monitor.repo}#${monitor.prNumber}`,
      url,
      htmlUrl: url,
      status: monitorDisplayStatus(monitor),
      // Monitor-row timestamps stand in for the PR's own (the snapshot does
      // not carry them) so recency ordering (sortPRsByRecency, and the
      // sidebar row's same-status tie-breaker in workspace-pr-presentation)
      // works when multiple monitored PRs compete.
      createdAt: monitor.createdAt,
      updatedAt: monitor.updatedAt,
      monitorAgentId: monitor.agentId,
      crossRepo: sameRepo ? undefined : monitor.repo,
      crossRepoDisplay: sameRepo ? undefined : shortRepoDisplay(monitor.repo, workspaceOwner),
      monitorSnapshot: monitor.lastSnapshot,
      monitorOnly: true,
    });
  }
  return merged;
}

/** Same-org repos carry no information in the owner segment — show only the
 * repo name; the full form is kept when the org differs. GitHub owner names
 * are case-insensitive, so compare lowercased. */
function shortRepoDisplay(repo: string, workspaceOwner: string | undefined): string {
  return workspaceOwner && repo.toLowerCase().startsWith(`${workspaceOwner.toLowerCase()}/`)
    ? repo.slice(workspaceOwner.length + 1)
    : repo;
}

/** PR-bearing subset of a secondary git-root row (monorepo#2053) — structural
 * so both `GitRootRow` and `WorkspaceGitRootEntry` satisfy it. */
export interface GitRootPRSource {
  repoOwner?: string;
  repoName?: string;
  pullRequests?: PullRequestInfo[];
}

/** The Changes tab's three PR sub-sections (monorepo#2053). */
export interface SectionedPRs {
  /** The workspace's own PRs, exactly as {@link mergeMonitoredPRs} produced
   * them before sectioning existed (same-repo monitors only). */
  own: PRInfo[];
  /** PRs attributed to secondary git roots by repo `owner/name` — the
   * "Other PRs" section. */
  otherRoots: PRInfo[];
  /** Monitor entries attributable to no known root — the "Other Tracked
   * PRs" section. */
  otherTracked: PRInfo[];
}

/**
 * Section the Changes tab PR pool (monorepo#2053): the workspace's own PRs
 * first (with monitors on the workspace repo merged in — byte-identical to
 * the pre-sectioning `mergeMonitoredPRs` output when the other sections are
 * empty), then secondary-root PRs, then unattributable monitors. Base rows
 * carrying `crossRepo` context (the daemon-merged `pullRequests` pool can
 * include git-root and monitor PRs from other repos —
 * intent-hq/intentd#1330) are partitioned out of `own` the same way
 * monitors are: into `otherRoots` when a registered root matches their
 * repo, else `otherTracked`. Monitors are attributed by exact repo
 * `owner/name` match — workspace repo first (a monitor on the workspace
 * repo always groups under the primary root, even when a secondary root
 * points at the same repo), then registered roots; when the workspace repo
 * is unknown every monitor stays in `own`, mirroring `mergeMonitoredPRs`.
 * Roots without a detected `owner/name` contribute no rows (the PR sweep
 * cannot discover PRs for them). Root rows duplicating an `own` row's
 * repo-qualified identity (or a cross-repo base row's, or an earlier
 * root's) are dropped; root-attributed monitors annotate their matching
 * root row or append as monitor-only rows, exactly like
 * `mergeMonitoredPRs`.
 */
export function sectionPRs(
  basePRs: PRInfo[],
  monitors: PrMonitorRow[],
  workspaceRepo: string | undefined,
  secondaryRoots: GitRootPRSource[],
  getDisplayTitle: (pr: PullRequestInfo) => string,
): SectionedPRs {
  // GitHub repo identities are case-insensitive (see shortRepoDisplay), so
  // all attribution comparisons here normalize to lowercase.
  const workspaceRepoLower = workspaceRepo?.toLowerCase();
  const rootRepos = new Set<string>();
  for (const root of secondaryRoots) {
    if (root.repoOwner && root.repoName)
      rootRepos.add(`${root.repoOwner}/${root.repoName}`.toLowerCase());
  }

  let ownBase = basePRs;
  const rootBase: PRInfo[] = [];
  const trackedBase: PRInfo[] = [];
  if (basePRs.some((pr) => pr.crossRepo)) {
    ownBase = [];
    for (const pr of basePRs) {
      if (!pr.crossRepo) ownBase.push(pr);
      else if (rootRepos.has(pr.crossRepo.toLowerCase())) rootBase.push(pr);
      else trackedBase.push(pr);
    }
  }

  const primaryMonitors: PrMonitorRow[] = [];
  const rootMonitors: PrMonitorRow[] = [];
  const trackedMonitors: PrMonitorRow[] = [];
  for (const monitor of monitors) {
    const monitorRepoLower = monitor.repo.toLowerCase();
    if (!workspaceRepoLower || monitorRepoLower === workspaceRepoLower)
      primaryMonitors.push(monitor);
    else if (rootRepos.has(monitorRepoLower)) rootMonitors.push(monitor);
    else trackedMonitors.push(monitor);
  }

  const own = mergeMonitoredPRs(ownBase, primaryMonitors, workspaceRepo);

  const workspaceOwner = workspaceRepo?.split('/')[0];
  const seen = new Set(
    [...own, ...rootBase, ...trackedBase].map(
      (pr) => `${(pr.crossRepo ?? workspaceRepo ?? '').toLowerCase()}#${pr.number}`,
    ),
  );
  const rootRows: PRInfo[] = [...rootBase];
  for (const root of secondaryRoots) {
    if (!root.repoOwner || !root.repoName) continue;
    const repo = `${root.repoOwner}/${root.repoName}`;
    for (const pr of root.pullRequests ?? []) {
      const identity = `${repo.toLowerCase()}#${pr.number}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const url = pr.url || `https://github.com/${repo}/pull/${pr.number}`;
      // A root on the workspace repo (e.g. a subtree checkout) needs no repo
      // context; otherwise keep the full identity for row keys, as
      // mergeMonitoredPRs does for cross-repo monitors.
      const sameRepo = workspaceRepoLower !== undefined && repo.toLowerCase() === workspaceRepoLower;
      rootRows.push({
        number: pr.number,
        title: getDisplayTitle(pr),
        url,
        htmlUrl: url,
        status: toPRDisplayStatus(pr.status),
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        crossRepo: sameRepo ? undefined : repo,
        crossRepoDisplay: sameRepo ? undefined : shortRepoDisplay(repo, workspaceOwner),
      });
    }
  }

  return {
    own,
    otherRoots: mergeMonitoredPRs(rootRows, rootMonitors, workspaceRepo),
    otherTracked: mergeMonitoredPRs(trackedBase, trackedMonitors, workspaceRepo),
  };
}

/** The Changes tab's PR sections reordered to follow the git-root dropdown
 * selection (monorepo#2053). */
export interface SelectionOrderedPRSections {
  /** Rows of the dropdown-selected root — the top, undivided section. */
  selected: PRInfo[];
  /** Rows of every non-selected root — the "Other PRs" section. Includes
   * the workspace's own PRs when a secondary root is selected. */
  others: PRInfo[];
  /** Monitor rows attributable to no known root — the "Other Tracked PRs"
   * section; unaffected by selection. */
  otherTracked: PRInfo[];
}

/**
 * Reorder {@link sectionPRs} output to follow the git-root dropdown selection
 * (monorepo#2053). With the primary root selected (`selectedRoot` null) the
 * three sections keep the selection-unaware sectioning, returned as
 * recency-sorted copies (see {@link sortPRsByRecency}). With a secondary root
 * selected, its rows (attributed by repo `owner/name`, resolving rows
 * without `crossRepo` context against the workspace repo) move to the top
 * section while the workspace's own PRs join the remaining roots' rows under
 * "Other PRs". A selected root without a detected `owner/name` owns no rows.
 * Every returned section is sorted newest-updated first. Purely visual:
 * functional consumers keep keying off `SectionedPRs.own`.
 */
export function orderPRSectionsForSelection(
  sectioned: SectionedPRs,
  workspaceRepo: string | undefined,
  selectedRoot: GitRootPRSource | null,
): SelectionOrderedPRSections {
  if (!selectedRoot) {
    return {
      selected: sortPRsByRecency(sectioned.own),
      others: sortPRsByRecency(sectioned.otherRoots),
      otherTracked: sortPRsByRecency(sectioned.otherTracked),
    };
  }
  const selectedRepo =
    selectedRoot.repoOwner && selectedRoot.repoName
      ? `${selectedRoot.repoOwner}/${selectedRoot.repoName}`
      : undefined;
  const selected: PRInfo[] = [];
  const rest: PRInfo[] = [];
  for (const pr of sectioned.otherRoots) {
    if (selectedRepo !== undefined && (pr.crossRepo ?? workspaceRepo) === selectedRepo) {
      selected.push(pr);
    } else {
      rest.push(pr);
    }
  }
  return {
    selected: sortPRsByRecency(selected),
    others: sortPRsByRecency([...sectioned.own, ...rest]),
    otherTracked: sortPRsByRecency(sectioned.otherTracked),
  };
}

/**
 * Display-only recency sort for the Changes tab PR sections: `updatedAt`
 * descending, rows missing `updatedAt` last, PR number descending as
 * tiebreak. Returns a new array; the input is not mutated.
 */
export function sortPRsByRecency(prs: PRInfo[]): PRInfo[] {
  return [...prs].sort(
    (a, b) =>
      compareMissingLast(a.updatedAt, b.updatedAt, (x, y) => y.localeCompare(x)) ||
      b.number - a.number,
  );
}

/** Comparator fragment: rows with a timestamp sort before rows without one;
 * two present timestamps compare via `cmp`. */
function compareMissingLast(
  a: string | undefined,
  b: string | undefined,
  cmp: (x: string, y: string) => number,
): number {
  if (a && b) return cmp(a, b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

/**
 * Hover tooltip for a sidebar PR row: the PR state, plus the monitor's
 * last-snapshot merge-requirements summary (checks, approvals, unresolved
 * threads, merge-blocked reason) when the row carries one (PROTOCOL §6.9).
 */
export function getPRStatusTooltip(pr: PRInfo): string {
  const stateLine =
    pr.status === 'merged'
      ? m.workspace_prSection_merged_label()
      : pr.status === 'closed'
        ? m.workspace_prSection_closed_label()
        : pr.status === 'draft'
          ? m.workspace_prSection_statusDraft_label()
          : m.workspace_prSection_statusOpen_label();
  const lines: string[] = [stateLine];
  // Merged/closed rows no longer have merge requirements — the snapshot
  // detail lines would just be stale noise on a settled PR.
  const snapshot =
    pr.status === 'merged' || pr.status === 'closed' ? undefined : pr.monitorSnapshot;
  if (snapshot) {
    if (snapshot.checks.total > 0) {
      lines.push(
        m.workspace_prSection_statusChecks_tooltip({
          passed: formatInteger(snapshot.checks.passed),
          failed: formatInteger(snapshot.checks.failed),
          pending: formatInteger(snapshot.checks.pending),
        }),
      );
    }
    lines.push(
      snapshot.approvals.needed != null
        ? m.workspace_prSection_statusApprovalsOfNeeded_tooltip({
            count: formatInteger(snapshot.approvals.have),
            needed: formatInteger(snapshot.approvals.needed),
          })
        : m.workspace_prSection_statusApprovals_tooltip({
            count: formatInteger(snapshot.approvals.have),
          }),
    );
    if (snapshot.approvals.changesRequested > 0) {
      lines.push(
        m.workspace_prSection_statusChangesRequested_tooltip({
          count: formatInteger(snapshot.approvals.changesRequested),
        }),
      );
    }
    if (snapshot.threads.unresolved > 0) {
      lines.push(
        m.workspace_prSection_statusUnresolvedThreads_tooltip({
          count: formatInteger(snapshot.threads.unresolved),
        }),
      );
    }
    if (snapshot.mergeBlockedReason) {
      // i18n-ignore (BE-provided human-readable reason)
      lines.push(capitalize(snapshot.mergeBlockedReason));
    }
  }
  return lines.join('\n');
}

/** Inverse of {@link toPRDisplayStatus}: `PullRequestStatus` enum value for
 * a display status — used by the workspace card/row pills. */
export function toPullRequestStatus(
  status: 'open' | 'merged' | 'closed' | 'draft',
): PullRequestStatus {
  if (status === 'merged') return PullRequestStatus.Merged;
  if (status === 'closed') return PullRequestStatus.Closed;
  if (status === 'draft') return PullRequestStatus.Draft;
  return PullRequestStatus.Open;
}

/** `PullRequestStatus` pill value for a monitor-backed PR pill (the
 * WorkspaceCard/WorkspaceTableRow fallback) — the enum projection of
 * {@link monitorDisplayStatus}. */
export function monitorPillStatus(monitor: PrMonitorRow): PullRequestStatus {
  return toPullRequestStatus(monitorDisplayStatus(monitor));
}

/**
 * Count pool PRs beyond the primary PR pill/badge — the "+N" indicator on
 * the workspace card surfaces. Counts the combined deduped pool
 * ({@link mergeMonitoredPRs} over the daemon-merged `pullRequests` plus
 * live monitor rows — intent-hq/intentd#1330) minus the primary, so the
 * count is stable across opening the workspace: a PR present both in the
 * merged list and as a monitor is one row, never two. The primary is
 * matched by URL (case-insensitive) — the pool's canonical identity —
 * falling back to its repo-qualified number.
 */
export function countOtherPrs(pool: PRInfo[], primaryPr: PRInfo | undefined): number {
  if (!primaryPr) return pool.length;
  const primaryUrlLower = primaryPr.url.toLowerCase();
  const primaryCrossRepoLower = primaryPr.crossRepo?.toLowerCase();
  return pool.filter(
    (pr) =>
      !(
        (pr.url && pr.url.toLowerCase() === primaryUrlLower) ||
        (pr.number === primaryPr.number && pr.crossRepo?.toLowerCase() === primaryCrossRepoLower)
      ),
  ).length;
}

/** Check if an agent group is collapsed. */
export function isAgentGroupCollapsed(
  agentId: string | null,
  collapsedAgentGroups: Set<string>,
): boolean {
  return collapsedAgentGroups.has(agentId ?? 'manual');
}

/** Convert a TrackedChange to a UIFileChange for the FileRow component. */
export function toUIFileChange(change: TrackedChange, staged: boolean): UIFileChange {
  return {
    path: change.relativePath,
    additions: change.stats.additions,
    deletions: change.stats.deletions,
    staged,
    status: change.status as 'added' | 'modified' | 'deleted' | 'renamed' | undefined,
    attribution: change.attribution?.agent
      ? {
          agentId: change.attribution.agent.agentId,
          agentName: change.attribution.agent.agentName,
          sessionId: change.attribution.agent.sessionId,
          turnNumber: change.attribution.agent.turnNumber,
          timestamp: change.attribution.timestamp,
        }
      : undefined,
  };
}
