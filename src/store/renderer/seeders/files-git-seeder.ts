/**
 * Files, git, changes & PR mock seeder.
 *
 * Pulls the workspace file tree, per-file git status, working-tree git status,
 * diffs, tracked changes, commit history, and pull-request summary from the
 * `AppClient` seam and dispatches existing slice actions so the file explorer,
 * git/diff panel, changes panel, and PR status render with mock data —
 * replacing the work the file/git/changes/PR sagas used to do against the
 * real backend.
 */
import type { FileNode } from "$shared/types";
import { registerMockSeeder } from "../mock-bootstrap";
import {
  addExpandedPath,
  setFileExplorerFileCount,
  setFileExplorerInitialized,
  setFileExplorerWorkspacePath,
  setGitStatusMap,
  setRootNode,
} from "../slices/file-explorer/file-explorer-slice";
import { setGitDiffs, setGitStatus } from "../slices/git/git-slice";
import {
  setChangesData,
  setCommitsData,
  setHasLoadedInitialData,
} from "../slices/changes/changes-slice";
import { prStatusRefreshCompleted } from "../slices/pr-status/pr-status-slice";
import { prBranchLookupSucceeded } from "../slices/pr-branch-lookup/pr-branch-lookup-slice";
import type { PrBranchLookupPayload } from "../slices/pr-branch-lookup/pr-branch-lookup-types";

/** Collect every directory node path so the seeded tree renders fully expanded. */
function collectDirectoryPaths(node: FileNode, result: string[] = []): string[] {
  if (node.type !== "directory") return result;
  result.push(node.path);
  for (const child of node.children ?? []) {
    collectDirectoryPaths(child, result);
  }
  return result;
}

registerMockSeeder("files-git", async ({ store, client }) => {
  const workspaces = await client.workspaces.list();

  for (const workspace of workspaces) {
    const wsId = String(workspace.id);

    // ── File explorer ──
    const tree = await client.files.explorerTree(wsId);
    if (tree) {
      store.dispatch(setFileExplorerWorkspacePath(wsId, tree.path));
      store.dispatch(setRootNode(wsId, tree));

      const gitStatusMap = await client.files.gitStatusMap(wsId);
      store.dispatch(setGitStatusMap(wsId, gitStatusMap));

      // Expand every directory so the full tree is visible on first paint.
      for (const dirPath of collectDirectoryPaths(tree)) {
        store.dispatch(addExpandedPath(wsId, dirPath));
      }

      const fileCount = countFiles(tree);
      store.dispatch(setFileExplorerFileCount(wsId, fileCount));
      store.dispatch(setFileExplorerInitialized(wsId, true));
    }

    // ── Git status & diffs ──
    const status = await client.git.status(wsId);
    if (status) {
      store.dispatch(setGitStatus(wsId, status));
    }
    const diffs = await client.git.diffs(wsId);
    if (diffs.length > 0) {
      store.dispatch(setGitDiffs(wsId, diffs));
    }

    // ── Changes (tracked changes + commit history) ──
    const changes = await client.git.trackedChanges(wsId);
    const commits = await client.git.commits(wsId);
    if (changes.length > 0 || commits.length > 0) {
      store.dispatch(setChangesData(wsId, changes, false, changes.length));
      const boundarySha = commits.length > 0 ? commits[commits.length - 1].hash : null;
      store.dispatch(setCommitsData(wsId, commits, boundarySha));
      store.dispatch(setHasLoadedInitialData(wsId, true));
    }

    // ── Pull request ──
    const prStatus = await client.git.prStatus(wsId);
    if (prStatus?.prNumber != null) {
      store.dispatch(prStatusRefreshCompleted(wsId, true));

      const owner = workspace.repositoryOwner;
      const repo = workspace.repositoryName;
      if (owner && repo) {
        const payload: PrBranchLookupPayload = {
          owner,
          repo,
          prNumber: prStatus.prNumber,
          key: `${owner}/${repo}#${prStatus.prNumber}`,
        };
        store.dispatch(prBranchLookupSucceeded(payload, workspace.branch));
      }
    }
  }
});

/** Count file (non-directory) nodes in a file tree. */
function countFiles(node: FileNode): number {
  if (node.type === "file") return 1;
  let count = 0;
  for (const child of node.children ?? []) {
    count += countFiles(child);
  }
  return count;
}
