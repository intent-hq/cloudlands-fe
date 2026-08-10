import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import { call, take } from 'typed-redux-saga';

import { isElectron } from '$lib/electron-bridge';
import { navigateToRoute } from '$lib/utils/navigation.client';

type AgentAuthRequiredEvent = {
  workspaceId?: string;
  agentId?: string;
  isRemote: boolean;
  host?: string;
  message: string;
};

type AgentPlanRequiredEvent = {
  workspaceId?: string;
  agentId?: string;
  message: string;
  helpUrl?: string;
};

type AgentEvent =
  | { kind: 'auth-required'; data?: AgentAuthRequiredEvent }
  | { kind: 'plan-required'; data?: AgentPlanRequiredEvent };

export function createAgentEventsChannel(): EventChannel<AgentEvent> {
  return eventChannel<AgentEvent>((emit) => {
    if (!isElectron() || typeof window === 'undefined' || !window.electronAPI?.on) return () => {};
    const listeners = [
      ['agent:auth-required', window.electronAPI.on('agent:auth-required', (data) => emit({ kind: 'auth-required', data }))],
      ['agent:plan-required', window.electronAPI.on('agent:plan-required', (data) => emit({ kind: 'plan-required', data }))],
    ] as const;
    return () => {
      for (const [channel, id] of listeners) window.electronAPI.offById(channel, id);
    };
  }, buffers.sliding(1_000));
}

async function showAgentEvent(event: AgentEvent): Promise<void> {
  try {
    if (!event.data) return;
    const data = event.data;
    const { toast } = await import('svelte-sonner');
    if (event.kind === 'plan-required') {
      toast.error('Intent: Plan Upgrade Required', {
        description: data.message,
        duration: 20_000,
      });
      return;
    }
    toast.warning('Agent Authentication Required', {
      description: data.message,
      duration: 15_000,
      action: {
        label: 'Open Terminal',
        onClick: () => {
          if (data.workspaceId) {
            void navigateToRoute(`/workspace/${data.workspaceId}?panel=terminal`);
          }
        },
      },
    });
  } catch {
    // Informational toast failures are intentionally non-fatal.
  }
}

export function* agentEventsIpcSaga() {
  if (!isElectron()) return;
  const channel = createAgentEventsChannel();
  try {
    while (true) {
      const event: AgentEvent = yield* take(channel);
      if (event === (END as unknown as AgentEvent)) break;
      yield* call(showAgentEvent, event);
    }
  } finally {
    channel.close();
  }
}