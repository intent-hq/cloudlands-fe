import { workspaceStore } from '$features/workspace/workspace.store.svelte';
import { autoUpdateStore } from '$features/auto-update/auto-update.store.svelte';
import type { DeepLinkAction } from './deep-link-handler';
import { Logger } from '$shared/logger';
import { WorkspaceId } from '$shared/types/branded-ids';

interface DeepLinkState {
  pendingAction: DeepLinkAction | null;
  processing: boolean;
  error: string | null;
}

const logger = new Logger('DeepLinkStore');

class DeepLinkStore {
  #state = $state<DeepLinkState>({
    pendingAction: null,
    processing: false,
    error: null,
  });

  constructor() {
    // Listen for deep link events from main process
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      (window as any).electronAPI.on('deep-link', (action: DeepLinkAction) => {
        logger.debug('Received deep link action:', { action });
        this.handleDeepLink(action);
      });
    }
  }

  get pendingAction(): DeepLinkAction | null {
    return this.#state.pendingAction;
  }

  get processing(): boolean {
    return this.#state.processing;
  }

  get error(): string | null {
    return this.#state.error;
  }

  private async handleDeepLink(action: DeepLinkAction) {
    this.#state = {
      ...this.#state,
      pendingAction: action,
      processing: true,
      error: null,
    };

    try {
      switch (action.type) {
        case 'open':
          await this.handleOpenWorkspace(action.params);
          break;
        case 'create':
          await this.handleCreateWorkspace(action.params);
          break;
        case 'clone':
          await this.handleCloneRepository(action.params);
          break;
        case 'settings':
          await this.handleSettings(action.params);
          break;
        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }
    } catch (error) {
      logger.error('Error handling deep link:', error as Error);
      this.#state = {
        ...this.#state,
        error: error instanceof Error ? error.message : 'Failed to handle deep link',
        processing: false,
      };
    }
  }

  private async handleOpenWorkspace(params: Record<string, string>) {
    const { id } = params;

    if (!id) {
      throw new Error('Workspace ID is required');
    }

    // Validate workspace exists
    const result = await (window as any).electronAPI.invoke('deep-link:validate-workspace', { id });
    if (!result.success || !result.exists) {
      throw new Error(`Workspace ${id} not found`);
    }

    // Open the workspace (navigation will be handled by component)
    await workspaceStore.open(WorkspaceId(id));

    this.#state = { ...this.#state, pendingAction: null, processing: false };
  }

  private async handleCreateWorkspace(params: Record<string, string>) {
    // Always navigate to the create modal with pre-filled params
    // Let the user configure branch, worktree, environment, etc. before creating
    this.navigateToCreateModal(params);
  }

  private async handleCloneRepository(params: Record<string, string>) {
    // Clone is similar to create but specifically for GitHub repos
    const { repo, title } = params;

    if (!repo) {
      throw new Error('Repository URL is required for clone action');
    }

    // Treat clone as create with GitHub URL
    await this.handleCreateWorkspace({
      ...params,
      title: title || `Clone of ${repo.split('/').pop()?.replace('.git', '')}`,
    });
  }

  private async handleSettings(params: Record<string, string>) {
    const { beta } = params;
    const enableBeta = beta === 'true';
    const channel = enableBeta ? 'beta' : 'stable';

    try {
      await autoUpdateStore.setChannel(channel);
    } catch {
      // Show error toast and bail out
      import('svelte-sonner')
        .then(({ toast }) => {
          toast.error('Failed to switch update channel');
        })
        .catch(() => {
          // Toast not available - not critical
        });
      this.#state = { ...this.#state, pendingAction: null, processing: false };
      return;
    }

    // Show a toast confirming the channel switch (session-only)
    import('svelte-sonner')
      .then(({ toast }) => {
        if (enableBeta) {
          toast.success('Beta updates enabled for this session');
        } else {
          toast.success('Switched to stable update channel for this session');
        }
      })
      .catch(() => {
        // Toast not available - not critical
      });

    // Trigger an update check after switching channel
    await autoUpdateStore.checkForUpdates();

    this.#state = { ...this.#state, pendingAction: null, processing: false };
  }

  private navigateToCreateModal(params: Record<string, string>) {
    // Store the params for the create modal to use
    this.#state = {
      ...this.#state,
      pendingAction: { type: 'create', params },
      processing: false,
    };

    // Navigation to home page will be handled by component
  }

  clearPendingAction(): void {
    this.#state = { ...this.#state, pendingAction: null };
  }

  getPendingAction(): DeepLinkAction | null {
    return this.#state.pendingAction;
  }

  // Generate a shareable deep link for a workspace
  generateLink(workspaceId: string): string {
    return `intent://open?id=${workspaceId}`;
  }

  // Generate a create link with parameters
  generateCreateLink(params: {
    title?: string;
    repo?: string;
    branch?: string;
    spec?: string;
  }): string {
    const searchParams = new URLSearchParams();
    if (params.title) searchParams.set('title', params.title);
    if (params.repo) searchParams.set('repo', params.repo);
    if (params.branch) searchParams.set('branch', params.branch);
    if (params.spec) searchParams.set('spec', params.spec);

    return `intent://create?${searchParams.toString()}`;
  }
}

export const deepLinkStore = new DeepLinkStore();
