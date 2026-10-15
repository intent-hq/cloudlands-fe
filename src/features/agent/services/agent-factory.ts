/**
 * Source renderer binding for the canonical agent factory.
 * Keeps UnifiedAgentFactory.getInstance()/agentFactory and its HMR lifetime for
 * existing source consumers. Remove this compatibility facade only after those
 * consumers have migrated to their own injected runtime binding.
 */
import { AgentFactoryCore, type AgentFactoryRuntime } from '$shared/services/agent-factory-core';
import type { Workspace } from '$shared/types';
import type { UnifiedAgentConfig } from '$shared/types/agent.types';
import { Logger } from '$shared/logger';
import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import {
  addMessage,
  setAgentStreaming,
  upsertSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { selectTopLevelContextItems } from '$store/renderer/slices/context/context-selectors';
import {
  selectActiveProviderId,
  selectAvailableEnabledProviderIds,
} from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import { selectHasCheckedOnce } from '$store/renderer/slices/agent-availability/agent-availability-selectors';
import { selectIsHostMember } from '$store/renderer/slices/host-execution/host-execution-selectors';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';

import { store as appStore } from '$store/renderer/store';

const logger = new Logger('UnifiedAgentFactory');

// Detect if we're running in the backend (Node.js) or frontend (browser)
const isBackend = typeof window === 'undefined';

async function getActiveProviderId(): Promise<string | null> {
  if (isBackend) return null;
  try {
    const store = appStore;
    return selectActiveProviderId.select(store.state);
  } catch {
    return null;
  }
}

export type { UnifiedAgentConfig, CreateAgentResult } from '$shared/types/agent.types';

async function getWorkspaceContext(
  workspace: Workspace,
): Promise<UnifiedAgentConfig['workspaceContext']> {
  const workspaceContext: {
    openPanels: Array<{ type: string; title: string; id?: string; path?: string }>;
    linkedReferences: Array<{
      type: string;
      title: string;
      identifier?: string;
      url?: string;
    }>;
  } = {
    openPanels: [],
    linkedReferences: [],
  };

  // Get open panels from panel layout manager
  // IMPORTANT: Only access the panel layout manager if it already exists in cache.
  // This prevents prematurely initializing the layout when creating an agent before
  // the workspace page is loaded. If we initialize the layout
  // here, it may load stale data from localStorage, causing duplicate tabs.
  try {
    const { getPanelLayoutManager, hasPanelLayoutManager } =
      await import('$features/layout/panel-layout-adapter');
    // Only access panel layout if the workspace page has already initialized it
    if (hasPanelLayoutManager(workspace.id)) {
      const layoutManager = getPanelLayoutManager(workspace.id);
      const allTabs = layoutManager.getAllTabs();
      workspaceContext.openPanels = allTabs
        .filter((tab) => tab.type !== 'agent') // Don't include agent tabs
        .map((tab) => ({
          type: tab.type,
          title: tab.title,
          id: tab.noteId || tab.terminalId || tab.agentId,
          path: tab.filePath || tab.browserUrl,
        }));
    } else {
      logger.debug(
        // i18n-ignore (log line)
        'Panel layout manager not yet initialized, skipping open panels context',
      );
    }
  } catch (error) {
    logger.debug('Could not load open panels', { error });
  }

  // Get linked references from context store (Redux)
  try {
    const topLevelItems = selectTopLevelContextItems.select(appStore.state, workspace.id);
    workspaceContext.linkedReferences = topLevelItems.map((item) => {
      let identifier: string | undefined;
      if (item.type === 'linear-issue') {
        identifier = (item as import('$features/context/types').LinearIssueContextItem).identifier;
      } else if (item.type === 'github-issue') {
        const ghItem = item as import('$features/context/types').GitHubIssueContextItem;
        identifier = `${ghItem.repo}#${ghItem.number}`;
      } else if (item.type === 'sentry-issue') {
        identifier = (item as import('$features/context/types').SentryIssueContextItem).shortId;
      }
      return {
        type: item.type,
        title: item.title,
        identifier,
        url: item.url,
      };
    });
  } catch (error) {
    logger.debug('Could not load linked references', { error });
  }

  // Only set if we have any context
  if (workspaceContext.openPanels.length > 0 || workspaceContext.linkedReferences.length > 0) {
    logger.debug('Workspace context loaded', {
      workspaceId: workspace.id,
      openPanelsCount: workspaceContext.openPanels.length,
      linkedReferencesCount: workspaceContext.linkedReferences.length,
    });
    return workspaceContext;
  }
}

const sourceRuntime: AgentFactoryRuntime = {
  isBackend,
  getPrincipalContext: () => selectPrincipalActionContext.select(appStore.state),
  getActiveProviderId,
  getProviderAvailability: () => ({
    hasCheckedOnce: selectHasCheckedOnce.select(appStore.state),
    availableEnabledProviderIds: selectAvailableEnabledProviderIds.select(appStore.state),
  }),
  isHostMember: () => selectIsHostMember.select(appStore.state),
  getWorkspaceContext,
  create: (request, onDispatch) => appClient.agents.create(request, onDispatch),
  sendMessage: (request) => backendRequest('agent.sendMessage', request),
  toImageReferenceBlocks: async (workspaceId, blocks, isCurrent) => {
    const { toImageReferenceBlocks } =
      await import('$lib/components/chat/input/image-attachment-placement');
    return toImageReferenceBlocks(
      workspaceId,
      blocks as import('$lib/components/chat/input/image-attachment-placement').WireImageBlock[],
      undefined,
      isCurrent,
    );
  },
  upsertSession: (agent) => appStore?.dispatch(upsertSession(agent)),
  addMessage: (agentId, message) => appStore?.dispatch(addMessage(agentId, message)),
  setAgentStreaming: (agentId, streaming) =>
    appStore?.dispatch(setAgentStreaming(agentId, streaming)),
};

const AGENT_FACTORY_HMR_KEY = '__agentFactory_hmr';

export class UnifiedAgentFactory extends AgentFactoryCore {
  private static instance: UnifiedAgentFactory;

  private constructor() {
    super(sourceRuntime);
  }

  static getInstance(): UnifiedAgentFactory {
    // Survive HMR: reuse instance stored on window if available.
    if (typeof window !== 'undefined' && (window as any)[AGENT_FACTORY_HMR_KEY]) {
      UnifiedAgentFactory.instance = (window as any)[AGENT_FACTORY_HMR_KEY];
      return UnifiedAgentFactory.instance;
    }
    if (!UnifiedAgentFactory.instance) {
      UnifiedAgentFactory.instance = new UnifiedAgentFactory();
      if (typeof window !== 'undefined') {
        (window as any)[AGENT_FACTORY_HMR_KEY] = UnifiedAgentFactory.instance;
      }
    }
    return UnifiedAgentFactory.instance;
  }
}

export const agentFactory = UnifiedAgentFactory.getInstance();
