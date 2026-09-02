<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faRotateLeft,
    faCheck,
    faCircleNotch,
    faCircleExclamation,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Logger } from '$lib/utils/logger';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import { appClient } from '$lib/client';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger, formatNumber } from '$lib/i18n/format';

  interface Props {
    class?: string;
  }

  let { class: className = '' }: Props = $props();

  const logger = new Logger({ category: 'AgentRulesEditor' });

  const RULE_TYPE = 'base-system-prompt';
  const DEBOUNCE_MS = 1000;

  // Character limit constants - similar to WorkspaceRulesEditor
  const MAX_RULES_LENGTH = 50000; // 50k characters
  const WARNING_THRESHOLD = 40000; // 80% of max

  // State
  let rulesContent = $state('');
  let loading = $state(true);
  let errorMessage = $state<string | null>(null);
  let hasChanges = $state(false);
  let originalContent = '';
  let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle');

  // Single-flight save with trailing coalesce: never run two rules.update
  // requests concurrently (they could resolve out of order and leave the
  // backend with a stale payload), and re-save after completion if the text
  // changed while the request was in flight.
  let saveInFlight = false;
  let trailingSaveNeeded = false;
  let lastSavedContent = '';

  // Derived character limit state
  let charCount = $derived(rulesContent.length);
  let isOverLimit = $derived(charCount > MAX_RULES_LENGTH);
  let isApproachingLimit = $derived(charCount > WARNING_THRESHOLD && !isOverLimit);
  let charCountPercentage = $derived(
    Math.min(100, Math.round((charCount / MAX_RULES_LENGTH) * 100)),
  );
  let excessChars = $derived(isOverLimit ? charCount - MAX_RULES_LENGTH : 0);

  // Timeout references for cleanup
  let errorTimeout: ReturnType<typeof setTimeout> | null = null;
  let debounceTimeout: ReturnType<typeof setTimeout> | null = null;
  let savedStatusTimeout: ReturnType<typeof setTimeout> | null = null;

  onMount(async () => {
    await loadRules();
  });

  onDestroy(() => {
    if (errorTimeout) clearTimeout(errorTimeout);
    if (debounceTimeout) clearTimeout(debounceTimeout);
    if (savedStatusTimeout) clearTimeout(savedStatusTimeout);
  });

  function showError(message: string) {
    if (errorTimeout) clearTimeout(errorTimeout);
    errorMessage = message;
    errorTimeout = setTimeout(() => {
      errorMessage = null;
      errorTimeout = null;
    }, 5000);
  }

  async function loadRules() {
    try {
      loading = true;
      errorMessage = null;

      // rules.get (§5.21): an absent override reads back as an empty default;
      // null means the wire probe itself failed.
      const rule = await appClient.settings.getUserRule(RULE_TYPE);
      if (rule === null) {
        showError(m.settings_agentRules_loadError());
        return;
      }
      rulesContent = rule.content;
      originalContent = rulesContent;
      lastSavedContent = rulesContent;
      hasChanges = false;
    } catch (error) {
      logger.error('Failed to load rules', error instanceof Error ? error : undefined);
      showError(m.settings_agentRules_loadError());
    } finally {
      loading = false;
    }
  }

  async function saveRules() {
    if (saveInFlight) {
      trailingSaveNeeded = true;
      return;
    }

    if (!hasChanges) return;

    // Block saving if over limit
    if (isOverLimit) {
      showError(
        m.settings_agentRules_overLimitError({
          max: formatInteger(MAX_RULES_LENGTH),
          excess: formatInteger(excessChars),
        }),
      );
      return;
    }

    const trimmedContent = rulesContent.trim();

    // The backend already holds this exact value: skip the redundant wire
    // call and mark the clean/saved state directly.
    if (trimmedContent === lastSavedContent) {
      hasChanges = trimmedContent !== originalContent;
      saveStatus = 'saved';
      if (savedStatusTimeout) clearTimeout(savedStatusTimeout);
      savedStatusTimeout = setTimeout(() => {
        saveStatus = 'idle';
      }, 2000);
      return;
    }

    saveInFlight = true;
    let saveSucceeded = false;
    try {
      saveStatus = 'saving';
      errorMessage = null;

      const result = await appClient.settings.updateUserRule(RULE_TYPE, trimmedContent);

      if (result.success) {
        saveSucceeded = true;
        lastSavedContent = trimmedContent;
        // Don't rewrite rulesContent with the trimmed value - reassigning it
        // mid-edit clobbers the textarea and swallows leading/trailing
        // newlines the user just typed
        // Don't update originalContent - we want to keep track of what was loaded
        // so "Undo changes" can revert to the initial state
        hasChanges = rulesContent.trim() !== originalContent;

        // Only show "saved" when the persisted value matches the live text;
        // otherwise the trailing save below re-runs and reports instead.
        if (rulesContent.trim() === lastSavedContent) {
          saveStatus = 'saved';

          // Clear saved status after 2 seconds
          if (savedStatusTimeout) clearTimeout(savedStatusTimeout);
          savedStatusTimeout = setTimeout(() => {
            saveStatus = 'idle';
          }, 2000);
        }
      } else {
        saveStatus = 'idle';
        showError(result.error || m.settings_agentRules_saveErrorShort());
      }
    } catch (error) {
      logger.error('Failed to save rules', error instanceof Error ? error : undefined);
      saveStatus = 'idle';
      showError(m.settings_agentRules_saveError());
    } finally {
      saveInFlight = false;
    }

    // Trailing coalesce: if the text changed while the request was in flight
    // (or another save was requested), save again immediately so the backend
    // converges to the latest text.
    const trailing = trailingSaveNeeded;
    trailingSaveNeeded = false;
    if (trailing || (saveSucceeded && rulesContent.trim() !== lastSavedContent)) {
      void saveRules();
    }
  }

  function handleContentChange() {
    hasChanges = rulesContent !== originalContent;

    // Debounced auto-save
    if (debounceTimeout) clearTimeout(debounceTimeout);
    if (hasChanges) {
      debounceTimeout = setTimeout(() => {
        saveRules();
      }, DEBOUNCE_MS);
    }
  }

  function undoChanges() {
    rulesContent = originalContent;
    hasChanges = false;
    saveStatus = 'idle';
    if (debounceTimeout) clearTimeout(debounceTimeout);
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Save immediately on Cmd/Ctrl + S
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (debounceTimeout) clearTimeout(debounceTimeout);
      saveRules();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="h-full flex flex-col gap-2 {className}">
  {#if hasChanges}
    <div
      data-testid="agent-rules-header"
      class="flex min-w-0 shrink-0 flex-wrap items-center gap-2"
    >
      <Button variant="ghost-light" size="xs" onclick={undoChanges} class="">
        <Fa icon={faRotateLeft} class="w-3 h-3" />
        {m.settings_agentRules_undoChanges()}
      </Button>
    </div>
  {/if}

  {#if errorMessage}
    <div
      class="bg-danger-background/10 border border-danger/20 text-danger px-4 py-2 rounded-md text-sm shrink-0"
    >
      {errorMessage}
    </div>
  {/if}

  <!-- Character limit warning/error callout -->
  {#if isOverLimit}
    <div
      class="flex items-center gap-2 p-3 bg-danger-background/10 border border-danger/30 rounded-md text-danger shrink-0"
    >
      <Fa icon={faCircleExclamation} class="w-4 h-4 flex-shrink-0" />
      <span class="text-sm">
        {m.settings_agentRules_overLimitCallout({
          max: formatInteger(MAX_RULES_LENGTH),
          excess: formatInteger(excessChars),
        })}
      </span>
    </div>
  {:else if isApproachingLimit}
    <div
      class="flex items-center gap-2 p-3 bg-warning/10 border border-warning/30 rounded-md text-warning shrink-0"
    >
      <Fa icon={faTriangleExclamation} class="w-4 h-4 flex-shrink-0" />
      <span class="text-sm">
        {m.settings_agentRules_approachingLimit({
          percent: formatNumber(charCountPercentage / 100, {
            style: 'percent',
            maximumFractionDigits: 0,
          }),
        })}
      </span>
    </div>
  {/if}

  {#if loading}
    <div
      class="flex items-center justify-center py-16 text-subtle border border-border rounded-lg bg-muted/20 grow"
    >
      <Fa icon={faCircleNotch} class="w-4 h-4 animate-spin mr-2" />
      {m.settings_agentRules_loading()}
    </div>
  {:else}
    <div class="relative agent-rules-textarea grow flex flex-col min-h-0">
      <Textarea
        bind:value={rulesContent}
        oninput={handleContentChange}
        noFocusStyle
        placeholder={m.settings_agentRules_placeholder()}
        class="text-sm leading-relaxed grow {isOverLimit ? 'border-danger' : ''}"
      />
      <!-- Saved indicator -->
      <div
        data-testid="agent-rules-saved-indicator"
        class="absolute top-2 right-2 transition-opacity duration-200 {saveStatus === 'saved'
          ? 'opacity-100'
          : 'opacity-0'}"
      >
        <Fa icon={faCheck} class="w-3.5 h-3.5 text-emerald-500" />
      </div>
    </div>

    <!-- Character count indicator - only show when approaching or over limit -->
    {#if isApproachingLimit || isOverLimit}
      <div
        class="flex items-center justify-end shrink-0 {isOverLimit
          ? 'text-danger'
          : 'text-warning'}"
      >
        <span>
          {m.settings_autoSave_limitUsed({
            percent: formatNumber(charCountPercentage / 100, {
              style: 'percent',
              maximumFractionDigits: 0,
            }),
          })}
        </span>
      </div>
    {/if}
  {/if}
</div>

<style>
  .agent-rules-textarea :global(textarea) {
    height: 100%;
    min-height: 200px;
    resize: none;
  }

  .agent-rules-textarea :global(textarea::placeholder) {
    opacity: 0.4;
    font-style: italic;
  }

  /* Warning color fallback if not defined in theme */
  .text-warning {
    color: hsl(38, 92%, 50%);
  }

  .bg-warning\/10 {
    background-color: hsla(38, 92%, 50%, 0.1);
  }

  .border-warning\/30 {
    border-color: hsla(38, 92%, 50%, 0.3);
  }
</style>
