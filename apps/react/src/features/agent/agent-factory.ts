import { store } from '@/store';
import { AgentFactoryCore, type AgentFactoryRuntime } from '$shared/services/agent-factory-core';
import type { Workspace } from '$shared/types';
import type { UnifiedAgentConfig } from '$shared/types/agent.types';
import { selectWorkspaceActionContext } from '@/store/workspace/workspace-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import {
  selectActiveProviderId,
  selectAvailableEnabledProviderIds,
} from '@/store/provider-settings/provider-settings-selectors';
import { selectHasCheckedOnce } from '@/store/agent-availability/agent-availability-selectors';
import { selectIsHostMember } from '@/store/host-execution/host-execution-selectors';
import {
  addMessage,
  upsertSession,
  setAgentStreaming,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { backend } from '@/features/backend/backend-transport';
import { createBackendAgentCreator } from '$lib/client/live/backend-agent-creator';
const createAgent = createBackendAgentCreator(backend);
import {
  toImageReferenceBlocks,
  type WireImageBlock,
} from '$lib/client/live/image-attachment-placement';
import { placementApi } from './attachment-placement-runtime';

/** The same factory policy as the source renderer, with this app's admission and client. */
export const agentFactory = {
  createAgent(workspace: Workspace, config: UnifiedAgentConfig, key?: string) {
    const admission = () =>
      selectAdmittedWorkspaceReadContext.select(store.state, workspace.id)
        ? selectWorkspaceActionContext.select(store.state, workspace.id)
        : null;
    const context = admission();
    const current = () => !!context && admission() === context;
    const runtime: AgentFactoryRuntime = {
      isBackend: false,
      getPrincipalContext: admission,
      getActiveProviderId: () => selectActiveProviderId.select(store.state),
      getProviderAvailability: () => ({
        hasCheckedOnce: selectHasCheckedOnce.select(store.state),
        availableEnabledProviderIds: selectAvailableEnabledProviderIds.select(store.state),
      }),
      isHostMember: () => selectIsHostMember.select(store.state),
      // This connected route has no source panel/context owner. No invented panel metadata.
      getWorkspaceContext: async () => undefined,
      create: async (request, onDispatch) => {
        if (!current()) throw new Error('Agent creation ownership retired'); // i18n-ignore (internal retirement)
        const session = await createAgent(request, onDispatch);
        if (String(session.workspaceId) !== String(request.workspaceId))
          throw new Error('Created agent belongs to another workspace'); // i18n-ignore (protocol validation)
        return session;
      },
      sendMessage: (request) => backend.backendRequest('agent.sendMessage', request),
      toImageReferenceBlocks: async (workspaceId, blocks, isCurrent) =>
        toImageReferenceBlocks(
          workspaceId,
          blocks as WireImageBlock[],
          await placementApi(isCurrent),
          isCurrent,
        ),
      upsertSession: (session) => {
        if (current()) store.dispatch(upsertSession(session));
      },
      addMessage: (id, message) => {
        if (current()) store.dispatch(addMessage(id, message));
      },
      setAgentStreaming: (id, streaming) => {
        if (current()) store.dispatch(setAgentStreaming(id, streaming));
      },
    };
    return new AgentFactoryCore(runtime).createAgent(workspace, config, key);
  },
};
