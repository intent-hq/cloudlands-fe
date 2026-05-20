/**
 * Provider Registry and Additional Providers
 */

import type {
  Provider,
  MentionCandidate,
  SearchContext,
  MentionType,
} from '../types';
import { SPECIAL_MENTIONS } from '../types';
import { FileProvider } from './file-provider';
import { logger } from '$lib/utils/client-logger';
import { fuzzyMatch } from '$lib/services/mentions/fuzzy-matcher';
import {
  selectSpecialists,
  selectSpecialistById,
} from '$lib/store/slices/specialists/specialists-selectors';
import { formatRelativeTimeCompact } from '$lib/utils/date';
import type { Workspace } from '$shared/types';
import { store as appStore } from '$lib/store/store';

// Cache for workspace repo paths to avoid repeated IPC calls
const workspaceRepoPathCache = new Map<string, string>();

/**
 * Get the workspace repo/worktree path for a given workspace ID.
 * Returns the actual repository path (worktreePath or repositoryPath),
 * NOT the workspace storage/metadata folder.
 * Uses caching to avoid repeated IPC calls.
 */
async function getWorkspaceRoot(workspaceId: string): Promise<string | null> {
  if (workspaceRepoPathCache.has(workspaceId)) {
    return workspaceRepoPathCache.get(workspaceId) || null;
  }

  try {
    const { invoke } = await import('$lib/electron-bridge');
    // Fetch the full workspace object to get the actual repo path
    const response = await invoke<{ success: boolean; data?: any }>('workspace:get-by-id', { workspaceId });
    if (response?.success && response.data) {
      const repoPath = response.data.worktreePath || response.data.repositoryPath;
      if (repoPath) {
        workspaceRepoPathCache.set(workspaceId, repoPath);
        return repoPath;
      }
    }
  } catch (error) {
    logger.debug('[FolderProvider] Failed to get workspace repo path:', error);
  }

  // Fallback to workspace:get-root if workspace:get-by-id fails
  try {
    const { invoke } = await import('$lib/electron-bridge');
    const result = await invoke<string>('workspace:get-root', { workspaceId });
    if (result) {
      workspaceRepoPathCache.set(workspaceId, result);
      return result;
    }
  } catch (error) {
    logger.debug('[FolderProvider] Failed to get workspace root:', error);
  }

  return null;
}

/**
 * Convert an absolute path to a relative path based on workspace root
 * If the path is already relative or workspace root cannot be determined, returns the original path
 */
async function makePathRelative(absolutePath: string, workspaceId: string): Promise<string> {
  // If path is already relative, return as-is
  if (!absolutePath.startsWith('/')) {
    return absolutePath;
  }

  const workspaceRoot = await getWorkspaceRoot(workspaceId);
  if (!workspaceRoot) {
    return absolutePath;
  }

  // Remove trailing slash from workspace root for consistent comparison
  const normalizedRoot = workspaceRoot.endsWith('/') ? workspaceRoot.slice(0, -1) : workspaceRoot;

  // If path starts with workspace root, make it relative
  if (absolutePath.startsWith(normalizedRoot + '/')) {
    return absolutePath.slice(normalizedRoot.length + 1);
  }

  // If path equals workspace root, return empty string or '.'
  if (absolutePath === normalizedRoot) {
    return '.';
  }

  // Path is outside workspace root, return as-is
  return absolutePath;
}

// Folder Provider
export class FolderProvider implements Provider {
  id = 'folder';
  triggers = ['@folder', '@dir'];

  async search(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    try {
      const { invoke } = await import('$lib/electron-bridge');

      // Try workspace path first
      if (context.workspaceId) {
        const workspaceRoot = await getWorkspaceRoot(context.workspaceId);
        if (workspaceRoot) {
          logger.debug('[FolderProvider] Searching workspace at:', workspaceRoot);
          const result: any = await invoke('file:list', {
            path: workspaceRoot,
            recursive: true,
          });

          if (result && result.success && result.data && result.data.length > 0) {
            const folders = result.data
              .filter((entry: any) => !entry.isFile)
              .filter((folder: any) => {
                if (!query) return true;
                return fuzzyMatch(query, folder.name) !== null;
              })
              .slice(0, 10)
              .map(async (folder: any) => {
                const displayPath = await makePathRelative(folder.path, context.workspaceId!);
                return {
                  id: `folder-${folder.path}`,
                  type: 'folder' as MentionType,
                  label: folder.name || folder.path.split('/').pop() || folder.path,
                  description: displayPath,
                  icon: '📁',
                  uri: `devspace://folder/${encodeURIComponent(folder.path)}`,
                  meta: {
                    path: displayPath,
                    fullPath: folder.path,
                    relativePath: displayPath,
                  },
                };
              });

            if (folders.length > 0) {
              return await Promise.all(folders);
            }
          }
        }
      }

      // Try repoPath if workspace didn't work
      if (context.repoPath) {
        logger.debug('[FolderProvider] Searching repo at:', context.repoPath);
        const result: any = await invoke('file:list', {
          path: context.repoPath,
          recursive: true,
        });

        if (result && result.success && result.data && result.data.length > 0) {
          const folders = result.data
            .filter((entry: any) => !entry.isFile)
            .filter((folder: any) => {
              if (!query) return true;
              return fuzzyMatch(query, folder.name) !== null;
            })
            .slice(0, 10)
            .map((folder: any) => {
              const relativePath = folder.path.replace(context.repoPath, '').replace(/^\//, '');
              return {
                id: `folder-${folder.path}`,
                type: 'folder' as MentionType,
                label: folder.name || folder.path.split('/').pop() || folder.path,
                description: relativePath,
                icon: '📁',
                uri: `devspace://folder/${encodeURIComponent(folder.path)}`,
                meta: {
                  path: relativePath,
                  fullPath: folder.path,
                  relativePath: relativePath,
                },
              };
            });

          if (folders.length > 0) {
            return folders;
          }
        }
      }
    } catch (error) {
      logger.debug('[FolderProvider] Failed to get folders:', error);
    }

    // Fallback to common folders
    const folders = [
      { path: 'src', label: 'src' },
      { path: 'lib', label: 'lib' },
      { path: 'tests', label: 'tests' },
      { path: 'docs', label: 'docs' },
    ];

    // Use fuzzy matching for better filtering
    const filtered = query
      ? folders.filter((f) => fuzzyMatch(query, f.label) !== null)
      : folders;

    return filtered.map((folder) => ({
      id: `folder-${folder.path}`,
      type: 'folder' as MentionType,
      label: folder.label,
      description: folder.path,
      icon: '📁',
      uri: `devspace://folder/${encodeURIComponent(folder.path)}`,
      meta: {
        path: folder.path,
        relativePath: folder.path,
      },
    }));
  }
}

// Note Provider
export class NoteProvider implements Provider {
  id = 'note';
  triggers = ['@note', '@n'];
  supportsRanges = true;

  // Cache for synchronous access
  private cachedNotes: MentionCandidate[] = [];
  private lastCacheUpdate: number = 0;
  private cacheTimeout: number = 5000; // 5 seconds

  /**
   * Get sibling workspaces (workspaces in the same repository)
   */
  private async getSiblingWorkspaces(
    currentWorkspaceId: string | undefined,
  ): Promise<Workspace[]> {
    // Guard: return empty if workspaceId is undefined
    if (!currentWorkspaceId) {
      return [];
    }

    try {
      const { invoke } = await import('$lib/electron-bridge');

      // Get current workspace to find its repository path
      const currentWorkspace = await invoke<Workspace | null>('workspace:get', {
        id: currentWorkspaceId,
      });

      if (!currentWorkspace || !currentWorkspace.repositoryPath) {
        return [];
      }

      // Get all workspaces
      const allWorkspaces = await invoke<Workspace[]>('workspace:list', {});

      // Filter to only workspaces with the same repository path (excluding current)
      return allWorkspaces.filter(
        (w: Workspace) =>
          w.id !== currentWorkspaceId && w.repositoryPath === currentWorkspace.repositoryPath,
      );
    } catch (error) {
      logger.debug('[NoteProvider] Failed to get sibling workspaces:', error);
      return [];
    }
  }

  /**
   * Fetch notes from a specific workspace
   */
  private async fetchNotesFromWorkspace(
    workspaceId: string,
  ): Promise<Array<{ note: any; workspaceId: string; workspaceTitle?: string }>> {
    try {
      const { invoke } = await import('$lib/electron-bridge');
      const result = await invoke<import('$shared/types').CommandResponse<any[]>>('notes:list', {
        workspaceId,
      });

      if (result && result.success && result.data && Array.isArray(result.data)) {
        // Get workspace title for context via IPC
        const workspace = await invoke<Workspace | null>('workspace:get', {
          id: workspaceId,
        });
        const workspaceTitle = workspace?.title;

        return result.data.map((note: any) => ({
          note,
          workspaceId,
          workspaceTitle,
        }));
      }
    } catch (error) {
      logger.debug(`[NoteProvider] Failed to fetch notes from workspace ${workspaceId}:`, error);
    }
    return [];
  }

  async search(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    // Guard: return empty if workspaceId is undefined
    if (!context.workspaceId) {
      return [];
    }

    try {
      // Fetch notes from current workspace
      const currentWorkspaceNotes = await this.fetchNotesFromWorkspace(context.workspaceId);

      // Fetch notes from sibling workspaces
      const siblingWorkspaces = await this.getSiblingWorkspaces(context.workspaceId);
      const siblingNotesPromises = siblingWorkspaces.map((ws) =>
        this.fetchNotesFromWorkspace(ws.id),
      );
      const siblingNotesResults = await Promise.all(siblingNotesPromises);
      const siblingNotes = siblingNotesResults.flat();

      // Combine all notes
      const allNotesWithContext = [...currentWorkspaceNotes, ...siblingNotes];

      // Filter and map to MentionCandidate using fuzzy matching
      const notes = allNotesWithContext
        .filter(
          ({ note }) =>
            !query ||
            (note.title && fuzzyMatch(query, note.title) !== null) ||
            (note.content && fuzzyMatch(query, note.content) !== null),
        )
        .slice(0, 10)
        .map(({ note, workspaceId, workspaceTitle }) => {
          const isCurrentWorkspace = workspaceId === context.workspaceId;
          const subtitle = isCurrentWorkspace
            ? undefined
            : `From: ${workspaceTitle || workspaceId}`;

          return {
            id: note.id || `note-${note.id}`,
            type: 'note' as MentionType,
            label: note.title || note.id || 'Untitled Note',
            subtitle,
            description: `${note.content?.substring(0, 100)}...` || '',
            icon: '📝',
            uri: `devspace://note/${note.id}`,
            meta: {
              preview: note.content?.substring(0, 200) || '',
              workspaceId,
            },
          };
        });

      // Update cache
      this.cachedNotes = notes;
      this.lastCacheUpdate = Date.now();

      // If we got notes, return them; otherwise fall through to fallback
      if (notes.length > 0) {
        return notes;
      }
    } catch (error) {
      logger.debug('[NoteProvider] Failed to fetch notes:', error);
    }

    // Return cached notes if available
    if (this.cachedNotes.length > 0) {
      return this.cachedNotes.filter(
        (n) =>
          !query ||
          fuzzyMatch(query, n.label) !== null ||
          (n.description && fuzzyMatch(query, n.description) !== null),
      );
    }

    // Fallback to default notes
    const defaultNotes = [
      { id: 'spec', label: 'spec', description: 'Space specification' },
      { id: 'plan', label: 'plan', description: 'Implementation plan' },
      { id: 'notes', label: 'notes', description: 'General notes' },
    ];

    return defaultNotes
      .filter((n) => !query || fuzzyMatch(query, n.label) !== null)
      .map((note) => ({
        id: note.id,
        type: 'note' as MentionType,
        label: note.label,
        description: note.description,
        icon: '📝',
        uri: `devspace://note/${note.id}`,
        meta: {},
      }));
  }

  // Method for synchronous access
  getCachedNotes(): MentionCandidate[] {
    const now = Date.now();
    if (now - this.lastCacheUpdate > this.cacheTimeout) {
      // Cache expired, return default notes
      return [
        {
          id: 'spec',
          type: 'note' as MentionType,
          label: 'spec',
          description: 'Space specification',
          icon: '📝',
          uri: 'devspace://note/spec',
          meta: {},
        },
        {
          id: 'plan',
          type: 'note' as MentionType,
          label: 'plan',
          description: 'Implementation plan',
          icon: '📝',
          uri: 'devspace://note/plan',
          meta: {},
        },
      ];
    }
    return this.cachedNotes;
  }
}

// External Source Provider
export class ExternalSourceProvider implements Provider {
  id = 'external';
  triggers = ['@docs', '@external'];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async search(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    const sources = [
      {
        id: 'react-docs',
        label: 'React Documentation',
        url: 'https://react.dev',
        description: 'Official React documentation',
      },
      {
        id: 'mdn',
        label: 'MDN Web Docs',
        url: 'https://developer.mozilla.org',
        description: 'Web technology documentation',
      },
      {
        id: 'typescript',
        label: 'TypeScript Handbook',
        url: 'https://www.typescriptlang.org/docs/',
        description: 'TypeScript documentation',
      },
    ];

    return sources
      .filter((s) => !query || fuzzyMatch(query, s.label) !== null)
      .map((source) => ({
        id: `external-${source.id}`,
        type: 'external-source' as MentionType,
        label: source.label,
        description: source.description,
        icon: '📚',
        uri: `devspace://external/${source.id}`,
        meta: {
          url: source.url,
        },
      }));
  }
}

// Rule Provider
export class RuleProvider implements Provider {
  id = 'rule';
  triggers = ['@rule', '@augment'];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async search(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    const rules = [
      { path: '.augment/rules/cli.md', label: 'CLI Rules' },
      { path: '.augment/rules/frontend.md', label: 'Frontend Rules' },
      { path: '.augment/rules/python.md', label: 'Python Rules' },
      { path: '.augment/rules/sidecar.md', label: 'Sidecar Rules' },
      { path: '.augment/rules/systems.md', label: 'Systems Rules' },
    ];

    return rules
      .filter((r) => !query || fuzzyMatch(query, r.label) !== null)
      .map((rule) => ({
        id: rule.path,
        type: 'rule' as MentionType,
        label: rule.label,
        subtitle: rule.path,
        icon: '📚',
        uri: `devspace://rule/${encodeURIComponent(rule.path)}`,
        meta: {
          path: rule.path,
        },
      }));
  }
}

// Task Provider
export class TaskProvider implements Provider {
  id = 'task';
  triggers = ['@task', '@todo'];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async search(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    const tasks = [
      {
        id: 'task-1',
        label: 'Implement authentication',
        status: 'in_progress' as const,
        assignee: 'John Doe',
      },
      {
        id: 'task-2',
        label: 'Write tests',
        status: 'not_started' as const,
        assignee: 'Jane Smith',
      },
      {
        id: 'task-3',
        label: 'Deploy to production',
        status: 'completed' as const,
        assignee: 'Bob Johnson',
      },
    ];

    return tasks
      .filter((t) => !query || fuzzyMatch(query, t.label) !== null)
      .map((task) => ({
        id: `task-${task.id}`,
        type: 'task' as MentionType,
        label: task.label,
        subtitle: `${task.status} • ${task.assignee}`,
        icon: '📋',
        uri: `devspace://task/${task.id}`,
        meta: {
          taskStatus: task.status,
          assignee: task.assignee,
        },
      }));
  }
}

// Personality Provider
export class PersonalityProvider implements Provider {
  id = 'personality';
  triggers = ['@personality', '@persona'];

  private personalities = [
    {
      id: 'auggie-personality-agent-default',
      name: 'Agent Auggie',
      description: 'Default helpful AI assistant',
      icon: '🤖',
      temperature: 0.7,
      model: 'default',
      promptToken: 'auggie-personality-agent-default',
    },
    {
      id: 'auggie-personality-prototyper',
      name: 'Prototyper Auggie',
      description: 'Specialized in rapid prototyping',
      icon: '⚡',
      temperature: 0.7,
      model: 'default',
      promptToken: 'auggie-personality-prototyper',
    },
    {
      id: 'auggie-personality-brainstorm',
      name: 'Brainstorm Auggie',
      description: 'Creative ideation and exploration',
      icon: '💡',
      temperature: 0.7,
      model: 'default',
      promptToken: 'auggie-personality-brainstorm',
    },
    {
      id: 'auggie-personality-reviewer',
      name: 'Reviewer Auggie',
      description: 'Code review and feedback',
      icon: '🔍',
      temperature: 0.7,
      model: 'default',
      promptToken: 'auggie-personality-reviewer',
    },
  ];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async search(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    return this.personalities
      .filter((p) => !query || fuzzyMatch(query, p.name) !== null)
      .map((personality) => ({
        id: personality.id,
        type: 'personality' as MentionType,
        label: personality.name,
        subtitle: `${personality.model}`,
        description: personality.description,
        icon: personality.icon,
        uri: `devspace://personality/${personality.id}`,
        meta: { promptToken: personality.promptToken },
      }));
  }
}

// Command Provider (for special commands)
export class CommandProvider implements Provider {
  id = 'command';
  triggers = ['@cmd', '@command'];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async search(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    const commands = [
      SPECIAL_MENTIONS.USE_DEFAULT_CONTEXT,
      SPECIAL_MENTIONS.CLEAR_CONTEXT,
      SPECIAL_MENTIONS.AGENT_MEMORIES,
    ];

    return commands.filter(
      (cmd) => !query || cmd.label.toLowerCase().includes(query.toLowerCase()),
    );
  }
}

// Terminal Provider
export class TerminalProvider implements Provider {
  id = 'terminal';
  triggers = ['@terminal', '@term'];

  async search(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    try {
      const { terminalManager } = await import('$features/terminal/terminal-manager.svelte');
      const { selectTerminals, selectTerminalDisplayName } = await import('$lib/store/slices/terminals/terminals-selectors');
      const store = appStore;
      const state = store.state;

      if (!context.workspaceId) {
        return [];
      }

      // Get terminals from the overlay store (these are the visible terminal tabs)
      const terminalTabs = selectTerminals.select(state);

      // Also load metadata for terminals that might not be in tabs yet
      const storedMetadata = terminalManager.loadTerminalMetadata(context.workspaceId);

      // Merge: use tabs as primary, fill in from metadata
      const seen = new Set<string>();
      const allTerminals: Array<{ id: string; name: string }> = [];

      for (const tab of terminalTabs) {
        seen.add(tab.id);
        allTerminals.push({
          id: tab.id,
          name: selectTerminalDisplayName.select(state, tab.id),
        });
      }

      for (const meta of storedMetadata) {
        if (!seen.has(meta.terminalId)) {
          seen.add(meta.terminalId);
          allTerminals.push({
            id: meta.terminalId,
            name: meta.title || 'Terminal',
          });
        }
      }

      if (allTerminals.length === 0) {
        return [];
      }

      // Filter by query using fuzzy matching
      // If the query matches the trigger words (terminal, term), show all terminals
      const triggerWords = ['terminal', 'term'];
      const isTypingTrigger = query
        ? triggerWords.some(
            (t) => t.startsWith(query.toLowerCase()) || query.toLowerCase().startsWith(t),
          )
        : false;
      const filtered =
        query && !isTypingTrigger
          ? allTerminals.filter((t) => fuzzyMatch(query, t.name) !== null)
          : allTerminals;

      return filtered.slice(0, 10).map((terminal, index) => ({
        id: terminal.id,
        type: 'terminal' as MentionType,
        label: terminal.name,
        subtitle: `Terminal ${index + 1}`,
        description: 'Include terminal output in context',
        icon: '💻',
        uri: `devspace://terminal/${encodeURIComponent(terminal.id)}`,
        meta: {
          workspaceId: context.workspaceId,
        },
      }));
    } catch (error) {
      logger.debug('[TerminalProvider] Failed to get terminals:', error);
      return [];
    }
  }
}

// Script Provider
export class ScriptProvider implements Provider {
  id = 'script';
  triggers = ['@script', '@scripts'];

  async search(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    try {
      const { selectScriptEntries } = await import('$lib/store/slices/scripts/scripts-selectors');

      if (!context.workspaceId) {
        return [];
      }

      const scripts = selectScriptEntries.select(appStore.state);
      if (scripts.length === 0) {
        return [];
      }

      const triggerWords = ['script', 'scripts'];
      const isTypingTrigger = query
        ? triggerWords.some(
            (t) => t.startsWith(query.toLowerCase()) || query.toLowerCase().startsWith(t),
          )
        : false;
      const filtered =
        query && !isTypingTrigger
          ? scripts.filter(
              (s) =>
                fuzzyMatch(query, s.name) !== null || fuzzyMatch(query, s.command) !== null,
            )
          : scripts;

      return filtered.slice(0, 10).map((script) => {
        const status = script.runtime.status;
        const statusLabel =
          status === 'running' ? '● Running' : status === 'exited' ? '○ Exited' : '○ Idle';
        return {
          id: script.id,
          type: 'script' as MentionType,
          label: script.name,
          subtitle: `${statusLabel} · ${script.command}`,
          description: 'Include script output in context',
          icon: '▶️',
          uri: `devspace://script/${encodeURIComponent(script.id)}`,
          meta: {
            workspaceId: context.workspaceId,
            command: script.command,
            status:
              status === 'running'
                ? ('ok' as const)
                : status === 'exited'
                  ? ('warning' as const)
                  : undefined,
          },
        };
      });
    } catch (error) {
      logger.debug('[ScriptProvider] Failed to get scripts:', error);
      return [];
    }
  }
}

// Specialist Provider - lists available specialist types
export class SpecialistProvider implements Provider {
  id = 'specialist';
  triggers = ['@specialist', '@spec'];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async search(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    try {
      const specialists = selectSpecialists.select(appStore.state);
      if (!specialists || specialists.length === 0) {
        return [];
      }

      return specialists
        .filter((s) => {
          if (!query) return true;
          return (
            fuzzyMatch(query, s.name) !== null ||
            fuzzyMatch(query, s.id) !== null ||
            fuzzyMatch(query, s.description) !== null ||
            fuzzyMatch(query, 'specialist') !== null
          );
        })
        .map((specialist) => ({
          id: `specialist-${specialist.id}`,
          type: 'specialist' as MentionType,
          label: specialist.name,
          subtitle: specialist.description,
          description: specialist.description,
          icon: '👤',
          uri: `devspace://specialist/${encodeURIComponent(specialist.id)}`,
          group: 'Specialists',
          score: 0.8, // Baseline score so results survive SearchService applyFuzzyMatching filter
          meta: {
            promptToken: `specialist/${specialist.id}`,
          },
        }))
        .slice(0, 10);
    } catch (error) {
      logger.debug('[SpecialistProvider] Failed to get specialists:', error);
      return [];
    }
  }
}

// Agent Provider - lists other agents in the workspace
export class AgentProvider implements Provider {
  id = 'agent';
  triggers = ['@agent'];

  async search(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    try {
      const { selectAllWorkspaceAgents } = await import(
        '$lib/store/slices/workspace-agents/workspace-agents-selectors'
      );
      const workspaceId = context.workspaceId;
      if (!workspaceId) {
        return [];
      }

      const allAgents = selectAllWorkspaceAgents.select(appStore.state, workspaceId);
      if (allAgents.length === 0) {
        return [];
      }

      const agents: MentionCandidate[] = [];
      for (const session of allAgents) {
        const agentId = session.id;

        const name = session.name || agentId;
        // Check session.metadata for specialist info
        const specialistId =
          (session.metadata as any)?.specialist ||
          '';
        // Look up specialist name: try session metadata first, then resolve from store
        let specialistName = (session.metadata as any)?.specialistName || '';
        if (specialistId && !specialistName) {
          const info = selectSpecialistById.select(appStore.state, specialistId);
          if (info) {
            specialistName = info.name;
          }
        }

        // Filter by query using fuzzy matching against name, the keyword "agent", and specialist type
        if (query) {
          const matchesName = fuzzyMatch(query, name) !== null;
          const matchesAgent = fuzzyMatch(query, 'agent') !== null;
          const matchesSpecialist = specialistName && fuzzyMatch(query, specialistName) !== null;
          const matchesSpecialistId = specialistId && fuzzyMatch(query, specialistId) !== null;
          if (!matchesName && !matchesAgent && !matchesSpecialist && !matchesSpecialistId) {
            continue;
          }
        }

        const statusLabel = session.isStreaming
          ? 'responding'
          : session.status || 'active';

        // Build subtitle with specialist, status, message count, and recency
        const subtitleParts: string[] = [];
        if (specialistName) {
          subtitleParts.push(specialistName);
        } else {
          subtitleParts.push('Agent');
        }
        subtitleParts.push(statusLabel);

        const messageCount = session.messages?.length || 0;
        if (messageCount > 0) {
          subtitleParts.push(`${messageCount} msg${messageCount !== 1 ? 's' : ''}`);
        }

        const lastActive = (session as any).lastActivity || (session as any).lastModified;
        if (lastActive && !session.isStreaming) {
          subtitleParts.push(formatRelativeTimeCompact(new Date(lastActive)));
        }

        agents.push({
          id: agentId,
          type: 'agent' as MentionType,
          label: name,
          subtitle: subtitleParts.join(' · '),
          description: specialistName
            ? `${specialistName} agent in this workspace`
            : `Agent in this workspace`,
          icon: '🤖',
          uri: `devspace://agent/${encodeURIComponent(agentId)}`,
          group: 'Agents',
          score: 0.7,
          meta: {
            workspaceId,
          },
        } as MentionCandidate);
      }

      return agents.slice(0, 10);
    } catch (error) {
      logger.debug('[AgentProvider] Failed to get agents:', error);
      return [];
    }
  }
}

// Provider Registry
export class ProviderRegistry {
  private providers = new Map<string, Provider>();
  private defaultProviders: string[] = [];

  constructor() {
    // Register default providers
    this.register(new FileProvider());
    this.register(new FolderProvider());
    this.register(new NoteProvider());
    this.register(new ExternalSourceProvider());
    this.register(new RuleProvider());
    this.register(new TaskProvider());
    this.register(new PersonalityProvider());
    this.register(new CommandProvider());
    this.register(new TerminalProvider());
    this.register(new ScriptProvider());
    this.register(new AgentProvider());
    this.register(new SpecialistProvider());

    // Set default providers
    this.defaultProviders = ['file', 'folder', 'note', 'terminal', 'script', 'agent', 'specialist'];
  }

  register(provider: Provider) {
    this.providers.set(provider.id, provider);
    logger.debug('[ProviderRegistry] Registered provider:', provider.id);
  }

  unregister(id: string) {
    this.providers.delete(id);
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  getAll(): Provider[] {
    return Array.from(this.providers.values());
  }

  getDefault(): Provider[] {
    return this.defaultProviders.map((id) => this.providers.get(id)).filter(Boolean) as Provider[];
  }

  getByTrigger(trigger: string): Provider[] {
    return Array.from(this.providers.values()).filter((p) => p.triggers?.includes(trigger));
  }

  async searchAll(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    const providers = query.startsWith('@')
      ? this.getByTrigger(query.split(' ')[0])
      : this.getDefault();

    const results = await Promise.all(providers.map((p) => p.search(query, context)));

    return results.flat();
  }
}

// Export singleton instance
export const providerRegistry = new ProviderRegistry();
