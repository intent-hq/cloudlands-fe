<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import { invoke } from '$lib/electron-bridge';
  import { selectActiveFeatures, selectHasActiveFeatures } from '$lib/store/slices/feature-codes/feature-codes-selectors';
  import { fetchFeatures, deactivateFeature } from '$lib/store/slices/feature-codes/feature-codes-slice';
  import { getDispatch } from '$lib/store/utils/utils';

  interface Props {
    open?: boolean;
  }

  let {
    open = $bindable(false),
  }: Props = $props();

  const dispatch = getDispatch();
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
  }

  async function confirm() {
    if (!inputValue.trim() || isActivating) return;
    clearFeedbackTimeout();
    isActivating = true;
    feedback = null;

    try {
      const result = await invoke<{ status: string }>('feature-codes:activate', { code: inputValue.trim() });
      if (result?.status === 'already_active') {
        feedback = { message: 'Feature already active.', color: 'text-yellow-400' };
      } else {
        feedback = { message: 'Feature activated!', color: 'text-green-400' };
        needsRestart = true;
      }
      // Refresh the renderer-side store so UI gates update immediately
      dispatch(fetchFeatures());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('already active') || message.toLowerCase().includes('already_active')) {
        feedback = { message: 'Feature already active.', color: 'text-yellow-400' };
      } else {
        feedback = { message: 'Invalid code.', color: 'text-red-400' };
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
      requestAnimationFrame(() => {
        inputRef?.focus();
      });
    }
  });

  async function restartApp() {
    await invoke('feature-codes:restart-app');
  }

  async function removeFeature(featureId: string) {
    await dispatch(deactivateFeature(featureId));
    needsRestart = true;
    feedback = { message: 'Feature deactivated! Restart to apply.', color: 'text-yellow-400' };
    scheduleFeedbackClear();
  }
</script>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="button"
    tabindex="0"
    onkeydown={handleKeydown}
    onclick={close}
  >
    <div
      class="bg-background border border-border rounded-lg shadow-lg w-full max-w-md overflow-hidden flex flex-col"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="-1"
      onkeydown={(e) => e.stopPropagation()}
    >
      <!-- Header -->
      <div class="px-6 py-4 border-b border-border flex items-center justify-between">
        <h2 class="text-lg font-semibold">Enter Feature Code</h2>
        <Button variant="ghost" size="icon" onclick={close}>
          <Fa icon={faXmark} />
        </Button>
      </div>

      <!-- Content -->
      <div class="p-6">
        <input
          bind:this={inputRef}
          bind:value={inputValue}
          type="password"
          placeholder="Enter code..."
          onkeydown={handleKeydown}
          class="w-full px-3 py-2 bg-background border border-border rounded text-foreground focus:outline-none focus:border-primary"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          disabled={isActivating || feedback !== null}
        />
        {#if feedback}
          <p class="mt-2 text-sm {feedback.color}">{feedback.message}</p>
        {/if}
      </div>

      <!-- Active Features -->
      {#if $hasActiveFeatures$}
        <div class="px-6 pb-4">
          <p class="text-xs text-subtle mb-2">Active Features</p>
          <ul class="space-y-1">
            {#each $activeFeatures$ as featureId}
              <li class="flex items-center justify-between text-sm text-subtle bg-muted/50 rounded px-2 py-1">
                <span>{featureId}</span>
                <button
                  class="ml-2 text-muted-foreground hover:text-foreground transition-colors"
                  onclick={() => removeFeature(featureId)}
                  title="Remove {featureId}"
                >
                  <Fa icon={faXmark} size="xs" />
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <!-- Footer -->
      <div class="px-6 py-4 border-t border-border flex justify-end gap-2">
        <Button variant="ghost" onclick={close}>{needsRestart ? 'Close' : 'Cancel'}</Button>
        {#if needsRestart}
          <Button variant="outline" onclick={restartApp}>Restart Now</Button>
        {/if}
        <Button
          variant="default"
          onclick={confirm}
          disabled={!inputValue.trim() || isActivating || feedback !== null}
        >
          Activate
        </Button>
      </div>
    </div>
  </div>
{/if}

