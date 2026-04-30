import { untrack } from 'svelte';
import { writable, type Readable } from 'svelte/store';

import { selectAgentById } from '$lib/store/slices/workspace-agents/workspace-agents-selectors';
import type { AgentSession } from '$shared/types';

type AgentIdAccessor = () => string | null | undefined;

export function useAgentSession(agentId: AgentIdAccessor): Readable<AgentSession | undefined> {
  const agentIdStore = writable(untrack(() => agentId() ?? ''));

  $effect(() => {
    agentIdStore.set(agentId() ?? '');
  });

  return selectAgentById(agentIdStore);
}
