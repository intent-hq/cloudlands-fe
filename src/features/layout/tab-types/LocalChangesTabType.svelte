<script lang="ts">
  /**
   * Local Changes Tab Type Component
   *
   * Shows all local changes including staged, unstaged, and committed changes.
   * Includes staging controls and header actions.
   */

  import type { TabTypeComponentProps } from './registry';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import {
    selectFileTrackingBoundarySha,
    selectFileTrackingChanges,
    selectFileTrackingCommits,
    selectFileTrackingLoading,
  } from '$store/renderer/slices/changes/changes-selectors';
  import {
    discardFiles as discardFilesViaSeam,
    stageFiles as stageFilesViaSeam,
    unstageFiles as unstageFilesViaSeam,
  } from '$features/git/git-write-service';
  import { toast } from '$lib/components/ui/toast';

  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import ChatChangesPanel from '$lib/components/chat/ChatChangesPanel.svelte';
  import ViewSettingsDropdown from '../components/ViewSettingsDropdown.svelte';
  import {
    selectLineWrapping,
    selectFoldUnchanged,
    selectDiffSideBySide,
  } from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import {
    toggleLineWrapping,
    toggleFoldUnchanged,
    toggleDiffSideBySide,
  } from '$store/renderer/slices/ui-layout/ui-layout-slice';

  import { m } from '$shared/paraglide/messages.js';
  import { isAbsolutePath, normalizePath } from '$lib/utils/path-utils';
  import { store as appStore } from '$store/renderer/store';
  import {
    emptySecondaryRootState,
    selectSecondaryRootGitRoots,
  } from '$store/renderer/slices/git/git-selectors';
  import { loadSecondaryRootGit } from '$store/renderer/slices/git/git-slice';
  import { selectGitRoots } from '$store/renderer/slices/git-roots/git-roots-selectors';

  const lineWrapping = selectLineWrapping();
  const foldUnchanged = selectFoldUnchanged();
  const diffSideBySide = selectDiffSideBySide();
  let { tab, workspaceId, isActive }: TabTypeComponentProps = $props();

  const headerContext = getPanelHeaderContext();
  // svelte-ignore state_referenced_locally
  const workspace = selectWorkspaceById(workspaceId);
  const gitRootId = $derived((tab.data?.gitRootId as string) || '');
  // svelte-ignore state_referenced_locally
  const gitRoots$ = selectGitRoots(workspaceId);
  const selectedRoot = $derived($gitRoots$.find((root) => root.id === gitRootId));
  const workspacePath = $derived($workspace?.worktreePath || $workspace?.repositoryPath || '');
  const effectiveRootPath = $derived(selectedRoot?.path || workspacePath);
  // svelte-ignore state_referenced_locally
  const ftChanges$ = selectFileTrackingChanges(workspaceId);
  // svelte-ignore state_referenced_locally
  const ftCommits$ = selectFileTrackingCommits(workspaceId);
  // svelte-ignore state_referenced_locally
  const ftBoundarySha$ = selectFileTrackingBoundarySha(workspaceId);
  // svelte-ignore state_referenced_locally
  const ftLoading$ = selectFileTrackingLoading(workspaceId);
  const allCommits = $derived($ftCommits$ || []);
  // svelte-ignore state_referenced_locally
  const rootGitRoots$ = selectSecondaryRootGitRoots(workspaceId);
  const rootGit = $derived($rootGitRoots$[gitRootId] ?? emptySecondaryRootState);
  const rootStatus = $derived(rootGit.status);
  const rootLoading = $derived(rootGit.loading);
  const rootCommitFiles = $derived(rootGit.commitFiles);
  const rootCommits = $derived.by(() => {
    const boundary = selectedRoot?.registeredCommitSha;
    const index = boundary ? rootGit.commits.findIndex((commit) => commit.hash === boundary) : -1;
    return index >= 0 ? rootGit.commits.slice(0, index) : rootGit.commits;
  });

  $effect(() => {
    const wsId = workspaceId;
    const rootId = gitRootId;
    if (wsId && rootId) {
      appStore.dispatch(loadSecondaryRootGit(wsId, rootId, selectedRoot?.registeredCommitSha, 100));
    }
  });

  // State for expand/collapse and panel ref
  let changesAllExpanded = $state(true);
  let changesPanelRef = $state<{ expandAll: () => void; collapseAll: () => void } | null>(null);

  // Build the changes array with all local changes
  const localChangesForPanel = $derived.by(() => {
    if (gitRootId) {
      return [
        ...(rootStatus?.files ?? []).map((file) => ({
          filePath: `${effectiveRootPath}/${file.path}`,
          action: 'modify' as const,
          additions: (file as typeof file & { additions?: number }).additions ?? 0,
          deletions: (file as typeof file & { deletions?: number }).deletions ?? 0,
          toolName: 'local',
          toolCallId: `root-${gitRootId}-${file.staged}-${file.path}`,
          staged: file.staged,
          category: file.staged ? ('staged' as const) : ('unstaged' as const),
        })),
        ...rootCommits.flatMap((commit) =>
          (rootCommitFiles[commit.hash] ?? []).map((file) => ({
            filePath: `${effectiveRootPath}/${file.path}`,
            action: 'modify' as const,
            additions: file.additions ?? 0,
            deletions: file.deletions ?? 0,
            toolName: 'local',
            toolCallId: `root-commit-${commit.hash}-${file.path}`,
            staged: false,
            category: 'committed' as const,
            commitHash: commit.hash,
            commitMessage: commit.message,
          })),
        ),
      ];
    }
    const unstaged = $ftChanges$.filter((c) => c.stage === 'unstaged');
    const staged = $ftChanges$.filter((c) => c.stage === 'staged');
    return [
      ...unstaged.map((c) => {
        const rawPath = c.file || c.relativePath;
        const filePath =
          rawPath && isAbsolutePath(rawPath) ? rawPath : `${workspacePath}/${rawPath}`;
        return {
          filePath,
          action: 'modify' as const,
          additions: c.stats?.additions || 0,
          deletions: c.stats?.deletions || 0,
          toolName: 'local',
          toolCallId: `local-unstaged-${filePath}`,
          staged: false,
          category: 'unstaged' as const,
          oldContent: c.content?.oldContent,
          newContent: c.content?.newContent,
          gitlink: c.gitlink,
        };
      }),
      ...staged.map((c) => {
        const rawPath = c.file || c.relativePath;
        const filePath =
          rawPath && isAbsolutePath(rawPath) ? rawPath : `${workspacePath}/${rawPath}`;
        return {
          filePath,
          action: 'modify' as const,
          additions: c.stats?.additions || 0,
          deletions: c.stats?.deletions || 0,
          toolName: 'local',
          toolCallId: `local-staged-${filePath}`,
          staged: true,
          category: 'staged' as const,
          oldContent: c.content?.oldContent,
          newContent: c.content?.newContent,
          gitlink: c.gitlink,
        };
      }),
      ...allCommits.flatMap((commit) =>
        (commit.files || []).map(
          (file: { path?: string; additions?: number; deletions?: number } | string) => {
            const filePath = typeof file === 'string' ? file : file.path || '';
            const normalizedPath =
              filePath && isAbsolutePath(filePath) ? filePath : `${workspacePath}/${filePath}`;
            const additions = typeof file === 'string' ? 0 : file.additions || 0;
            const deletions = typeof file === 'string' ? 0 : file.deletions || 0;
            return {
              filePath: normalizedPath,
              action: 'modify' as const,
              additions,
              deletions,
              toolName: 'local',
              toolCallId: `commit-${commit.hash}-${filePath}`,
              staged: false,
              category: 'committed' as const,
              commitHash: commit.hash,
              commitMessage: commit.message,
            };
          },
        ),
      ),
    ];
  });

  // The panel rows carry absolutized paths (workspacePath-prefixed above);
  // the git.* wire contract takes repo-relative paths, so strip the prefix
  // before handing them to the write-service seam. Separators are normalized
  // on both sides first so backslash-form Windows absolutes (C:\repo\src\a.ts)
  // relativize against a forward-slash workspace root too.
  function toRepoRelative(path: string): string {
    if (!workspacePath) return path;
    const normalized = normalizePath(path);
    const root = normalizePath(workspacePath);
    return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : path;
  }

  // Stage/unstage/revert route through the git-write-service seam
  // (git.stage / git.unstage / git.discard): await + toast.error on failure.
  // The seam is the sanctioned post-saga git-mutation mechanism (it dispatches
  // the optimistic update + reconciles the store itself), so the
  // component-async-data-fetch heuristic — which flags any `*-service` import —
  // is disabled for these mutation calls.
  async function stageViaSeam(paths: string[]) {
    // eslint-disable-next-line intent/no-component-async-data-fetch
    const result = await stageFilesViaSeam(workspaceId, paths.map(toRepoRelative));
    if (!result.success) {
      toast.error(m.workspace_fileChanges_stageFailed_error(), {
        description: result.error || m.ui_workspaceActions_unknown_error(),
      });
    }
  }

  async function unstageViaSeam(paths: string[]) {
    // eslint-disable-next-line intent/no-component-async-data-fetch
    const result = await unstageFilesViaSeam(workspaceId, paths.map(toRepoRelative));
    if (!result.success) {
      toast.error(m.workspace_fileChanges_unstageFailed_error(), {
        description: result.error || m.ui_workspaceActions_unknown_error(),
      });
    }
  }

  async function revertViaSeam(paths: string[]) {
    // eslint-disable-next-line intent/no-component-async-data-fetch
    const result = await discardFilesViaSeam(workspaceId, paths.map(toRepoRelative));
    if (!result.success) {
      toast.error(m.workspace_fileChanges_revertFailed_error(), {
        description: result.error || m.ui_workspaceActions_unknown_error(),
      });
    }
  }

  // Register header actions
  $effect(() => {
    if (!headerContext || !isActive) return;
    headerContext.registerActions({ display: changesDisplayActions });
  });
</script>

{#snippet changesDisplayActions()}
  <ViewSettingsDropdown
    embedded
    showExpand
    expanded={changesAllExpanded}
    onToggleExpand={() => {
      changesAllExpanded = !changesAllExpanded;
      if (changesAllExpanded) changesPanelRef?.expandAll();
      else changesPanelRef?.collapseAll();
    }}
    foldEnabled={$foldUnchanged}
    onToggleFold={() => appStore.dispatch(toggleFoldUnchanged())}
    wrapEnabled={$lineWrapping}
    onToggleWrap={() => appStore.dispatch(toggleLineWrapping())}
    splitEnabled={$diffSideBySide}
    onToggleSplit={() => appStore.dispatch(toggleDiffSideBySide())}
  />
{/snippet}

<ChatChangesPanel
  bind:this={changesPanelRef}
  isLoading={gitRootId ? rootLoading : $ftLoading$}
  changes={localChangesForPanel}
  gitRootId={gitRootId || undefined}
  gitRootPath={gitRootId ? effectiveRootPath : undefined}
  branchBaseRef={$workspace?.baseRef ?? null}
  branchBaseCommitSha={gitRootId
    ? selectedRoot?.registeredCommitSha || null
    : $ftBoundarySha$ || $workspace?.baseCommitSha || null}
  showStagingControls={!gitRootId}
  showCategoryFilter={true}
  onStage={gitRootId ? undefined : (path) => void stageViaSeam([path])}
  onUnstage={gitRootId ? undefined : (path) => void unstageViaSeam([path])}
  onRevert={gitRootId ? undefined : (path) => void revertViaSeam([path])}
  onStageAll={gitRootId
    ? undefined
    : () => {
        const unstaged = $ftChanges$.filter((c) => c.stage === 'unstaged');
        void stageViaSeam(unstaged.map((c) => c.relativePath || c.file));
      }}
  onUnstageAll={gitRootId
    ? undefined
    : () => {
        const staged = $ftChanges$.filter((c) => c.stage === 'staged');
        void unstageViaSeam(staged.map((c) => c.relativePath || c.file));
      }}
/>
