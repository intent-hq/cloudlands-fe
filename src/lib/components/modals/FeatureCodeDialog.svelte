<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { Input } from '$lib/components/ui/input';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import { featureCodesClient } from '$features/feature-codes/renderer/feature-codes.client';
  import {
    selectActiveFeatures,
    selectHasActiveFeatures,
  } from '$store/renderer/slices/feature-codes/feature-codes-selectors';
  import { setActiveFeatures } from '$store/renderer/slices/feature-codes/feature-codes-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    onClose?: () => void;
  }

  let { open = $bindable(false), onClose }: Props = $props();

  const activeFeatures$ = selectActiveFeatures();
  const hasActiveFeatures$ = selectHasActiveFeatures();

  let inputValue = $state('');
  let inputRef: HTMLInputElement | null = $state(null);
  let feedback = $state<{ message: string; color: string } | null>(null);
  let isActivating = $state(false);
  let needsRestart = $state(false);
  let feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

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

  async function confirm() {
    if (!inputValue.trim() || isActivating) return;
    clearFeedbackTimeout();
    isActivating = true;
    feedback = null;

    try {
      const result = await featureCodesClient.activateCode(inputValue.trim());
      if (result?.status === 'already_active') {
        feedback = {
          message: m.modals_featureCode_alreadyActive_feedback(),
          color: 'text-yellow-400',
        };
      } else {
        feedback = { message: m.modals_featureCode_activated_feedback(), color: 'text-green-400' };
        needsRestart = true;
      }
      // Refresh the renderer-side store so UI gates update immediately
      await refreshActiveFeatures();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.toLowerCase().includes('already active') ||
        message.toLowerCase().includes('already_active')
      ) {
        feedback = {
          message: m.modals_featureCode_alreadyActive_feedback(),
          color: 'text-yellow-400',
        };
      } else {
        feedback = {
          message: m.modals_featureCode_invalidCode_feedback(),
          color: 'text-danger',
        };
      }
    } finally {
      isActivating = false;
      scheduleFeedbackClear();
    }
  }

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
      void refreshActiveFeatures();
      requestAnimationFrame(() => {
        inputRef?.focus();
      });
    }
  });

  /** Re-fetch active features; keep existing store state when the fetch fails. */
  async function refreshActiveFeatures() {
    const features = await featureCodesClient.getActiveFeatures();
    if (features !== null) {
      appStore.dispatch(setActiveFeatures(features));
    }
  }

  async function restartApp() {
    await featureCodesClient.restartApp();
  }

  async function removeFeature(featureId: string) {
    const result = await featureCodesClient.deactivateFeature(featureId);
    await refreshActiveFeatures();
    if (!result?.success) return;
    needsRestart = true;
    feedback = { message: m.modals_featureCode_deactivated_feedback(), color: 'text-yellow-400' };
    scheduleFeedbackClear();
  }
</script>

{#if open}
  <FormDialog
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
        variant="default"
        disabled={!inputValue.trim() || isActivating || feedback !== null}
      >
        {m.modals_featureCode_activate_label()}
      </Button>
    {/snippet}
  </FormDialog>
{/if}
