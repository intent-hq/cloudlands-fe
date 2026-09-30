<script module lang="ts">
  import { repositoryRootKey } from '$shared/types/repository-context';
  import type { NativeReviewOwner } from '$shared/types/native-review-operation';
  function matchesOwner(a: NativeReviewOwner | undefined, b: NativeReviewOwner) {
    return (
      !!a &&
      a.attemptId === b.attemptId &&
      a.admission === b.admission &&
      a.hostContext === b.hostContext &&
      repositoryRootKey(a.root) === repositoryRootKey(b.root)
    );
  }
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview({
    id: 'sidebar-native-dismissal',
    title: 'Sidebar dismissal lifetime',
    defaultState: 'default',
    states: { default: { props: {} } },
  });
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Renderer from '../../../../test/fixtures/native-review-native/ui-renderer.svelte';
  import { Button } from '$lib/components/ui/button';
  import { store } from '$store/renderer/store';
  import {
    selectNativeReviewForOwner,
    selectNativeReviewOccupancy,
  } from '$store/renderer/slices/repository-context/repository-context-selectors';
  import {
    nativeReviewEditEnded,
    nativeReviewEditRequested,
    nativeReviewCompanionRequested,
    repositoryContextDemandEnded,
    repositoryContextDemanded,
  } from '$store/renderer/slices/repository-context/repository-context-slice';
  import { installSidebarNativeFixture } from './sidebar-native-review.preview-fixtures';

  let renderer: Renderer;
  let frame: HTMLDivElement;
  let fixture: ReturnType<typeof installSidebarNativeFixture>;
  let ready = $state(false);
  let generation = $state(0);
  let report = $state('{}');
  let dismissal = 'idle';
  let duplicate = false;
  let completions = 0;
  let mounted = $state(true);
  let phase = 'idle';
  let failure: string | null = null;
  let originalRow: Element | null = null;
  let rowKey: string | null = null;
  let normalizedGeneration = -1;
  let checkpoint: ReturnType<typeof snapshot> | null = null;
  let previousGeneration: ReturnType<typeof snapshot> | null = null;
  let active = true;
  const animations = new Set<Animation>();
  const restoreAnimations = new Set<() => void>();
  const observedIds = new Set<string>();
  const owners = new Map<string, NativeReviewOwner>();
  const demands = new Map<string, ReturnType<typeof repositoryContextDemanded>['payload']>();
  const rowIds = new WeakMap<Element, number>();
  let rowSerial = 0;
  const animationFacts: Array<{
    row: number;
    generation: number;
    stage: string;
    duration: number | string;
    targetMatches: boolean;
    finished: boolean;
    held: boolean;
  }> = [];
  const events: Array<{
    sequence: number;
    generation: number;
    kind: string;
    id?: string;
    matched?: boolean;
  }> = [];
  function event(kind: string, id?: string, matched?: boolean) {
    if (events.length >= 128) throw new Error('Dismissal control transcript overflow');
    events.push({ sequence: events.length, generation, kind, id, matched });
  }
  function fail(reason: unknown) {
    failure = reason instanceof Error ? reason.message : String(reason);
    phase = 'failed';
    event('schedule-failed');
    publish();
  }
  function rowId(row: Element) {
    if (!rowIds.has(row)) rowIds.set(row, ++rowSerial);
    return rowIds.get(row)!;
  }
  function snapshot() {
    return [...observedIds].map((id) => {
      const attempt = selectNativeReviewOccupancy.select(store.state, id);
      if (!attempt) throw new Error('Original observed owner missing from this Store generation');
      return {
        id: attempt.attemptId,
        closed: attempt.status === 'closed',
        publicNull: selectNativeReviewForOwner.select(store.state, attempt.owner) === null,
        success: attempt.observation?.execute?.success,
        receipts: attempt.observation?.execute?.reviewExecution?.gitReceipts,
      };
    });
  }
  function publish() {
    if (!active || !mounted) return;
    report = JSON.stringify({
      ready,
      generation,
      dismissal,
      duplicate,
      completions,
      held: animations.size,
      events,
      phase,
      failure,
      animationFacts,
      checkpoint,
      previousGeneration,
      requests: fixture?.requests.map((request) => ({ id: request.id, kind: request.kind })),
      captures: fixture?.captures.map((capture) => ({
        id: capture.id,
        companionOf: capture.companionOf,
      })),
      releases: fixture?.releases,
      attempts: snapshot(),
    });
  }
  function install() {
    fixture = installSidebarNativeFixture({
      delayCommand: true,
      baseRef: 'trunk',
      onBoundary: () => queueMicrotask(publish),
    });
    ready = true;
    publish();
  }
  function sameOwners() {
    return [...owners.values()].every((owner) => {
      const current = selectNativeReviewOccupancy.select(store.state, owner.attemptId)?.owner;
      return matchesOwner(current, owner);
    });
  }
  function beginNormalization() {
    if (phase !== 'idle') return fail(new Error('Normalization is once-only'));
    const rows = frame.querySelectorAll('[data-file-key^="staged:"]');
    if (
      rows.length !== 1 ||
      !sameOwners() ||
      snapshot().length !== 2 ||
      snapshot().some((row) => row.closed)
    )
      return fail(new Error('Original live parent child and single staged row required'));
    originalRow = rows[0];
    rowKey = originalRow.getAttribute('data-file-key');
    normalizedGeneration = generation;
    phase = 'collapsing';
    event('normalization-capture', String(rowId(originalRow)));
    publish();
  }
  function observeAnimation(row: Element, stage: string, started: () => boolean) {
    const own = Object.getOwnPropertyDescriptor(row, 'animate');
    const animate = row.animate;
    const restore = () => {
      if (own) Object.defineProperty(row, 'animate', own);
      else delete (row as { animate?: Element['animate'] }).animate;
      restoreAnimations.delete(restore);
    };
    restoreAnimations.add(restore);
    row.animate = function (...args: Parameters<Element['animate']>) {
      let animation: Animation;
      try {
        animation = Reflect.apply(animate, this, args) as Animation;
      } catch (error) {
        restore();
        fail(error);
        throw error;
      }
      if (!started()) return animation; // Original delay precursor: never held.
      restore();
      try {
        const duration = animation.effect?.getComputedTiming().duration ?? 'auto';
        const targetMatches =
          this === row &&
          animation.effect instanceof KeyframeEffect &&
          animation.effect.target === row;
        const fact = {
          row: rowId(row),
          generation,
          stage,
          duration,
          targetMatches,
          finished: false,
          held: false,
        };
        animationFacts.push(fact);
        event('original-main-animation', String(fact.row), targetMatches);
        if (!targetMatches || typeof duration !== 'number' || duration <= 0)
          throw new Error('Original main animation must have a positive duration and exact target');
        animation.addEventListener(
          'finish',
          () => {
            fact.finished = true;
            if (active) {
              event('original-animation-finish', String(fact.row));
              publish();
            }
          },
          { once: true },
        );
        if (stage === 'outer') {
          if (
            phase !== 'removing' ||
            row !== originalRow ||
            generation !== normalizedGeneration ||
            !sameOwners()
          )
            throw new Error('Outer animation changed original row or owner generation');
          animation.pause();
          fact.held = true;
          animations.add(animation);
          phase = 'held';
          checkpoint = snapshot();
          event('outer-animation-held', String(fact.row));
        }
        // This is an event-scheduled fresh Store read, after the actual capture.
        queueMicrotask(publish);
      } catch (error) {
        fail(error);
      }
      return animation;
    };
    return restore;
  }
  function requestDismiss() {
    if (
      phase !== 'expanded' ||
      !originalRow ||
      !originalRow.isConnected ||
      generation !== normalizedGeneration ||
      !sameOwners()
    )
      return fail(new Error('Positive completed intro on original expanded row required'));
    phase = 'removing';
    dismissal = 'pending';
    event('dismiss-request');
    let started = false;
    const row = originalRow;
    const start = (e: Event) => {
      if (e.target === row) {
        started = true;
        event('outer-outro-start', String(rowId(row)));
      }
    };
    row.addEventListener('outrostart', start);
    const restore = observeAnimation(row, 'outer', () => started);
    const first = renderer.dismiss();
    const second = renderer.dismiss();
    duplicate = first === second;
    void first
      .then(
        () => {
          dismissal = 'completed';
          completions += 1;
          event('dismiss-completed');
          publish();
        },
        (error) => {
          dismissal = 'failed';
          fail(error);
        },
      )
      .finally(() => {
        restore();
        row.removeEventListener('outrostart', start);
      });
    publish();
  }
  function finishAnimations() {
    event('finish-request');
    for (const animation of animations) animation.finish();
    animations.clear();
    publish();
  }
  function finishRequest(index: number) {
    const request = fixture.requests[index];
    if (!request) throw new Error('Original controlled request missing');
    request.finish();
    event('boundary-finished', request.id);
    queueMicrotask(publish);
  }
  async function remount() {
    if (dismissal !== 'completed' || !snapshot()[1]?.success)
      return fail(
        new Error('Archive the completed original child before sequential Store replacement'),
      );
    previousGeneration = structuredClone(snapshot());
    await fixture.dispose();
    mounted = false;
    await tick(); // Actual old Renderer destroys/disposes its own Store before the new root.
    observedIds.clear();
    owners.clear();
    demands.clear();
    generation += 1;
    dismissal = 'idle';
    phase = 'idle';
    mounted = true;
    await tick();
    install();
  }
  // CT creates a default selector Store before mounting any preview. Retire that
  // default before the actual fixture Renderer creates and owns its app Store.
  // This is controlled-scene setup; dismissal never calls Store.dispose().
  store.dispose();
  store.addMiddleware(() => (next) => (action) => {
    const result = next(action);
    if (active) {
      if (typeof action === 'object' && action !== null && 'type' in action) {
        if (action.type === nativeReviewEditRequested.type) {
          const owner = (action as ReturnType<typeof nativeReviewEditRequested>).payload[0];
          observedIds.add(owner.attemptId);
          owners.set(owner.attemptId, owner);
        }
        if (action.type === nativeReviewCompanionRequested.type) {
          const owner = (action as ReturnType<typeof nativeReviewCompanionRequested>).payload[1];
          observedIds.add(owner.attemptId);
          owners.set(owner.attemptId, owner);
        }
        if (action.type === repositoryContextDemanded.type) {
          const demand = (action as ReturnType<typeof repositoryContextDemanded>).payload;
          demands.set(demand[1], demand);
          event('demand-requested', demand[1]);
        }
      }
      if (
        typeof action === 'object' &&
        action !== null &&
        'type' in action &&
        action.type === nativeReviewEditEnded.type
      ) {
        const ended = (action as ReturnType<typeof nativeReviewEditEnded>).payload[0];
        const original = owners.get(ended.attemptId);
        event('owner-ended', ended.attemptId, matchesOwner(original, ended));
      }
      if (
        typeof action === 'object' &&
        action !== null &&
        'type' in action &&
        action.type === repositoryContextDemandEnded.type
      ) {
        const ended = (action as ReturnType<typeof repositoryContextDemandEnded>).payload;
        const original = demands.get(ended[1]);
        event(
          'demand-ended',
          ended[1],
          !!original && ended[0] === original[0] && ended[2] === original[2],
        );
      }
      if (
        typeof action === 'object' &&
        action !== null &&
        'type' in action &&
        action.type === nativeReviewCompanionRequested.type
      )
        event(
          'child-requested',
          (action as ReturnType<typeof nativeReviewCompanionRequested>).payload[1].attemptId,
        );
      queueMicrotask(publish);
    }
    return result;
  });
  onMount(() => {
    install();
    const transition = (e: Event) => {
      const row = e.target;
      if (!(row instanceof Element) || !row.hasAttribute('data-file-key')) return;
      if (generation !== normalizedGeneration || row.getAttribute('data-file-key') !== rowKey)
        return;
      if (phase === 'collapsing' && row === originalRow && e.type === 'outrostart') {
        event('nested-outro-start', String(rowId(row)));
      } else if (phase === 'collapsing' && row === originalRow && e.type === 'outroend') {
        phase = 'collapsed';
        event('nested-outro-end', String(rowId(row)));
        publish();
      } else if (phase === 'collapsed' && row !== originalRow && e.type === 'introstart') {
        originalRow = row;
        phase = 'opening';
        event('new-row-intro-start', String(rowId(row)));
        observeAnimation(row, 'intro', () => true);
      } else if (phase === 'opening' && row === originalRow && e.type === 'introend') {
        const fact = animationFacts.at(-1);
        if (!fact || fact.stage !== 'intro' || fact.row !== rowId(row) || !fact.finished)
          return fail(new Error('New row intro lacks an original completed positive animation'));
        phase = 'expanded';
        event('new-row-intro-end', String(rowId(row)));
        queueMicrotask(publish);
      } else if (row === originalRow && e.type === 'outroend' && phase === 'held') {
        event('outer-outro-end', String(rowId(row)));
        publish();
      }
    };
    for (const name of ['introstart', 'introend', 'outrostart', 'outroend'])
      frame.addEventListener(name, transition, true);
    return () => {
      active = false;
      for (const restore of [...restoreAnimations]) restore();
      for (const name of ['introstart', 'introend', 'outrostart', 'outroend'])
        frame.removeEventListener(name, transition, true);
      for (const animation of animations) animation.finish();
      animations.clear();
      void fixture.dispose();
    };
  });
</script>

<div bind:this={frame} class="w-full min-w-0" data-dismissal-ready={ready}>
  <!-- i18n-ignore (controlled preview actions) -->
  {#if ready}<div class="flex flex-wrap gap-2">
      <Button onclick={beginNormalization}>Observe Staged normalization</Button>
      <Button onclick={requestDismiss}>Dismiss sidebar</Button>
      <Button onclick={finishAnimations}>Finish original animations</Button>
      <Button onclick={() => finishRequest(0)}>Finish parent</Button>
      <Button onclick={() => finishRequest(1)}>Finish child</Button>
      <Button
        onclick={() => {
          fixture.base.admit('host-B');
          publish();
        }}>Replace host</Button
      >
      <Button onclick={remount}>Mount next generation</Button>
      <Button onclick={publish}>Read original state</Button>
    </div>{/if}
  {#if mounted}{#key generation}<Renderer sidebar bind:this={renderer} />{/key}{/if}
  <output hidden data-dismissal-report>{report}</output>
</div>
