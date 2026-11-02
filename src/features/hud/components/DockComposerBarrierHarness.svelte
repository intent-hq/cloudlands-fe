<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import type { ContextItem } from '$lib/components/chat/input/context-api';
  import type { DockEvidenceInsertion, EditorScreenReference } from '$shared/dock-evidence';
  import { store } from '$store/renderer/store';
  import { selectDockConversationComposer } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import { openDockConversationRequested } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
  import DockConversationComposer, {
    type DockConversationComposerSubmission,
  } from './DockConversationComposer.svelte';
  import type { DockComposerMediaBinding } from './dock-composer-media-presentation';
  import { labels } from './dock-composer-media.preview.svelte';
  import {
    setupConversationWire,
    conversationWireWorkspace,
    type ConversationWireCall,
  } from './dock-conversation-wire.preview-fixtures';

  let { width = 520, dictating = false }: { width?: number; dictating?: boolean } = $props();

  const composer$ = selectDockConversationComposer();
  const references: EditorScreenReference[] = [
    { id: 'mark-one', number: 1, label: 'Save' },
    { id: 'mark-two', number: 2, label: 'Cancel' },
  ];
  let ready = $state(false);
  let mounted = $state(true);
  let agentId = $state('wire-main');
  let draft = $state('');
  let contextItems = $state<ContextItem[]>([]);
  let insertions = $state<DockEvidenceInsertion[]>([]);
  let committed = $state<string[]>([]);
  let submissions = $state<DockConversationComposerSubmission[]>([]);
  let calls = $state<ConversationWireCall[]>([]);
  let phase = $state('idle');
  let barrierCalls = $state(0);
  let normalUpdates = $state(0);
  let input = $state<DockConversationComposer>();
  let heldFirst: { id: string; text: string } | undefined;
  let holdFirst = true;
  let fixtureDisposed = false;
  let departed = false;
  let releaseSpeech: (() => void) | undefined;
  const queueWaiters = new Set<() => void>();

  function wakeQueue(): void {
    for (const wake of queueWaiters) wake();
    queueWaiters.clear();
  }

  // Controlled acknowledgments model the external owner. The real editor builds
  // the committed text; this fixture never serializes chips or edits its DOM.
  function acknowledge(id: string, text: string): void {
    if (departed || fixtureDisposed || insertions[0]?.id !== id) return;
    if (id === 'first' && holdFirst) {
      heldFirst = { id, text };
      phase = 'first-ack-held';
      return;
    }
    draft = text;
    committed = [...committed, id];
    insertions = insertions.slice(1);
    wakeQueue();
  }

  function queueReferences(): void {
    insertions = [
      {
        id: 'first',
        parts: [
          { kind: 'text', text: ' first ' },
          { kind: 'mark', markId: 'mark-one' },
        ],
      },
      {
        id: 'second',
        parts: [
          { kind: 'text', text: ' second ' },
          { kind: 'mark', markId: 'mark-two' },
        ],
      },
    ];
  }

  function releaseFirst(): void {
    holdFirst = false;
    const held = heldFirst;
    heldFirst = undefined;
    if (held) acknowledge(held.id, held.text);
  }

  async function drain(): Promise<void> {
    await tick();
    while (!fixtureDisposed && !departed && insertions.length > 0) {
      const head = insertions[0].id;
      input?.flushScreenEvidence();
      await tick();
      if (insertions[0]?.id === head && !departed && !fixtureDisposed)
        await new Promise<void>((resolve) => queueWaiters.add(resolve));
    }
  }

  async function beforeSubmit(): Promise<boolean> {
    barrierCalls += 1;
    await drain();
    if (fixtureDisposed) return false;
    phase = 'awaiting-speech';
    await new Promise<void>((resolve) => (releaseSpeech = resolve));
    if (fixtureDisposed) return false;
    if (!departed) {
      insertions = [{ id: 'speech-final', parts: [{ kind: 'text', text: ' final speech' }] }];
      await drain();
    }
    // Deliberately return true even after navigation. The wrapper must independently
    // reject a stale preparation rather than trusting a service to cancel for it.
    phase = 'returned';
    return true;
  }

  function leaveTarget(unmount: boolean): void {
    departed = true;
    insertions = [];
    wakeQueue();
    if (unmount) mounted = false;
    else agentId = 'wire-other';
  }

  const noop = () => {};
  const media: DockComposerMediaBinding = $derived({
    labels,
    state: {
      captureRevision: 0,
      captureDisabled: true,
      annotationActive: false,
      annotationDisabled: true,
      tool: 'pick',
      toolUsed: false,
      recording: false,
      recordingDisabled: true,
      recordingTime: '0:00',
      dictating,
      dictationDisabled: true,
      dictationTime: '0:09',
      inputLevels: dictating ? [0.2, 0.6, 0.3, 0.9, 0.4, 0.8, 0.1, 0.5] : [],
    },
    attachments: [],
    beforeSubmit,
    onCapture: noop,
    onRecordToggle: noop,
    onAnnotationToggle: noop,
    onToolSelect: noop,
    onDictationToggle: noop,
    onDictationHoldStart: noop,
    onDictationHoldEnd: noop,
    onMarkUp: noop,
    onRemove: noop,
  });

  onMount(() => {
    const fixture = setupConversationWire((call) => (calls = [...calls, call]));
    store.dispatch(openDockConversationRequested(conversationWireWorkspace));
    ready = true;
    return () => {
      fixtureDisposed = true;
      wakeQueue();
      releaseSpeech?.();
      fixture.dispose();
    };
  });
</script>

<div
  data-testid="composer-barrier"
  data-phase={phase}
  data-agent={agentId}
  data-barrier-calls={barrierCalls}
  data-normal-updates={normalUpdates}
  data-committed={JSON.stringify(committed)}
  data-queued={JSON.stringify(insertions.map((item) => item.id))}
  data-submissions={JSON.stringify(submissions)}
  data-calls={JSON.stringify(calls)}
  data-draft={draft}
>
  <div style:width={`${width}px`} data-barrier-composer-host>
    {#if ready && mounted && $composer$.workspace}
      <DockConversationComposer
        bind:this={input}
        workspace={$composer$.workspace}
        {agentId}
        value={draft}
        {contextItems}
        selectedModel={$composer$.selectedModel}
        providerId={$composer$.providerId}
        {media}
        screenReferences={references}
        screenInsertions={insertions}
        onScreenInsertionApplied={acknowledge}
        onValueChange={(text) => {
          normalUpdates += 1;
          draft = text;
        }}
        onContextItemsChange={(items) => (contextItems = items)}
        onSubmit={(submission) => (submissions = [...submissions, submission])}
        onStop={noop}
      />
    {/if}
  </div>
  <Button onclick={queueReferences}>Queue references</Button>
  <Button onclick={releaseFirst}>Release first acknowledgment</Button>
  <Button onclick={() => releaseSpeech?.()}>Finalize speech</Button>
  <Button onclick={() => leaveTarget(false)}>Switch target</Button>
  <Button onclick={() => leaveTarget(true)}>Unmount composer</Button>
</div>
