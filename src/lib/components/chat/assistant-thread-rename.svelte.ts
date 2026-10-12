import { onDestroy, tick, untrack } from 'svelte';
import { fromStore, type Readable } from 'svelte/store';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';
import type { ChiefThreadSummary } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
import {
  agentMutationUiConsumed,
  agentMutationUiReleased,
  agentMutationUiRequested,
} from '$store/renderer/slices/agent-mutation-ui/agent-mutation-ui-slice';
import type { selectAgentMutationUi } from '$store/renderer/slices/agent-mutation-ui/agent-mutation-ui-selectors';

export function createAssistantThreadRename(
  consumerId: string,
  mutation: Readable<ReturnType<typeof selectAgentMutationUi.select>>,
  hides: Readable<boolean>,
) {
  const outcome = fromStore(mutation);
  const hidesActions = fromStore(hides);
  let thread = $state<ChiefThreadSummary | null>(null);
  let name = $state('');
  let input = $state<HTMLInputElement | null>(null);
  let focusAfterSave = false;
  let attemptedName = '';
  let focusTitle = () => {};
  const busy = $derived(outcome.current?.status === 'pending');
  const error = $derived(
    thread && outcome.current?.status === 'failed'
      ? m.layout_chiefCard_renameThread_error()
      : undefined,
  );

  function consumeOutcome() {
    const current = outcome.current;
    if (current && current.status !== 'pending')
      appStore.dispatch(agentMutationUiConsumed(CHIEF_WORKSPACE_ID, consumerId, current.requestId));
  }

  async function finish(restoreFocus: boolean) {
    const restore = focusTitle;
    thread = null;
    consumeOutcome();
    if (restoreFocus) {
      await tick();
      restore();
    }
  }

  $effect(() => {
    if (thread && input) {
      untrack(() => {
        input?.focus();
        input?.select();
      });
    }
  });
  $effect(() => {
    if (!thread) return;
    if (outcome.current?.status === 'succeeded' || outcome.current?.status === 'cancelled') {
      void finish(focusAfterSave);
    } else if (outcome.current?.status === 'failed' && focusAfterSave) {
      input?.focus();
    }
    if (hidesActions.current) void finish(false);
  });
  onDestroy(() => appStore.dispatch(agentMutationUiReleased(CHIEF_WORKSPACE_ID, consumerId)));

  function start(nextThread: ChiefThreadSummary, restoreFocus: () => void) {
    if (busy || hidesActions.current) return;
    consumeOutcome();
    thread = nextThread;
    name = nextThread.title;
    attemptedName = '';
    focusAfterSave = false;
    focusTitle = restoreFocus;
  }

  function save(source: 'keyboard' | 'blur') {
    if (!thread || busy || hidesActions.current) return;
    const nextName = name.trim();
    if (!nextName || nextName === thread.title) {
      if (source === 'blur' || nextName === thread.title) void finish(source === 'keyboard');
      return;
    }
    if (source === 'blur' && outcome.current?.status === 'failed' && nextName === attemptedName)
      return;
    focusAfterSave = source === 'keyboard';
    attemptedName = nextName;
    appStore.dispatch(
      agentMutationUiRequested(
        CHIEF_WORKSPACE_ID,
        consumerId,
        crypto.randomUUID(),
        thread.agentId,
        {
          kind: 'rename',
          name: nextName,
        },
      ),
    );
  }

  function keydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      save('keyboard');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) void finish(true);
    }
  }

  return {
    get agentId() {
      return thread?.agentId;
    },
    get name() {
      return name;
    },
    set name(value: string) {
      name = value;
    },
    get input() {
      return input;
    },
    set input(value: HTMLInputElement | null) {
      input = value;
    },
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
    start,
    save,
    keydown,
  };
}

export type AssistantThreadRename = ReturnType<typeof createAssistantThreadRename>;
