import { invoke } from '$lib/electron-bridge';
import type {
  FileNode,
  FileGitStatus, EnvironmentConfig,
} from '$shared/types';
import { GitFileStatus } from '$shared/types';
import { Logger } from '$shared/logger';
import {
  WorkspaceId as WorkspaceIdFn, isValidWorkspaceId,
} from '$shared/types/branded-ids';
import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
import { gitStore } from '$features/git/git.store.svelte';
import { lineChangesStore } from '$features/line-changes/line-changes.store.svelte';
import { getAgentFileEdits, propagateAgentEditsToParents } from '$lib/utils/agent-file-edits';
import { stripWorkspacePrefix } from '$lib/utils/file-utils';
import ignore from 'ignore';

const logger = new Logger('FileExplorerStore');

// Flattened node for virtualized rendering
export interface FlattenedFileNode {
  node: FileNode;
  depth: number;
  // Compacted path prefix (for directories with single-child chains like "src/lib/components")
  displayPath?: string;
  // UI state computed from path-keyed Sets during flattening
  isExpanded: boolean;
  isLoading: boolean;
}

export interface FileExplorerStoreOptions {
  initialPath: string;
  workspaceId?: string;
  environmentConfig?: EnvironmentConfig;
}

export function createFileExplorerStore(
  initialPathOrOptions: string | FileExplorerStoreOptions,
  workspaceId?: string,
) {
  // Support both old signature (string, string?) and new signature (options object)
  const options: FileExplorerStoreOptions =
    typeof initialPathOrOptions === 'string'
      ? { initialPath: initialPathOrOptions, workspaceId }
      : initialPathOrOptions;

  let workspacePath = $state(options.initialPath);
  // Use $state.raw to prevent deep reactivity on the tree structure.
  // Deep reactivity causes hundreds of reactive updates when preloading
  // child directories (each `dirNode.children = ...` triggers a re-render).
  // Instead, we use `treeVersion` to explicitly signal when the UI should update.
  let rootNode: FileNode | null = $state.raw(null);
  let isLoading = $state(false);
  let isInitialized = $state(false);
  let error: string | null = $state(null);
  let fileCount = $state(0);
  let gitignorePatterns: string[] = $state([]);
  let gitStatus = $state<Map<string, FileGitStatus>>(new Map());
  let gitStatusRefreshTimer: NodeJS.Timeout | null = null;
  let currentWorkspaceId = $state(options.workspaceId || '');
  let environmentConfig = $state<EnvironmentConfig | undefined>(options.environmentConfig);
  let remoteConnectionId = $state<string | null>(null);
  let isRemoteInitialized = $state(false);
  let agentFileEdits = $state<Map<string, string[]>>(new Map());

  // Track whether this store is the currently active one
  // Used to abort async operations when user switches to a different workspace
  let isStoreActive = true;

  // Version counter to force reactivity on deep tree mutations
  // Increment this whenever the tree structure changes (expand/collapse, add/remove nodes)
  let treeVersion = $state(0);

  // Path-keyed UI state (decoupled from FileNode objects so tree replacement doesn't lose state)
  // Not reactive — use treeVersion to signal changes, same pattern as rootNode
  let expandedPaths = new Set<string>();
  let loadingPaths = new Set<string>();

  // Bulk operation state - used to signal UI to skip transitions
  let isBulkOperation = $state(false);

  // Configuration for batched expansion
  const EXPAND_BATCH_SIZE = 10; // Number of directories to expand per batch
  const EXPAND_YIELD_MS = 16; // ~60fps yield interval

  // Helper to yield to the UI thread
  function yieldToUI(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => resolve(), { timeout: EXPAND_YIELD_MS });
      } else {
        setTimeout(resolve, EXPAND_YIELD_MS);
      }
    });
  }

  // Check if this is a remote workspace
  function isRemote(): boolean {
    return environmentConfig?.type === 'remote';
  }

  // Initialize remote file system connection
  async function initializeRemoteFS(): Promise<boolean> {
    if (!isRemote() || isRemoteInitialized) {
      return isRemoteInitialized;
    }

    remoteConnectionId = currentWorkspaceId;

    try {
      logger.debug('Initializing remote file system connection', {
        workspaceId: currentWorkspaceId,
        basePath: workspacePath,
      });

      const response = await invoke<{ success: boolean; error?: string }>('remote-fs:initialize', {
        workspaceId: currentWorkspaceId,
        basePath: workspacePath,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to initialize remote file system');
      }

      isRemoteInitialized = true;
      logger.debug('Remote file system initialized successfully');
      return true;
    } catch (err) {
      logger.error('Failed to initialize remote file system:', err);
      error = `Failed to connect to remote: ${err instanceof Error ? err.message : String(err)}`;
      return false;
    }
  }

  // Disconnect remote file system
  async function disconnectRemoteFS(): Promise<void> {
    if (!remoteConnectionId) return;

    try {
      await invoke('remote-fs:disconnect', { workspaceId: remoteConnectionId });
      isRemoteInitialized = false;
      remoteConnectionId = null;
    } catch (err) {
      logger.warn('Failed to disconnect remote file system:', err);
    }
  }

  // Cache for directory contents
  const directoryCache = new Map<string, { nodes: FileNode[]; timestamp: number }>();
  const CACHE_TTL = 30000; // 30 seconds

  // Load gitignore patterns
  async function loadGitignorePatterns() {
    if (!workspacePath) {
      gitignorePatterns = [];
      return;
    }

    try {
      const response = (await invoke('file:getGitignorePatterns', { workspacePath })) as {
        success: boolean;
        data?: string[];
      };
      // Handle CommandResponse format
      let patterns: string[] = [];
      if (response && response.success && Array.isArray(response.data)) {
        patterns = response.data;
      }
      gitignorePatterns = patterns;
    } catch (error) {
      logger.error('Failed to load gitignore patterns:', error);
      gitignorePatterns = [];
    }
  }

  // Load Git status for all files
  async function loadGitStatus() {
    if (!workspacePath) {
      gitStatus = new Map();
      return;
    }

    try {
      // Use the same data sources as CodeChangesPanel for consistency
      // Guard against invalid workspace IDs (e.g., "new" from /workspace/new route)
      if (currentWorkspaceId && isValidWorkspaceId(currentWorkspaceId)) {
        try {
          // Wait for the store to be ready if it's already initializing for our workspace.
          // Don't call setWorkspace() here - the workspace page is the authority for that.
          // Calling setWorkspace() with a potentially stale ID can hijack the singleton store
          // and cause other components (e.g., SidebarChangesPanel) to get stuck on loading.
          if (fileTrackingStore.currentWorkspaceId !== currentWorkspaceId) {
            // Store is on a different workspace - skip git status loading,
            // we'll get it on the next refresh after the store switches
            logger.debug('[Git Status] Store on different workspace, skipping', {
              storeWorkspaceId: fileTrackingStore.currentWorkspaceId,
              currentWorkspaceId,
            });
            return;
          }

          // Load fresh git status
          await gitStore.loadStatus(WorkspaceIdFn(currentWorkspaceId), true);

          // Build git status map from file tracking store (which has line stats)
          const newGitStatus = new Map<string, FileGitStatus>();

          // Get changes from file tracking store
          const workingChanges = fileTrackingStore.workingChanges;
          const allChanges = [...workingChanges.unstaged, ...workingChanges.staged];

          logger.debug('[Git Status] Processing file tracking changes', {
            unstagedCount: workingChanges.unstaged.length,
            stagedCount: workingChanges.staged.length,
            totalChanges: allChanges.length,
          });

          for (const change of allChanges) {
            const stats = change.stats || { additions: 0, deletions: 0 };
            // Use default status code for tracked changes
            // The actual status will be determined from gitStore.status.files
            const statusCode = change.stage === 'staged' ? 'M ' : ' M';

            newGitStatus.set(change.file, {
              status: statusCode,
              additions: stats.additions,
              deletions: stats.deletions,
            });
          }

          // Also check git status for any files not in file tracking
          if (gitStore.status?.files) {
            logger.debug('[Git Status] Checking git store files', {
              gitFileCount: gitStore.status.files.length,
            });

            // Get diff for files not in tracking
            const filesToDiff = gitStore.status.files
              .filter((f) => f.path && !newGitStatus.has(f.path))
              .map((f) => f.path);

            if (filesToDiff.length > 0) {
              // Load diffs from git store
              await gitStore.loadDiffs(WorkspaceIdFn(currentWorkspaceId));

              if (gitStore.diffs) {
                for (const chunk of gitStore.diffs) {
                  if (filesToDiff.includes(chunk.file)) {
                    let additions = 0;
                    let deletions = 0;
                    for (const hunk of chunk.chunks) {
                      for (const line of hunk.lines) {
                        if (line.type === 'Addition') additions++;
                        else if (line.type === 'Deletion') deletions++;
                      }
                    }
                    const file = gitStore.status.files.find((f) => f.path === chunk.file);
                    if (file) {
                      // Determine proper status code based on file status
                      let statusCode = ' M'; // Default to modified
                      if (file.status === GitFileStatus.Added) {
                        statusCode = file.staged ? 'A ' : ' A';
                      } else if (file.status === GitFileStatus.Deleted) {
                        statusCode = file.staged ? 'D ' : ' D';
                      } else if (file.status === GitFileStatus.Modified) {
                        statusCode = file.staged ? 'M ' : ' M';
                      } else if (file.status === GitFileStatus.Untracked) {
                        statusCode = '??';
                      }

                      newGitStatus.set(chunk.file, {
                        status: statusCode,
                        additions,
                        deletions,
                      });
                    }
                  }
                }
              }
            }
          }

          gitStatus = newGitStatus;

          // Log summary instead of detailed entries
          const statusSummary = {
            total: gitStatus.size,
            modified: 0,
            added: 0,
            deleted: 0,
            untracked: 0,
          };

          for (const [, status] of gitStatus.entries()) {
            if (status.status.includes('M')) statusSummary.modified++;
            else if (status.status.includes('A')) statusSummary.added++;
            else if (status.status.includes('D')) statusSummary.deleted++;
            else if (status.status === '??') statusSummary.untracked++;
          }

          if (gitStatus.size > 0) {
            logger.debug('[Git Status] Loaded git status from stores:', {
              workspaceId: currentWorkspaceId,
              ...statusSummary,
            });
          }
          return;
        } catch (wsError) {
          logger.debug(
            'Failed to get git status from stores, falling back to file:getGitStatus',
            wsError,
          );
        }
      }

      // Fallback to the original file:getGitStatus method
      const response = (await invoke('file:getGitStatus', { workspacePath })) as {
        success: boolean;
        data?: {
          fileStatuses: Record<string, string>;
          fileChanges: Record<string, any>;
        };
      };
      if (response && response.success && response.data) {
        const result = response.data;
        const newGitStatus = new Map<string, FileGitStatus>();

        logger.debug('Git status response:', {
          workspacePath,
          fileStatusCount: Object.keys(result.fileStatuses).length,
          fileChangesCount: Object.keys(result.fileChanges || {}).length,
          sampleFiles: Object.keys(result.fileStatuses).slice(0, 3),
        });

        for (const [filePath, status] of Object.entries(result.fileStatuses)) {
          const changes = result.fileChanges?.[filePath];
          newGitStatus.set(filePath, {
            status: status as string,
            additions: changes?.additions || 0,
            deletions: changes?.deletions || 0,
          });
        }

        // Also incorporate workspace changes from the line changes store
        // Use the workspace ID if provided, otherwise try to extract from path
        const effectiveWorkspaceId = currentWorkspaceId || extractWorkspaceId(workspacePath);

        // Get file changes using the public method
        const fileChanges = lineChangesStore.getFileChanges(WorkspaceIdFn(effectiveWorkspaceId));

        logger.debug('Line changes from store:', {
          workspaceId: effectiveWorkspaceId,
          fileChangesCount: fileChanges?.length || 0,
          sampleChanges: fileChanges
            ?.slice(0, 3)
            .map((c) => ({ path: c.path, additions: c.additions, deletions: c.deletions })),
        });

        if (fileChanges && fileChanges.length > 0) {
          for (const change of fileChanges) {
            const existing = newGitStatus.get(change.path);
            if (existing) {
              // Merge with existing git status
              existing.additions = Math.max(existing.additions || 0, change.additions || 0);
              existing.deletions = Math.max(existing.deletions || 0, change.deletions || 0);
            } else {
              // Add new entry for files not in git status (e.g., new untracked files)
              newGitStatus.set(change.path, {
                status: change.action === 'create' ? '??' : 'M ',
                additions: change.additions,
                deletions: change.deletions,
              });
            }
          }
        }

        gitStatus = newGitStatus;
        logger.debug('Final git status map:', {
          totalEntries: gitStatus.size,
          sampleEntries: Array.from(gitStatus.entries()).slice(0, 3),
        });
      }
    } catch (error) {
      logger.error('Failed to load git status:', error);
    }
  }

  // Helper function to extract workspace ID from path
  function extractWorkspaceId(path: string): string {
    // Try to extract workspace ID from path like /Users/.../00297fc2-3d7d-45ee-b892-27a90510eb12/...
    const match = path.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
    if (match) {
      return match[1];
    }
    // Fallback to folder name
    return path.split('/').pop() || '';
  }

  // Start auto-refreshing Git status
  function startGitStatusRefresh() {
    // DISABLED: No longer polling git status on interval
    // Git status is now updated via workspace-changes events
    // which are triggered by the change detector when actual changes occur
    // This prevents unnecessary load from polling every 5 seconds
    return;

    // Original code kept for reference:
    // if (gitStatusRefreshTimer) {
    //   clearInterval(gitStatusRefreshTimer);
    // }
    // gitStatusRefreshTimer = setInterval(() => {
    //   loadGitStatus();
    // }, 5000);
  }

  // Stop auto-refreshing Git status
  function stopGitStatusRefresh() {
    if (gitStatusRefreshTimer) {
      clearInterval(gitStatusRefreshTimer);
      gitStatusRefreshTimer = null;
    }
  }

  // Load agent file edits for the workspace
  async function loadAgentFileEdits() {
    // Check if store is still active before starting
    if (!isStoreActive) {
      logger.debug('[AgentEdits] Store is inactive, skipping load');
      return;
    }

    const capturedWorkspaceId = currentWorkspaceId;
    if (!capturedWorkspaceId) {
      return;
    }

    try {
      // Get workspace details to find the project path
      let projectPath = '';
      try {
        const wsResult = (await invoke('workspace:get', { id: capturedWorkspaceId })) as {
          ok?: boolean;
          data?: { worktreePath?: string; repositoryPath?: string; path?: string };
        };
        // Check if store became inactive during the async call
        if (!isStoreActive) {
          logger.debug('[AgentEdits] Store became inactive during load, aborting', {
            workspaceId: capturedWorkspaceId,
          });
          return;
        }
        if (wsResult?.ok && wsResult.data) {
          projectPath =
            wsResult.data.worktreePath || wsResult.data.repositoryPath || wsResult.data.path || '';
        }
      } catch {
        // Could not get workspace details, continue with empty project path
      }

      const edits = await getAgentFileEdits(capturedWorkspaceId, 3);

      // Check again if store became inactive during the async call
      if (!isStoreActive) {
        logger.debug('[AgentEdits] Store became inactive during getAgentFileEdits, discarding results', {
          workspaceId: capturedWorkspaceId,
        });
        return;
      }

      const editsWithParents = propagateAgentEditsToParents(edits, workspacePath, projectPath);
      agentFileEdits = editsWithParents;
    } catch (err) {
      logger.error('[AgentEdits] Failed to load:', err);
    }
  }

  // Get agent edits for a single node path
  function getAgentEditsForPath(nodePath: string): string[] | undefined {
    let relativePath = nodePath;
    if (workspacePath) {
      const stripped = stripWorkspacePrefix(nodePath, workspacePath);
      if (stripped !== nodePath) relativePath = stripped;
    }
    return agentFileEdits.get(relativePath);
  }

  // Apply agent edits to a single node (returns new node with edits)
  function applyAgentEditsToNode(node: FileNode): FileNode {
    const edits = getAgentEditsForPath(node.path);
    if (edits && edits.length > 0) {
      return { ...node, agentEdits: edits };
    }
    return node;
  }

  // Apply agent edits to a list of nodes (returns new array with edits applied)
  function applyAgentEditsToNodes(nodes: FileNode[]): FileNode[] {
    return nodes.map((node) => {
      let updatedNode = applyAgentEditsToNode(node);
      if (updatedNode.children && updatedNode.children.length > 0) {
        updatedNode = { ...updatedNode, children: applyAgentEditsToNodes(updatedNode.children) };
      }
      return updatedNode;
    });
  }

  // Apply agent edits to all nodes in a tree (returns new tree)
  function applyAgentEditsToTree(node: FileNode): FileNode {
    const edits = getAgentEditsForPath(node.path);

    const hasEdits = edits && edits.length > 0;
    const hasChildren = node.children && node.children.length > 0;

    if (!hasEdits && !hasChildren) {
      return node;
    }

    // Create a new node with agent edits and/or updated children
    const updatedNode: FileNode = {
      ...node,
      ...(hasEdits ? { agentEdits: edits } : {}),
      ...(hasChildren ? { children: node.children!.map((c) => applyAgentEditsToTree(c)) } : {}),
    };

    return updatedNode;
  }

  // Check if file should be ignored using the `ignore` npm package for correct
  // gitignore semantics (order-dependent processing, negation patterns, globs, etc.)
  //
  // .git is always hidden (not a user file). All other default patterns are added
  // to the `ignore` instance BEFORE the user's .gitignore patterns, so negation
  // patterns like `!dist` or `!build/important.txt` correctly override them.
  const ALWAYS_HIDE = new Set(['.git']);

  // Default ignore patterns applied before the user's .gitignore rules.
  // These can be overridden by negation patterns (e.g., `!dist`) in .gitignore.
  // Keep in sync with DEFAULT_PATTERNS in lib/utils/main/gitignore-manager.ts
  // (that list is a superset — it adds chokidar-specific entries like .env).
  const DEFAULT_IGNORE_PATTERNS = [
    'node_modules',
    '.DS_Store',
    'Thumbs.db',
    'dist',
    'build',
    '.next',
    '.svelte-kit',
    'coverage',
    '.cache',
    '*.log',
  ];

  // Cache: rebuild the ignore instance only when the patterns array identity changes.
  let cachedPatternsRef: string[] | null = null;
  let cachedIg: ReturnType<typeof ignore> | null = null;

  function getIgnoreInstance(patterns: string[]): ReturnType<typeof ignore> {
    if (cachedPatternsRef === patterns && cachedIg) return cachedIg;
    cachedPatternsRef = patterns;
    cachedIg = ignore();
    // Defaults first — user negations in .gitignore can override these
    cachedIg.add(DEFAULT_IGNORE_PATTERNS);
    if (patterns.length > 0) {
      cachedIg.add(patterns);
    }
    return cachedIg;
  }

  // Returns true for entries that should be completely hidden from the tree (not even dimmed).
  // Currently only .git — all other ignored entries are shown dimmed via isGitignored.
  function shouldHide(filePath: string): boolean {
    const lastSlash = filePath.lastIndexOf('/');
    const fileName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
    return ALWAYS_HIDE.has(fileName);
  }

  // Check if a file matches gitignore patterns (for muted display, not hiding)
  function checkGitignored(filePath: string): boolean {
    const stripped = stripWorkspacePrefix(filePath, workspacePath);
    const lastSlash = filePath.lastIndexOf('/');
    const fileName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
    const relativePath = stripped !== filePath ? stripped : fileName;

    const ig = getIgnoreInstance(gitignorePatterns);
    return ig.ignores(relativePath);
  }

  // Core directory loading without preloading (to avoid recursion)
  async function loadDirectoryCore(dirPath: string): Promise<FileNode[]> {
    // Use remote or local loading based on workspace type
    if (isRemote()) {
      return loadDirectoryCoreRemote(dirPath);
    }
    return loadDirectoryCoreLocal(dirPath);
  }

  // Load directory from local file system
  async function loadDirectoryCoreLocal(dirPath: string): Promise<FileNode[]> {
    try {
      const response = (await invoke('file:readDirWithStats', { path: dirPath })) as {
        success: boolean;
        data?: any[];
        error?: string;
      };
      const nodes: FileNode[] = [];

      if (!response.success || !response.data) {
        if (dirPath === workspacePath && response.error?.includes('not accessible')) {
          logger.warn('[loadDirectoryCoreLocal] Workspace directory not accessible, it may not exist yet', {
            dirPath,
            error: response.error,
          });
          error = 'Workspace directory not found. The repository may not be cloned yet.';
        } else {
          logger.error('[loadDirectoryCoreLocal] Failed to read directory:', response.error || 'No data returned', {
            dirPath,
            response,
          });
        }
        return nodes;
      }

      for (const entry of response.data) {
        const fullPath = `${dirPath}/${entry.name}`;
        if (shouldHide(fullPath)) {
          continue;
        }
        const relativePath = fullPath.replace(`${workspacePath}/`, '');
        const fileGitStatus = gitStatus.get(relativePath);
        const ignored = checkGitignored(fullPath);

        nodes.push({
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory ? 'directory' : 'file',
          size: entry.size,
          modified: entry.modified,
          children: entry.isDirectory ? [] : undefined,
          gitStatus: fileGitStatus,
          ...(ignored && { isGitignored: true }),
        });
      }

      return sortAndEnrichNodes(nodes, dirPath);
    } catch (err) {
      logger.error('Failed to load directory:', err);
      return [];
    }
  }

  // Load directory from remote file system via SSH
  async function loadDirectoryCoreRemote(dirPath: string): Promise<FileNode[]> {
    if (!remoteConnectionId) {
      logger.error('Remote connection not initialized');
      error = 'Remote connection not initialized';
      return [];
    }

    try {
      logger.debug('Invoking remote-fs:readdir', { dirPath, connectionId: remoteConnectionId });
      const response = (await invoke('remote-fs:readdir', {
        workspaceId: remoteConnectionId,
        path: dirPath,
      })) as {
        success: boolean;
        data?: Array<{
          name: string;
          path: string;
          isDirectory: boolean;
          isFile: boolean;
          size: number;
          modified: Date | string;
          permissions?: string;
        }>;
        error?: string;
      };

      const nodes: FileNode[] = [];

      if (!response.success || !response.data) {
        if (dirPath === workspacePath && response.error?.includes('not accessible')) {
          logger.warn('Remote workspace directory not accessible', {
            dirPath,
            error: response.error,
          });
          error = 'Remote workspace directory not found.';
        } else {
          logger.error('Failed to read remote directory:', response.error || 'No data returned', {
            dirPath,
            response,
          });
        }
        return nodes;
      }

      for (const entry of response.data) {
        const fullPath = entry.path || `${dirPath}/${entry.name}`;
        if (shouldHide(fullPath)) {
          continue;
        }
        const relativePath = fullPath.replace(`${workspacePath}/`, '');
        const fileGitStatus = gitStatus.get(relativePath);
        const ignored = checkGitignored(fullPath);

        // Convert modified to ISO string for FileNode compatibility
        const modifiedDate =
          entry.modified instanceof Date ? entry.modified : new Date(entry.modified);
        const modifiedStr = modifiedDate.toISOString();

        nodes.push({
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory ? 'directory' : 'file',
          size: entry.size,
          modified: modifiedStr,
          children: entry.isDirectory ? [] : undefined,
          gitStatus: fileGitStatus,
          ...(ignored && { isGitignored: true }),
        });
      }

      return sortAndEnrichNodes(nodes, dirPath);
    } catch (err) {
      logger.error('Failed to load remote directory:', err);
      return [];
    }
  }

  // Sort nodes and add git status for directories
  function sortAndEnrichNodes(nodes: FileNode[], dirPath: string): FileNode[] {
    // Sort: directories first, then alphabetically
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    // Check if any child has git changes for directories
    for (const node of nodes) {
      if (node.type === 'directory') {
        const nodeDirPath = node.path.replace(`${workspacePath}/`, '');
        for (const [filePath] of gitStatus.entries()) {
          if (filePath.startsWith(`${nodeDirPath}/`)) {
            node.gitStatus = { status: 'M ', additions: 0, deletions: 0 };
            break;
          }
        }
      }
    }

    // Update cache
    directoryCache.set(dirPath, { nodes, timestamp: Date.now() });

    return nodes;
  }

  // Load directory without triggering preload (for preloading itself)
  async function loadDirectoryWithoutPreload(dirPath: string): Promise<FileNode[]> {
    if (!dirPath) {
      return [];
    }

    // Check cache first
    const cached = directoryCache.get(dirPath);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.nodes;
    }

    return loadDirectoryCore(dirPath);
  }

  // Load directory contents (with preloading of children)
  async function loadDirectory(dirPath: string, node?: FileNode): Promise<FileNode[]> {
    if (!dirPath) {
      logger.error('Failed to read directory:', 'Directory path is undefined or empty');
      return [];
    }

    logger.debug('Loading directory', { dirPath, workspacePath });

    // Check cache first
    const cached = directoryCache.get(dirPath);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      logger.debug('Using cached directory contents', { dirPath, itemCount: cached.nodes.length });
      return cached.nodes;
    }

    try {
      // Use loadDirectoryCore which handles both remote and local workspaces
      // Note: loadDirectoryCore → sortAndEnrichNodes already populates directoryCache,
      // so we don't need to cache again here.
      const nodes = await loadDirectoryCore(dirPath);

      // Update file count
      updateFileCount(nodes);

      // Eagerly load children for directories (one level deep) for instant expansion
      // This populates node.children so toggleDirectory doesn't need to wait
      // Skip gitignored directories (e.g. node_modules) to avoid loading potentially huge trees
      const directoriesToPreload = nodes.filter((n) => n.type === 'directory' && !n.isGitignored);
      if (directoriesToPreload.length > 0) {
        // Load children in background and assign directly to nodes
        Promise.all(
          directoriesToPreload.map(async (dirNode) => {
            // Check if already has children loaded
            if (dirNode.children && dirNode.children.length > 0) {
              return; // Already has children
            }
            // Check if cached
            const cached = directoryCache.get(dirNode.path);
            if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
              // Use cached children - assign directly to node
              dirNode.children = cached.nodes;
              return;
            }
            try {
              // Load and assign children directly to node for instant expansion
              const children = await loadDirectoryWithoutPreload(dirNode.path);
              dirNode.children = children;
            } catch (err) {
              // Ignore preload errors - they'll be handled when user actually expands
              logger.debug('Preload failed for directory', { path: dirNode.path, error: err });
            }
          }),
        ).catch(() => {
          // Ignore batch preload errors
        });
      }

      return nodes;
    } catch (error) {
      logger.error('Failed to load directory:', error);
      return [];
    }
  }

  // Helper function to count files in a node tree
  function countFilesInTree(node: FileNode): number {
    let count = 0;
    if (node.type === 'file') {
      return 1;
    }
    if (node.children) {
      for (const child of node.children) {
        count += countFilesInTree(child);
      }
    }
    return count;
  }

  // Update file count
  function updateFileCount(nodes: FileNode[]) {
    let count = 0;
    for (const node of nodes) {
      count += countFilesInTree(node);
    }
    fileCount = count;
  }

  // Load root directory with better error handling and performance
  async function loadRootDirectory(forceRefresh = false, showLoadingState = true) {
    if (!workspacePath) {
      logger.error('Failed to load root directory:', 'Workspace path is undefined or empty');
      error = 'No workspace path provided';
      rootNode = null;
      treeVersion++;
      return;
    }

    // Skip if already loading to prevent duplicate requests
    if (isLoading && !forceRefresh) {
      logger.debug('Already loading root directory, skipping duplicate request');
      return;
    }

    // Only show loading state if requested (not during refreshes)
    if (showLoadingState) {
      isLoading = true;
    }
    error = null;

    try {
      // Load agent file edits in parallel with directory contents
      const [children] = await Promise.all([loadDirectory(workspacePath), loadAgentFileEdits()]);

      const pathParts = workspacePath.split('/').filter(Boolean);
      const workspaceName = pathParts[pathParts.length - 1] || 'Workspace';

      // Create a new rootNode object to ensure reactive updates
      let newRootNode: FileNode = {
        name: workspaceName,
        path: workspacePath,
        type: 'directory' as const,
        children,
      };
      expandedPaths.add(workspacePath);

      // Reload children for directories that are in expandedPaths
      if (newRootNode.children) {
        await preserveExpandedState(newRootNode.children);
      }

      // Apply agent edits to the tree
      newRootNode = applyAgentEditsToTree(newRootNode);

      // Always update the root node to ensure git status changes are reflected
      // The reactive system will handle whether the UI actually needs to re-render
      rootNode = newRootNode;
      treeVersion++;
      logger.debug('Root directory updated', {
        fileCount: countFilesInTree(newRootNode),
        forceRefresh,
        gitStatusCount: gitStatus.size,
        agentEditsCount: agentFileEdits.size,
      });
    } catch (err) {
      logger.error('Failed to load root directory:', err);
      error = 'Failed to load files';
      // Don't clear rootNode on error - keep showing stale data
      // This provides better UX during transient failures
    } finally {
      isLoading = false;
    }
  }

  // Helper function to reload children for expanded directories when tree is refreshed.
  // Expanded state now lives in expandedPaths Set, so we only need to reload children
  // for paths that are still expanded.
  async function preserveExpandedState(newNodes: FileNode[]) {
    // Process nodes and collect promises for parallel loading
    const loadPromises: Promise<void>[] = [];

    for (const newNode of newNodes) {
      if (expandedPaths.has(newNode.path) && newNode.type === 'directory') {
        // Reload children for expanded directories (git status may have changed)
        newNode.children = [];
        const loadPromise = loadDirectory(newNode.path, newNode)
          .then((children) => {
            newNode.children = children;
          })
          .catch((err) => {
            logger.error('Failed to reload directory children:', err);
            newNode.children = [];
          });
        loadPromises.push(loadPromise);
      }
    }

    // Wait for all directories to load in parallel
    if (loadPromises.length > 0) {
      await Promise.all(loadPromises);
    }
  }

  // Preload children for a set of directory nodes (one level deep)
  // Skip gitignored directories (e.g. node_modules) to avoid loading potentially huge trees
  function preloadChildDirectories(nodes: FileNode[]) {
    const directoriesToPreload = nodes.filter((n) => n.type === 'directory' && !n.isGitignored);
    if (directoriesToPreload.length === 0) return;

    // Load children in background and assign directly to nodes
    Promise.all(
      directoriesToPreload.map(async (dirNode) => {
        // Check if already has children loaded
        if (dirNode.children && dirNode.children.length > 0) {
          return;
        }
        // Check if cached
        const cached = directoryCache.get(dirNode.path);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          dirNode.children = cached.nodes;
          return;
        }
        try {
          const children = await loadDirectoryWithoutPreload(dirNode.path);
          dirNode.children = children;
        } catch (err) {
          logger.debug('Preload failed for directory', { path: dirNode.path, error: err });
        }
      }),
    ).catch(() => {
      // Ignore batch preload errors
    });
  }

  // Find a node in the tree by its path
  // This is necessary because the node reference passed in may be stale
  // (e.g., after git status refresh recreates tree objects)
  function findNodeByPath(path: string): FileNode | null {
    if (!rootNode) return null;

    // Handle root node case
    if (path === workspacePath || path === rootNode.path) {
      return rootNode;
    }

    // Get path relative to workspace (with directory boundary check)
    const stripped = stripWorkspacePrefix(path, workspacePath);
    const relativePath = stripped !== path ? stripped : path;

    if (!relativePath) return null;

    // Split into path segments
    const segments = relativePath.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    // Walk down the tree to find the node
    let currentNode = rootNode;
    for (const segment of segments) {
      const childNode = currentNode.children?.find((child) => child.name === segment);
      if (!childNode) return null;
      currentNode = childNode;
    }

    return currentNode;
  }

  // Toggle directory expansion
  async function toggleDirectory(nodeArg: FileNode) {
    if (nodeArg.type !== 'directory') return;

    // IMPORTANT: Find the current node by path to avoid stale references
    // The node passed in may be from a previous version of the tree
    // (e.g., before a git status refresh that recreated all node objects)
    const node = findNodeByPath(nodeArg.path);
    if (!node) {
      logger.warn('[toggleDirectory] Could not find node in current tree', {
        nodePath: nodeArg.path,
        nodeName: nodeArg.name,
      });
      return;
    }

    const wasExpanded = expandedPaths.has(node.path);
    logger.debug('[toggleDirectory] Called', {
      nodePath: node.path,
      wasExpanded,
      hasChildren: !!node.children,
      usedFindByPath: node !== nodeArg,
    });

    if (wasExpanded) {
      expandedPaths.delete(node.path);
    } else {
      expandedPaths.add(node.path);
    }
    // Increment version to force derived values to recompute
    treeVersion++;

    const nowExpanded = !wasExpanded;

    // Load children if expanding and not loaded
    if (nowExpanded && (!node.children || node.children.length === 0)) {
      // First, check if we have cached data - use it immediately without loading state
      const cached = directoryCache.get(node.path);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        logger.debug('[toggleDirectory] Using cached children', {
          nodePath: node.path,
          cachedChildrenCount: cached.nodes.length,
        });
        // Apply agent edits and assign (creates new array for reactivity)
        node.children = applyAgentEditsToNodes(cached.nodes);
        // Preload the next level in background
        preloadChildDirectories(node.children);
        treeVersion++; // Force update after children assigned
        return;
      }

      // No cache - need to load
      logger.debug('[toggleDirectory] Loading children from disk', { nodePath: node.path });
      loadingPaths.add(node.path);
      treeVersion++; // Force update to show loading state
      try {
        const loadedChildren = await loadDirectory(node.path, node);

        // IMPORTANT: Re-find the node after the async operation.
        // During the await, syncGitStatusFromStores/refreshGitStatus/refresh may have
        // replaced the entire tree with new objects (via applyGitStatusToNodes spread).
        // The original `node` reference may now point to an orphaned object.
        const currentNode = findNodeByPath(nodeArg.path);
        if (!currentNode) {
          logger.warn('[toggleDirectory] Node disappeared from tree after loading', {
            nodePath: nodeArg.path,
          });
          return;
        }

        logger.debug('[toggleDirectory] Children loaded', {
          nodePath: currentNode.path,
          count: loadedChildren?.length ?? 0,
          nodeWasReplaced: currentNode !== node,
        });
        // Apply agent edits and assign to the CURRENT node (not the potentially stale one)
        if (loadedChildren) {
          currentNode.children = applyAgentEditsToNodes(loadedChildren);
        } else {
          currentNode.children = loadedChildren;
        }
        loadingPaths.delete(nodeArg.path);
        treeVersion++; // Force update after children loaded
        // loadDirectory already triggers preloading
      } catch (err) {
        logger.error('[toggleDirectory] Failed to load directory:', err);
        loadingPaths.delete(nodeArg.path);
        treeVersion++; // Force update to hide loading spinner
      }
    } else if (nowExpanded && node.children && node.children.length > 0) {
      logger.debug('[toggleDirectory] Already has children, refreshing agent edits', {
        nodePath: node.path,
        childrenCount: node.children.length,
      });
      // Already have children - ensure agent edits are applied (reassign for reactivity)
      node.children = applyAgentEditsToNodes(node.children);
      // Preload their children for the next level
      preloadChildDirectories(node.children);
      treeVersion++; // Force update after children reassigned
    } else {
      logger.debug('[toggleDirectory] Collapsing directory', {
        nodePath: node.path,
        isExpanded: nowExpanded,
      });
    }
  }

  // Refresh directory without showing loading skeleton
  async function refresh() {
    logger.debug('[FileExplorer] Refreshing file tree and git status');
    directoryCache.clear();
    // Reload gitignore patterns so newly-ignored/un-ignored files update their dimmed state
    await loadGitignorePatterns().catch((err) =>
      logger.warn('Failed to reload gitignore patterns during refresh:', err),
    );
    await loadGitStatus();
    // Pass false for showLoadingState to avoid skeleton during refreshes
    await loadRootDirectory(false, false);
  }

  // Expand all directories in the path to reveal a specific file
  async function expandToPath(targetPath: string): Promise<boolean> {
    if (!rootNode || !targetPath) return false;

    // Get path relative to workspace (with directory boundary check)
    const stripped = stripWorkspacePrefix(targetPath, workspacePath);
    const relativePath = stripped !== targetPath ? stripped : targetPath;

    if (!relativePath) return false;

    // Split into path segments
    const segments = relativePath.split('/').filter(Boolean);
    if (segments.length === 0) return false;

    // Walk down the tree, expanding directories as we go
    let currentNode = rootNode;
    let currentPath = workspacePath;

    // All segments except the last (which is the file itself)
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      currentPath = `${currentPath}/${segment}`;

      // Find the child node matching this segment
      const childNode = currentNode.children?.find(
        (child) => child.name === segment && child.type === 'directory',
      );

      if (!childNode) {
        logger.debug('[FileExplorer] expandToPath: Could not find directory', {
          segment,
          currentPath,
        });
        return false;
      }

      // Expand this directory if not already expanded
      if (!expandedPaths.has(childNode.path)) {
        expandedPaths.add(childNode.path);
        // Increment version to force derived values to recompute
        treeVersion++;

        // Load children if needed
        if (!childNode.children || childNode.children.length === 0) {
          try {
            const loadedChildren = await loadDirectory(childNode.path, childNode);

            // Re-find the node after the async operation in case the tree was
            // replaced by syncGitStatusFromStores/refreshGitStatus during the await
            const freshNode = findNodeByPath(currentPath);
            if (!freshNode) {
              logger.warn('[FileExplorer] expandToPath: Node disappeared after loading', {
                currentPath,
              });
              return false;
            }

            if (loadedChildren) {
              freshNode.children = applyAgentEditsToNodes(loadedChildren);
              // Increment version again after children are loaded
              treeVersion++;
            }
            currentNode = freshNode;
            continue; // Skip the assignment below since we already set currentNode
          } catch (err) {
            logger.error('[FileExplorer] Failed to load directory while expanding path:', err);
            return false;
          }
        }
      }

      currentNode = childNode;
    }

    return true;
  }

  // Apply git status to existing nodes without reloading
  function applyGitStatusToNodes(node: FileNode | null): FileNode | null {
    if (!node) return null;

    // Create a new object to trigger reactivity
    const updatedNode = { ...node };

    // Apply git status to this node if it's a file
    if (updatedNode.type === 'file' && updatedNode.path) {
      // Ensure proper path handling - remove workspace path prefix (with directory boundary check)
      const relativePath = stripWorkspacePrefix(updatedNode.path, workspacePath);
      const fileGitStatus = gitStatus.get(relativePath);

      if (fileGitStatus) {
        updatedNode.gitStatus = fileGitStatus;
      } else {
        // Clear git status if file no longer has changes
        updatedNode.gitStatus = undefined;
      }
    }

    // Recursively apply to children
    if (updatedNode.children) {
      updatedNode.children = updatedNode.children.map(
        (child) => applyGitStatusToNodes(child) || child,
      );
    }

    return updatedNode;
  }

  // Refresh only git status without reloading the entire tree
  async function refreshGitStatus() {
    logger.debug('[FileExplorer] Refreshing git status only');

    // Guard against invalid workspace IDs (e.g., "new" from /workspace/new route)
    if (!currentWorkspaceId || !isValidWorkspaceId(currentWorkspaceId)) {
      logger.debug('[FileExplorer] Skipping git status refresh - invalid workspace ID', {
        currentWorkspaceId,
      });
      return;
    }

    // Refresh the stores first
    await Promise.all([
      gitStore.loadStatus(WorkspaceIdFn(currentWorkspaceId), true),
      fileTrackingStore.refresh(),
    ]);

    // Then load the updated git status
    await loadGitStatus();

    // Apply git status to existing nodes and update the tree
    if (rootNode) {
      const updatedRoot = applyGitStatusToNodes(rootNode);
      if (updatedRoot) {
        rootNode = updatedRoot;
        // Increment version to force derived values to recompute after tree replacement
        treeVersion++;
      }
    }
  }

  // Sync local git status display from stores WITHOUT triggering network calls
  // This prevents cascading refreshes when effects watch store changes
  async function syncGitStatusFromStores() {
    logger.debug('[FileExplorer] Syncing git status from stores (no network calls)');

    // Just read from the stores and update local display
    // Don't call fileTrackingStore.refresh() or gitStore.loadStatus() here

    // Build git status map from file tracking store
    const newGitStatus = new Map<string, FileGitStatus>();

    // Get changes from file tracking store
    const workingChanges = fileTrackingStore.workingChanges;
    const allChanges = [...(workingChanges?.unstaged || []), ...(workingChanges?.staged || [])];

    for (const change of allChanges) {
      const stats = change.stats || { additions: 0, deletions: 0 };
      const statusCode = change.stage === 'staged' ? 'M ' : ' M';

      newGitStatus.set(change.file, {
        status: statusCode,
        additions: stats.additions,
        deletions: stats.deletions,
      });
    }

    // Also check git status for any files not in file tracking
    if (gitStore.status?.files) {
      for (const file of gitStore.status.files) {
        if (!newGitStatus.has(file.path)) {
          newGitStatus.set(file.path, {
            status: file.status || 'M',
            additions: 0,
            deletions: 0,
          });
        }
      }
    }

    gitStatus = newGitStatus;

    // Apply git status to existing nodes and update the tree
    if (rootNode) {
      const updatedRoot = applyGitStatusToNodes(rootNode);
      if (updatedRoot) {
        rootNode = updatedRoot;
        // Increment version to force derived values to recompute after tree replacement
        treeVersion++;
      }
    }
  }

  // Initialize
  async function initialize() {
    // Ensure store is active when initializing - this is critical for cached stores
    // that may have been deactivated by a previous cleanup() call
    isStoreActive = true;

    logger.debug('Initialize called', {
      workspacePath,
      pathType: typeof workspacePath,
      pathLength: workspacePath?.length,
      pathExists: !!workspacePath,
      isRemote: isRemote(),
      isStoreActive,
    });

    if (!workspacePath) {
      logger.warn('Cannot initialize file explorer: no workspace path provided');
      error = 'No workspace path provided';
      return;
    }

    logger.debug('Initializing file explorer', { workspacePath, isRemote: isRemote() });

    // For remote workspaces, initialize the remote FS connection first
    if (isRemote()) {
      const initialized = await initializeRemoteFS();
      if (!initialized) {
        isLoading = false;
        return;
      }

      // Check if remote directory exists
      if (!remoteConnectionId) {
        logger.error('Remote connection not initialized, cannot check directory existence');
        error = 'Remote connection not initialized';
        isLoading = false;
        return;
      }

      try {
        const checkResponse = (await invoke('remote-fs:exists', {
          workspaceId: remoteConnectionId,
          path: workspacePath,
        })) as { success: boolean; data?: boolean; error?: string };

        if (!checkResponse.success || !checkResponse.data) {
          logger.warn('Remote workspace directory not accessible during initialization', {
            workspacePath,
            error: checkResponse.error,
          });
          error = 'Remote workspace directory not found.';
          isLoading = false;
          return;
        }
      } catch (err) {
        logger.error('Failed to check remote workspace directory', err);
        error = 'Failed to access remote workspace directory';
        isLoading = false;
        return;
      }
    } else {
      // Check if local workspace path exists first
      try {
        const checkResponse = (await invoke('file:readDirWithStats', { path: workspacePath })) as {
          success: boolean;
          error?: string;
        };

        if (!checkResponse.success) {
          logger.warn('Workspace directory not accessible during initialization', {
            workspacePath,
            error: checkResponse.error,
          });
          error = 'Workspace directory not found. The repository may not be cloned yet.';
          isLoading = false;
          return;
        }
      } catch (err) {
        logger.error('Failed to check workspace directory', err);
        error = 'Failed to access workspace directory';
        isLoading = false;
        return;
      }
    }

    // Small delay to ensure file tracking store has synced
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Load gitignore patterns FIRST — checkGitignored reads these during directory loading
    // to mark files with isGitignored, so they must be populated before loadRootDirectory runs.
    // Git status can load in parallel with the directory since it doesn't affect file visibility.
    await loadGitignorePatterns().catch((err) =>
      logger.warn('Failed to load gitignore patterns:', err),
    );
    await Promise.all([
      loadGitStatus().catch((err) => logger.warn('Failed to load git status:', err)),
      loadRootDirectory(),
    ]);

    logger.debug('File explorer initialization complete', {
      workspacePath,
      hasRootNode: !!rootNode,
      childrenCount: rootNode?.children?.length || 0,
      error,
      isRemote: isRemote(),
    });

    isInitialized = true;

    // Start git status refresh after initial load
    startGitStatusRefresh();
  }

  // Set workspace path
  async function setWorkspacePath(path: string) {
    // Ensure store is active when setting workspace path - critical for cached stores
    isStoreActive = true;

    logger.debug('setWorkspacePath called', {
      path,
      pathType: typeof path,
      pathLength: path?.length,
      pathExists: !!path,
      currentWorkspacePath: workspacePath,
      isStoreActive,
    });

    if (!path) {
      logger.warn('Cannot set workspace path: path is undefined or empty');
      workspacePath = '';
      rootNode = null;
      treeVersion++;
      error = 'No workspace path provided';
      return;
    }

    logger.debug('Setting workspace path', { path });
    workspacePath = path;
    directoryCache.clear();
    stopGitStatusRefresh();

    // Clear existing data
    rootNode = null;
    expandedPaths.clear();
    loadingPaths.clear();
    treeVersion++;
    error = null;

    // Small delay to ensure file tracking store has synced
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Reinitialize everything when workspace path changes
    try {
      await loadGitignorePatterns();
      await loadGitStatus();
      await loadRootDirectory();
      startGitStatusRefresh();
      logger.debug('Successfully loaded workspace at path:', path);
    } catch (err) {
      logger.error('Failed to load workspace after path change:', err);
      error = 'Failed to load workspace';
    }
  }

  // Set up file change listener with debouncing
  // NOTE: Commented out as the "file-explorer:refresh" event is not currently emitted from the main process
  // The file explorer already refreshes via other mechanisms:
  // 1. Manual refresh button that calls refresh() directly
  // 2. Listening to workspace-changes events in file-tree-view.svelte
  // 3. Auto-refresh of git status every 5 seconds

  // Set environment config (for remote workspace support)
  function setEnvironmentConfig(config: EnvironmentConfig | undefined) {
    // If switching from remote to local or vice versa, disconnect existing remote connection
    if (isRemote() && config?.type !== 'remote') {
      disconnectRemoteFS();
    }
    environmentConfig = config;
    isRemoteInitialized = false;
    remoteConnectionId = null;
  }

  // Cleanup - called when store is no longer active
  function cleanup() {
    // Mark store as inactive to abort any pending async operations
    isStoreActive = false;
    stopGitStatusRefresh();
    expandedPaths.clear();
    loadingPaths.clear();
    // Disconnect remote FS if connected
    if (isRemote()) {
      disconnectRemoteFS();
    }
  }

  // Flatten the tree into a list of visible nodes for virtualized rendering
  // This only includes nodes that are visible (parents are expanded)
  // Handles path compaction (single-child directory chains shown as "a/b/c")
  // Uses a shared result array to avoid creating intermediate arrays with spread operator
  function flattenVisibleNodes(
    nodes: FileNode[],
    depth: number = 0,
    pathPrefix: string = '',
    result: FlattenedFileNode[] = [],
  ): FlattenedFileNode[] {
    for (const node of nodes) {
      const nodeExpanded = expandedPaths.has(node.path);
      const nodeLoading = loadingPaths.has(node.path);

      // Handle directory compaction: if this is a directory with exactly one child
      // that is also a directory, compact the path display
      if (node.type === 'directory' && node.children?.length === 1) {
        const onlyChild = node.children[0];
        if (onlyChild.type === 'directory') {
          // Compact: recurse with accumulated path prefix
          const newPrefix = pathPrefix ? `${pathPrefix}/${node.name}` : node.name;
          // Pass through expansion state - use OR of both nodes
          if (nodeExpanded || expandedPaths.has(onlyChild.path)) {
            flattenVisibleNodes([onlyChild], depth, newPrefix, result);
          } else {
            // Show the compacted directory as collapsed
            result.push({
              node: onlyChild,
              depth,
              displayPath: `${newPrefix}/${onlyChild.name}`,
              isExpanded: false,
              isLoading: loadingPaths.has(onlyChild.path),
            });
          }
          continue;
        }
      }

      // Regular node - add it
      result.push({
        node,
        depth,
        displayPath: pathPrefix ? `${pathPrefix}/${node.name}` : undefined,
        isExpanded: nodeExpanded,
        isLoading: nodeLoading,
      });

      // If directory is expanded, add children
      if (node.type === 'directory' && nodeExpanded && node.children) {
        flattenVisibleNodes(node.children, depth + 1, '', result);
      }
    }

    return result;
  }

  // Computed: flattened visible nodes (recomputes when tree changes)
  // Depends on treeVersion to force recomputation when deep mutations occur
  const flattenedNodes = $derived.by(() => {
    // Read treeVersion to create a dependency - this forces recomputation
    // when toggleDirectory or other tree-mutating operations occur
    void treeVersion;
    if (!rootNode || !rootNode.children) return [];
    return flattenVisibleNodes(rootNode.children);
  });

  return {
    get workspacePath() {
      return workspacePath;
    },
    get rootNode() {
      return rootNode;
    },
    get isLoading() {
      return isLoading;
    },
    get isInitialized() {
      return isInitialized;
    },
    get error() {
      return error;
    },
    get fileCount() {
      return fileCount;
    },
    get gitStatus() {
      return gitStatus;
    },
    get isRemoteWorkspace() {
      return isRemote();
    },
    get hasExpandedDirectories() {
      return hasAnyExpandedDirectory();
    },
    get isBulkOperation() {
      return isBulkOperation;
    },
    get flattenedNodes() {
      return flattenedNodes;
    },
    isExpanded(path: string): boolean {
      return expandedPaths.has(path);
    },
    isPathLoading(path: string): boolean {
      return loadingPaths.has(path);
    },
    setWorkspaceId(id: string) {
      currentWorkspaceId = id;
    },
    setEnvironmentConfig,
    initialize,
    toggleDirectory,
    expandToPath,
    expandAll,
    collapseAll,
    refresh,
    refreshGitStatus,
    syncGitStatusFromStores,
    setWorkspacePath,
    cleanup,
    // Deactivate store (abort pending async ops) when switching away from this workspace
    deactivate() {
      isStoreActive = false;
      stopGitStatusRefresh();
    },
    // Reactivate store when switching back to this workspace
    reactivate() {
      isStoreActive = true;
    },
  };

  // Expand all directories with progressive loading and optional depth limit
  // maxDepth: undefined = unlimited, 0 = root only, 1 = root + first level, etc.
  async function expandAll(maxDepth?: number) {
    if (!rootNode) return;

    // Signal bulk operation start - UI should skip transitions
    isBulkOperation = true;

    try {
      // Collect all directories that need expansion using BFS for level-based expansion
      const queue: Array<{ node: FileNode; depth: number }> = [{ node: rootNode, depth: 0 }];
      let processedCount = 0;

      while (queue.length > 0) {
        // Take a batch of directories to process
        const batch = queue.splice(0, EXPAND_BATCH_SIZE);

        await Promise.all(
          batch.map(async ({ node, depth }) => {
            if (node.type !== 'directory') return;

            // Skip gitignored directories (e.g. node_modules) to avoid expanding huge trees
            if (node.isGitignored) return;

            // Check depth limit
            if (maxDepth !== undefined && depth > maxDepth) return;

            const nodePath = node.path;
            expandedPaths.add(nodePath);

            // Load children if not loaded
            if (!node.children || node.children.length === 0) {
              try {
                const children = await loadDirectory(node.path, node);

                // Re-find the node after async operation in case tree was replaced
                const currentNode = findNodeByPath(nodePath);
                if (!currentNode) return;

                currentNode.children = applyAgentEditsToNodes(children);

                // Queue children from the CURRENT node for expansion
                if (currentNode.children && (maxDepth === undefined || depth < maxDepth)) {
                  for (const child of currentNode.children) {
                    if (child.type === 'directory' && !child.isGitignored) {
                      queue.push({ node: child, depth: depth + 1 });
                    }
                  }
                }
                return;
              } catch (err) {
                logger.error('[FileExplorer] Failed to load directory during expandAll:', err);
                return;
              }
            }

            // Queue children for expansion (if within depth limit)
            if (node.children && (maxDepth === undefined || depth < maxDepth)) {
              for (const child of node.children) {
                if (child.type === 'directory' && !child.isGitignored) {
                  queue.push({ node: child, depth: depth + 1 });
                }
              }
            }
          }),
        );

        processedCount += batch.length;

        // Yield to UI every batch to keep things responsive
        // Also trigger intermediate reactivity updates for progressive rendering
        if (queue.length > 0 && processedCount % (EXPAND_BATCH_SIZE * 3) === 0) {
          treeVersion++;
          await yieldToUI();
        }
      }

      // Final reactivity trigger
      treeVersion++;
    } finally {
      // Small delay before ending bulk operation to let final render complete
      await yieldToUI();
      isBulkOperation = false;
    }
  }

  // Collapse all directories
  function collapseAll() {
    if (!rootNode) return;

    // Signal bulk operation - skip transitions
    isBulkOperation = true;

    try {
      // Clear all expanded paths except root
      const rootPath = workspacePath;
      expandedPaths.clear();
      expandedPaths.add(rootPath);
      // Trigger reactivity via treeVersion
      treeVersion++;
    } finally {
      // Use requestAnimationFrame to ensure DOM updates before resetting flag
      requestAnimationFrame(() => {
        isBulkOperation = false;
      });
    }
  }

  // Check if any directory in the tree is expanded (excluding root)
  function hasAnyExpandedDirectory(): boolean {
    // Any expanded path besides the root means there are expanded directories
    for (const path of expandedPaths) {
      if (path !== workspacePath) return true;
    }
    return false;
  }
}

// Singleton store manager for sharing file explorer across components (e.g., sidebar, cmd+k)
const storeCache = new Map<string, ReturnType<typeof createFileExplorerStore>>();

export function getFileExplorerStore(
  workspacePath: string,
  workspaceId?: string,
  environmentConfig?: EnvironmentConfig,
): ReturnType<typeof createFileExplorerStore> {
  const cacheKey = workspaceId || workspacePath;

  let store = storeCache.get(cacheKey);
  if (!store) {
    logger.debug('Creating new file explorer store', { cacheKey });
    store = createFileExplorerStore({
      initialPath: workspacePath,
      workspaceId,
      environmentConfig,
    });
    storeCache.set(cacheKey, store);
  } else {
    logger.debug('Using cached file explorer store', { cacheKey });
    // Update path if changed - use queueMicrotask to avoid mutating state during a derived computation
    // This can happen when getFileExplorerStore is called inside $derived() in file-tree-view.svelte
    if (workspacePath && store.workspacePath !== workspacePath) {
      const storeRef = store;
      const pathRef = workspacePath;
      queueMicrotask(() => {
        storeRef.setWorkspacePath(pathRef);
      });
    }
    // Update environment config if provided - also defer to avoid state mutation during derived
    if (environmentConfig) {
      const storeRef = store;
      const configRef = environmentConfig;
      queueMicrotask(() => {
        storeRef.setEnvironmentConfig(configRef);
      });
    }
  }

  return store;
}

export function clearFileExplorerStore(workspaceId: string) {
  const store = storeCache.get(workspaceId);
  if (store) {
    store.cleanup();
    storeCache.delete(workspaceId);
  }
}

/**
 * Deactivate a store when switching away from its workspace.
 * This marks pending async operations to abort but keeps the store in cache
 * so it can be reactivated if the user switches back.
 */
export function deactivateFileExplorerStore(workspaceId: string) {
  const store = storeCache.get(workspaceId);
  if (store) {
    store.deactivate();
    logger.debug('Deactivated file explorer store', { workspaceId });
  }
}

/**
 * Reactivate a store when switching back to its workspace.
 */
export function reactivateFileExplorerStore(workspaceId: string) {
  const store = storeCache.get(workspaceId);
  if (store) {
    store.reactivate();
    logger.debug('Reactivated file explorer store', { workspaceId });
  }
}
