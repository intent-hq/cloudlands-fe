/** Side effects the command palette runs for a picked row. */
import { goto } from '$app/navigation';
import { faFile } from '@fortawesome/free-solid-svg-icons';
import { openDevConsole } from '$features/dev-console/dev-console-client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { dispatchWindowEvent } from '$lib/utils/window-events';
import { navigateToSettings } from '$lib/utils/workspace-navigation';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { store as appStore } from '$store/renderer/store';
import { commandPaletteNewFileRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { fuzzyScore } from '$store/renderer/slices/command-palette/command-palette-utils';
import { WORKSPACE_PREFILL_KEY } from '$store/renderer/slices/deep-links/utils/deep-link-workspace';
import { createNoteRequested } from '$store/renderer/slices/note-read-tracking/note-read-tracking-slice';
import {
  resetOnboarding,
  setOnboardingFullFlowRequested,
} from '$store/renderer/slices/onboarding/onboarding-slice';
import {
  selectPrincipalActionContext,
  selectWorkspaceCreationVisible,
} from '$store/renderer/slices/principal/principal-selectors';
import {
  setShowCreateModal,
  setStatsOverlayOpen,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { createTerminalRequested } from '$store/renderer/slices/terminals/terminals-slice';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { prefillForRepo } from '$store/renderer/slices/workspace-initializer/utils/known-repos';
import type { WorkspaceInitializerRecentRepo } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';
import { createAgentRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { openWorkspaceBrowser } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import { runLabCommand } from './command-palette-labs';

const logger = createLogger('CommandPalette');

type SettingsTab = NonNullable<Parameters<typeof navigateToSettings>[0]>['tab'];

export interface PaletteCommandContext {
  commands: ReadonlyArray<{ id: string; settingsTab?: SettingsTab }>;
  workspaceId: string | undefined;
  hidesAgentLifecycleActions: boolean;
  isCollaborator: boolean;
}

/** Run a palette command; returns false when the palette must stay open. */
export function runPaletteCommand(commandId: string, context: PaletteCommandContext): boolean {
  const { workspaceId, isCollaborator } = context;
  const settingsCommand = context.commands.find((command) => command.id === commandId);
  if (settingsCommand && 'settingsTab' in settingsCommand) {
    appStore.dispatch(setShowCreateModal(false));
    navigateToSettings({ tab: settingsCommand.settingsTab });
    return true;
  }
  if (runLabCommand(commandId)) return true;
  switch (commandId) {
    case 'new-workspace':
      if (selectWorkspaceCreationVisible.select(appStore.state)) {
        appStore.dispatch(setShowCreateModal(true));
      }
      return true;
    case 'settings':
      appStore.dispatch(setShowCreateModal(false));
      navigateToSettings();
      return true;
    case 'enable-experimental-remote-agents':
      appStore.dispatch(setLabsRemoteAgentsEnabled(true));
      return true;
    case 'disable-experimental-remote-agents':
      appStore.dispatch(setLabsRemoteAgentsEnabled(false));
      return true;
    case 'new-agent':
      if (workspaceId && !context.hidesAgentLifecycleActions) {
        appStore.dispatch(createAgentRequested(workspaceId));
      }
      return true;
    case 'new-terminal':
      if (workspaceId && !isCollaborator) appStore.dispatch(createTerminalRequested(workspaceId));
      return true;
    case 'new-note':
      if (workspaceId) appStore.dispatch(createNoteRequested(workspaceId));
      return true;
    case 'new-file':
      if (workspaceId) appStore.dispatch(commandPaletteNewFileRequested(workspaceId));
      return true;
    case 'open-url':
      // Open a browser panel with default URL
      if (workspaceId && !isCollaborator) {
        appStore.dispatch(openWorkspaceBrowser(workspaceId, 'about:blank'));
      }
      return true;
    case 'show-onboarding':
      // Explicit restart: request the full flow so OnboardingPage's
      // initial-step decision never skips ahead on setup state.
      appStore.dispatch(setOnboardingFullFlowRequested(true));
      appStore.dispatch(
        resetOnboarding(selectPrincipalActionContext.select(appStore.state) ?? undefined),
      );
      goto('/workspace/new');
      return true;
    case 'enhance-prompt':
      dispatchWindowEvent('chat:enhance-prompt');
      return true;
    case 'attach-context':
      dispatchWindowEvent('chat:attach-context');
      return true;
    case 'attach-files':
      dispatchWindowEvent('chat:attach-files');
      return true;
    case 'open-dev-console':
      void openDevConsole();
      return true;
    case 'open-hud':
      void invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, { route: '/hud' });
      return true;
    case 'open-usage-stats':
      appStore.dispatch(setStatsOverlayOpen(true));
      return true;
    default:
      return true;
  }
}

/** Open New Workspace with `repo` selected; nothing is created until the user submits. */
export function openRepoInNewWorkspace(
  repo: WorkspaceInitializerRecentRepo,
  gitlabInstance: string | undefined,
): void {
  if (!selectWorkspaceCreationVisible.select(appStore.state)) return;
  try {
    sessionStorage.setItem(
      WORKSPACE_PREFILL_KEY,
      JSON.stringify(prefillForRepo(repo, gitlabInstance)),
    );
  } catch (error) {
    logger.warn('Failed to store the New Workspace repo prefill', { error });
  }
  appStore.dispatch(setShowCreateModal(true));
}

/** Daemon file-name search (search.fileNames, PROTOCOL §5.15) mapped to palette rows, top 8. */
export async function queryPaletteFiles(
  pattern: string,
  workspaceId: string,
  fileMru: Record<string, number>,
): Promise<any[]> {
  try {
    const resp = await backendRequest<{ files?: string[] }>('search.fileNames', {
      workspaceId,
      pattern: (pattern || '').trim(),
      limit: 50,
    });
    const files = Array.isArray(resp?.files) ? resp.files : [];
    const mru = (path: string) => fileMru[path] || 0;
    const mapped = files.map((path: string) => ({
      id: path,
      label: path.split('/').pop() ?? path,
      path,
      icon: faFile,
      description: path,
    }));
    const q = (pattern || '').trim();
    if (!q) return mapped.sort((a, b) => mru(b.path) - mru(a.path)).slice(0, 8);
    return mapped
      .map((file) => ({ file, score: fuzzyScore(`${file.label} ${file.description}`, q) }))
      .filter(({ score }) => score !== -Infinity)
      .sort((a, b) => b.score - a.score || mru(b.file.path) - mru(a.file.path))
      .map(({ file }) => file)
      .slice(0, 8);
  } catch (error) {
    logger.error('Failed to list workspace files:', error);
    return [];
  }
}
