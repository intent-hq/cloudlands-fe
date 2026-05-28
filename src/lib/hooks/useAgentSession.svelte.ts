import { untrack } from 'svelte';
import {
  writable,
  type Readable,
} from 'svelte/store';


import type { AgentSession } from '$shared/types';
import { selectAgentSession } from '$lib/store/slices/agent-session/agent-session-selectors';

type AgentIdAccessor = () => string | null | undefined;

export function useAgentSession(agentId: AgentIdAccessor): Readable<AgentSession | undefined> {
  const agentIdStore = writable(untrack(() => agentId() ?? ''));

  $effect(() => {
    agentIdStore.set(agentId() ?? '');
  });

  return selectAgentSession(agentIdStore);
}
