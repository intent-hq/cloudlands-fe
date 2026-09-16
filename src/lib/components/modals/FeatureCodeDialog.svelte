<script lang="ts">
  import { untrack } from 'svelte';
  import { readable } from 'svelte/store';
  import { Button } from '$lib/components/ui/button';
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { Input } from '$lib/components/ui/input';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import {
    selectActiveFeatures,
    selectFeatureCodeOperation,
    selectHasActiveFeatures,
  } from '$store/renderer/slices/feature-codes/feature-codes-selectors';
  import {
    activateFeatureCodeRequested,
    deactivateFeatureRequested,
    loadActiveFeaturesRequested,
    restartForFeatureCodesRequested,
  } from '$store/renderer/slices/feature-codes/feature-codes-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  const STATIC_OPERATION = {
    version: 0,
    status: 'idle' as const,
    kind: null,
    result: null,
    error: null,
  };

  interface Props {
    open?: boolean;
    static?: boolean;
    staticData?: { activeFeatures: string[] };
    onClose?: () => void;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    staticData,
    onClose,
  }: Props = $props();

  const activeFeatures$ = untrack(() =>
    staticData ? readable(staticData.activeFeatures) : selectActiveFeatures(),
  );
  const hasActiveFeatures$ = untrack(() =>
    staticData ? readable(staticData.activeFeatures.length > 0) : selectHasActiveFeatures(),
  );
  const operation$ = untrack(() =>
    staticData ? readable(STATIC_OPERATION) : selectFeatureCodeOperation(),
  );

  let inputValue = $state('');
  let inputRef: HTMLInputElement | null = $state(null);
  let feedback = $state<{ message: string; color: string } | null>(null);
  let isActivating = $state(false);
  let needsRestart = $state(false);
  let feedbackTimeout: ReturnType<typeof setTimeout> | null = null;
  let handledOperationVersion = $state(
    untrack(() =>
      staticData
        ? STATIC_OPERATION.version
        : selectFeatureCodeOperation.select(appStore.state).version,
    ),
  );

  function clearFeedbackTimeout() {
    if (feedbackTimeout !== null) {
      clearTimeout(feedbackTimeout);
      feedbackTimeout = null;
    }
  }

  function scheduleFeedbackClear() {
    clearFeedbackTimeout();
    feedbackTimeout = setTimeout(() => {
      feedback = null;
      inputValue = '';
      feedbackTimeout = null;
      requestAnimationFrame(() => {
        inputRef?.focus();
      });
    }, 2000);
  }

  function close() {
    clearFeedbackTimeout();
    open = false;
    inputValue = '';
    feedback = null;
    isActivating = false;
    needsRestart = false;
    onClose?.();
  }

  function confirm() {
    if (staticData) return;
    if (!inputValue.trim() || isActivating) return;
    clearFeedbackTimeout();
    isActivating = true;
    feedback = null;

    handledOperationVersion = $operation$.version;
    appStore.dispatch(activateFeatureCodeRequested(inputValue.trim()));
  }

  $effect(() => {
    const operation = $operation$;
    if (operation.version <= handledOperationVersion || operation.status === 'loading') return;
    handledOperationVersion = operation.version;
    if (operation.kind === 'activate') {
      if (operation.status === 'success' && operation.result === 'already_active') {
        feedback = {
          message: m.modals_featureCode_alreadyActive_feedback(),
          color: 'text-yellow-400',
        };
      } else if (operation.status === 'success' && operation.result === 'activated') {
        feedback = { message: m.modals_featureCode_activated_feedback(), color: 'text-green-400' };
        needsRestart = true;
      } else if (operation.status === 'success' && operation.result === 'invalid') {
        feedback = {
          message: m.modals_featureCode_invalidCode_feedback(),
          color: 'text-danger',
        };
      } else {
        feedback = {
          message: m.modals_featureCode_invalidCode_feedback(),
          color: 'text-danger',
        };
      }
      isActivating = false;
      scheduleFeedbackClear();
    } else if (operation.kind === 'deactivate' && operation.status === 'success') {
      needsRestart = true;
      feedback = { message: m.modals_featureCode_deactivated_feedback(), color: 'text-yellow-400' };
      scheduleFeedbackClear();
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter') {
      confirm();
    }
  }

  // Focus input and load active features when dialog opens
  $effect(() => {
    if (open) {
      clearFeedbackTimeout();
      feedback = null;
      inputValue = '';
      if (!staticData) appStore.dispatch(loadActiveFeaturesRequested());
      requestAnimationFrame(() => {
        inputRef?.focus();
      });
    }
  });

  function restartApp() {
    if (staticData) return;
    appStore.dispatch(restartForFeatureCodesRequested());
  }

  function removeFeature(featureId: string) {
    if (staticData) return;
    handledOperationVersion = $operation$.version;
    appStore.dispatch(deactivateFeatureRequested(featureId));
  }
</script>

{#if open}
  <FormDialog
    static={staticPosition}
    bind:open
    title={m.modals_featureCode_title()}
    submitLabel={m.modals_featureCode_activate_label()}
    cancelLabel={needsRestart
      ? m.modals_featureCode_close_label()
      : m.modals_featureCode_cancel_label()}
    canSubmit={Boolean(inputValue.trim()) && feedback === null}
    busy={isActivating}
    initialFocus={inputRef}
    onSubmit={confirm}
    onCancel={close}
  >
    <div class="grid gap-2">
      <Input
        bind:ref={inputRef}
        bind:value={inputValue}
        type="password"
        placeholder={m.modals_featureCode_code_placeholder()}
        onkeydown={handleKeydown}
        disabled={isActivating || feedback !== null}
      />
      {#if feedback}
        <p class="text-sm {feedback.color}">{feedback.message}</p>
      {/if}
    </div>

    {#if $hasActiveFeatures$}
      <div>
        <p class="text-xs text-subtle mb-2">{m.modals_featureCode_activeFeatures_label()}</p>
        <ul class="space-y-1">
          {#each $activeFeatures$ as featureId}
            <li
              class="flex items-center justify-between text-sm text-subtle bg-muted/50 rounded px-2 py-1"
            >
              <span>{featureId}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                iconOnly
                onclick={() => removeFeature(featureId)}
                title={m.modals_featureCode_remove_tooltip({ featureId })}
              >
                <Fa icon={faXmark} size="xs" />
              </Button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#snippet footer()}
      <Button variant="ghost" onclick={close}
        >{needsRestart
          ? m.modals_featureCode_close_label()
          : m.modals_featureCode_cancel_label()}</Button
      >
      {#if needsRestart}
        <Button variant="outline" onclick={restartApp}
          >{m.modals_featureCode_restartNow_label()}</Button
        >
      {/if}
      <Button
        type="submit"
        variant="primary"
        disabled={!inputValue.trim() || isActivating || feedback !== null}
      >
        {m.modals_featureCode_activate_label()}
      </Button>
    {/snippet}
  </FormDialog>
{/if}
