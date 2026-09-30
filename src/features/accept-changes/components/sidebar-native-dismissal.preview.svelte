<script module lang="ts">
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
  import { prefersReducedMotion } from '$lib/utils/reduced-motion';
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
  let hold = true;
  let active = true;
  const animations = new Set<Animation>();
  const restoreAnimations = new Set<() => void>();
  const observedIds = new Set<string>();
  const outroFacts: Array<{
    width: number;
    height: number;
    animations: number;
    reduced: boolean;
    rootMotion: string;
    exit: string;
  }> = [];
  const events: Array<{ kind: string; id?: string }> = [];
  function event(kind: string, id?: string) {
    if (events.length >= 128) throw new Error('Dismissal control transcript overflow');
    events.push({ kind, id });
  }
  function publish() {
    if (!active) return;
    const attempts = [...observedIds]
      .map((id) => selectNativeReviewOccupancy.select(store.state, id))
      .filter((row) => row !== undefined);
    report = JSON.stringify({
      ready,
      generation,
      dismissal,
      duplicate,
      completions,
      held: animations.size,
      events,
      outroFacts,
      requests: fixture?.requests.map((request) => ({ id: request.id, kind: request.kind })),
      captures: fixture?.captures.map((capture) => ({
        id: capture.id,
        companionOf: capture.companionOf,
      })),
      releases: fixture?.releases,
      attempts: attempts
        ? attempts.map((attempt) => ({
            id: attempt.attemptId,
            closed: attempt.status === 'closed',
            publicNull: selectNativeReviewForOwner.select(store.state, attempt.owner) === null,
            success: attempt.observation?.execute?.success,
            receipts: attempt.observation?.execute?.reviewExecution?.gitReceipts,
          }))
        : [],
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
  function requestDismiss() {
    dismissal = 'pending';
    event('dismiss-request');
    const first = renderer.dismiss();
    const second = renderer.dismiss();
    duplicate = first === second;
    void first.then(
      () => {
        dismissal = 'completed';
        completions += 1;
        event('dismiss-completed');
        publish();
      },
      () => {
        dismissal = 'failed';
        event('dismiss-failed');
        publish();
      },
    );
    publish();
  }
  function finishAnimations() {
    hold = false;
    for (const restore of [...restoreAnimations]) restore();
    for (const animation of animations) animation.finish();
    animations.clear();
    event('animations-finished');
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
    await fixture.dispose();
    generation += 1;
    await tick();
    dismissal = 'idle';
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
        if (action.type === nativeReviewEditRequested.type)
          observedIds.add(
            (action as ReturnType<typeof nativeReviewEditRequested>).payload[0].attemptId,
          );
        if (action.type === nativeReviewCompanionRequested.type)
          observedIds.add(
            (action as ReturnType<typeof nativeReviewCompanionRequested>).payload[1].attemptId,
          );
      }
      if (
        typeof action === 'object' &&
        action !== null &&
        'type' in action &&
        action.type === nativeReviewEditEnded.type
      )
        event(
          'owner-ended',
          (action as ReturnType<typeof nativeReviewEditEnded>).payload[0].attemptId,
        );
      if (
        typeof action === 'object' &&
        action !== null &&
        'type' in action &&
        action.type === repositoryContextDemandEnded.type
      )
        event(
          'demand-ended',
          (action as ReturnType<typeof repositoryContextDemandEnded>).payload[1],
        );
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
    const outro = (e: Event) => {
      if (
        !(e.target instanceof Element) ||
        (!e.target.hasAttribute('data-file-key') && !e.target.querySelector('[data-file-key]'))
      )
        return;
      event('row-outro-start');
      const originalRow = e.target;
      const box = originalRow.getBoundingClientRect();
      outroFacts.push({
        width: box.width,
        height: box.height,
        animations: originalRow.getAnimations().length,
        reduced: prefersReducedMotion(),
        rootMotion:
          document.documentElement.className +
          '/' +
          document.documentElement.hasAttribute('data-reduce-motion'),
        exit: getComputedStyle(originalRow).getPropertyValue('--spring-moderate-exit'),
      });
      // Observe only this original row's next genuine WAAPI creation. Keep the
      // browser call, receiver, arguments and returned Animation unchanged; pause
      // that created animation for this control's explicit finish action.
      const own = Object.getOwnPropertyDescriptor(originalRow, 'animate');
      const animate = originalRow.animate;
      const restore = () => {
        if (own) Object.defineProperty(originalRow, 'animate', own);
        else delete (originalRow as { animate?: Element['animate'] }).animate;
        restoreAnimations.delete(restore);
      };
      restoreAnimations.add(restore);
      originalRow.animate = function (...args: Parameters<Element['animate']>) {
        try {
          const animation = Reflect.apply(animate, this, args) as Animation;
          if (hold) {
            animation.pause();
            animations.add(animation);
            event('original-animation-held');
          }
          queueMicrotask(publish);
          return animation;
        } finally {
          restore();
        }
      };
      queueMicrotask(publish);
    };
    frame.addEventListener('outrostart', outro, true);
    return () => {
      active = false;
      for (const restore of [...restoreAnimations]) restore();
      frame.removeEventListener('outrostart', outro, true);
      for (const animation of animations) animation.finish();
      animations.clear();
      void fixture.dispose();
    };
  });
</script>

<div bind:this={frame} class="w-full min-w-0" data-dismissal-ready={ready}>
  <!-- i18n-ignore (controlled preview actions) -->
  {#if ready}<div class="flex flex-wrap gap-2">
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
  {#key generation}<Renderer sidebar bind:this={renderer} />{/key}
  <output hidden data-dismissal-report>{report}</output>
</div>
