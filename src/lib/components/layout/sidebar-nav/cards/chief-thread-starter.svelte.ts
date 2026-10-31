import { onDestroy } from 'svelte';
import { fromStore, type Readable } from 'svelte/store';
import { m } from '$shared/paraglide/messages.js';
import { createAgentTypeId } from '$shared/types/agent.types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  buildChiefBehaviorPrompt,
  CHIEF_PROMPT_VERSION,
  CHIEF_SPECIALIST_ID,
} from '$shared/chief-agent-config';
import { store as appStore } from '$store/renderer/store';
import { setChiefActiveAgentId } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { selectReusableChiefThread } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
import {
  clearAgentCreationOutcome,
  createAgentFromConfigRequested,
  setActiveAgentId,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import type { selectAgentCreationOutcome } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
import { selectContextSelectedModel } from '$store/renderer/slices/provider-catalog/workspace-catalog-selectors';
import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import {
  selectEffectiveBehaviorPrompt,
  selectSpecialists,
} from '$store/renderer/slices/specialists/specialists-selectors';
import { formatChiefThreadName } from './chief-thread-name';

export const CHIEF_THREAD_RESOURCE_ID = 'chief-thread';

/**
 * Starts Assistant threads for one component. Call during component init with
 * the component's `selectAgentCreationOutcome(consumerId, CHIEF_WORKSPACE_ID,
 * CHIEF_THREAD_RESOURCE_ID)` readable. Every starter shares one creation
 * resource, so concurrent requests from the sidebar and the auto-start
 * coalesce into a single new thread.
 */
export function createChiefThreadStarter(
  consumerId: string,
  creationOutcome: Readable<ReturnType<typeof selectAgentCreationOutcome.select>>,
) {
  const consumer = { id: consumerId, resourceId: CHIEF_THREAD_RESOURCE_ID };
  const outcome = fromStore(creationOutcome);
  const pending = $derived(outcome.current?.status === 'pending');
  onDestroy(() => appStore.dispatch(clearAgentCreationOutcome(consumer.id)));

  /** Selects the latest blank thread, or requests a new one. Returns the reused thread id. */
  function start(): string | null {
    if (pending) return null;
    const state = appStore.state;
    // Reuse only blank threads created with the current Chief identity contract.
    // A system prompt is fixed at agent creation, so selecting an older blank
    // thread would silently preserve its stale generic-agent identity.
    const emptyThread = selectReusableChiefThread.select(state);
    if (emptyThread) {
      appStore.dispatch(setChiefActiveAgentId(emptyThread.agentId));
      appStore.dispatch(setActiveAgentId(CHIEF_WORKSPACE_ID, emptyThread.agentId));
      return emptyThread.agentId;
    }

    const chiefSpecialist = selectSpecialists
      .select(state)
      .find((specialist) => specialist.id === CHIEF_SPECIALIST_ID);
    const chiefBehaviorPrompt = buildChiefBehaviorPrompt(
      selectEffectiveBehaviorPrompt.select(state, CHIEF_SPECIALIST_ID),
    );
    appStore.dispatch(
      createAgentFromConfigRequested(
        CHIEF_WORKSPACE_ID,
        {
          workspaceId: CHIEF_WORKSPACE_ID,
          name: formatChiefThreadName(new Date()),
          // Generated timestamp name — keep the session self-renameable.
          nameExplicitlySet: false,
          model: selectContextSelectedModel.select(state, CHIEF_WORKSPACE_ID),
          provider: selectEffectiveDefaultProviderId.select(state, CHIEF_WORKSPACE_ID),
          agentType: createAgentTypeId('workspace'),
          source: 'chief-card',
          behaviorPrompt: chiefBehaviorPrompt,
          metadata: {
            source: 'chief-card',
            chiefWorkspace: true,
            chiefPromptVersion: CHIEF_PROMPT_VERSION,
            specialist: CHIEF_SPECIALIST_ID,
            specialistName: chiefSpecialist?.name ?? m.layout_chiefCard_title(),
            roleReminder: chiefSpecialist?.roleReminder,
            behaviorPrompt: chiefBehaviorPrompt,
          },
        },
        { openAgent: false, consumer },
      ),
    );
    return null;
  }

  return {
    get pending() {
      return pending;
    },
    start,
  };
}
