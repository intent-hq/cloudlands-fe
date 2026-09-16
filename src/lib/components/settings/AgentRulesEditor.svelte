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
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger, formatNumber } from '$lib/i18n/format';
  import { store as appStore } from '$store/renderer/store';
  import {
    getUserRuleRequested,
    updateUserRuleRequested,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import {
    selectUserRuleOperation,
    selectUserRuleUpdateOperation,
  } from '$store/renderer/slices/settings-events/settings-events-selectors';

  interface Props {
    class?: string;
  }

  let { class: className = '' }: Props = $props();

  const RULE_TYPE = 'base-system-prompt';
  const DEBOUNCE_MS = 1000;
  const READ_KEY = 'agent-rules:read';
  const WRITE_KEY = 'agent-rules:write';
  const readOperation$ = selectUserRuleOperation(READ_KEY);
  const writeOperation$ = selectUserRuleUpdateOperation(WRITE_KEY);
  let seenReadVersion = selectUserRuleOperation.select(appStore.state, READ_KEY).version;
  let seenWriteVersion = selectUserRuleUpdateOperation.select(appStore.state, WRITE_KEY).version;
  let sentContent = '';

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

  onMount(() => {
    loading = true;
    errorMessage = null;
    appStore.dispatch(getUserRuleRequested(RULE_TYPE, READ_KEY));
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

  $effect(() => {
    const operation = $readOperation$;
    if (operation.version <= seenReadVersion || operation.status === 'loading') return;
    seenReadVersion = operation.version;
    loading = false;
    const rule = operation.status === 'success' ? operation.data : null;
    if (rule === null) {
      showError(m.settings_agentRules_loadError());
      return;
    }
    rulesContent = rule.content;
    originalContent = rulesContent;
    lastSavedContent = rulesContent.trim();
    hasChanges = false;
  });

  $effect(() => {
    const operation = $writeOperation$;
    if (operation.version <= seenWriteVersion || operation.status === 'loading') return;
    seenWriteVersion = operation.version;
    saveInFlight = false;
    const result = operation.status === 'success' ? operation.data : null;
    if (result?.success) {
      lastSavedContent = sentContent;
      hasChanges = rulesContent.trim() !== originalContent;
      if (rulesContent.trim() === lastSavedContent) {
        saveStatus = 'saved';
        if (savedStatusTimeout) clearTimeout(savedStatusTimeout);
        savedStatusTimeout = setTimeout(() => {
          saveStatus = 'idle';
        }, 2000);
      }
    } else {
      saveStatus = 'idle';
      showError(result?.error || m.settings_agentRules_saveErrorShort());
    }
    const trailing = trailingSaveNeeded;
    trailingSaveNeeded = false;
    if (trailing || (result?.success && rulesContent.trim() !== lastSavedContent)) void saveRules();
  });

  function saveRules() {
    if (saveInFlight) {
      trailingSaveNeeded = true;
      return;
    }

    const trimmedContent = rulesContent.trim();

    // Gate on drift from the persisted value (lastSavedContent), not on
    // hasChanges (which tracks the loaded original for "Undo changes"): a
    // revert back to the original must still reconcile a persisted draft
    // (intent-hq/intent#4094).
    if (!hasChanges && trimmedContent === lastSavedContent) return;

    // Block saving if over limit; never leave saveStatus stuck at 'saving'
    // when a trailing save bails out here.
    if (isOverLimit) {
      saveStatus = 'idle';
      showError(
        m.settings_agentRules_overLimitError({
          max: formatInteger(MAX_RULES_LENGTH),
          excess: formatInteger(excessChars),
        }),
      );
      return;
    }

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
    saveStatus = 'saving';
    errorMessage = null;
    sentContent = trimmedContent;
    appStore.dispatch(updateUserRuleRequested(RULE_TYPE, trimmedContent, undefined, WRITE_KEY));
  }

  function handleContentChange() {
    hasChanges = rulesContent !== originalContent;

    // Debounced auto-save: schedule on drift from the persisted value too,
    // so retyping the exact original after an auto-save still reconciles
    // the backend.
    if (debounceTimeout) clearTimeout(debounceTimeout);
    if (hasChanges || rulesContent.trim() !== lastSavedContent) {
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
    // Undo persists the revert: when an auto-save already stored a draft,
    // run the normal save flow so the backend converges to the original
    // (intent-hq/intent#4094). A revert during an in-flight save is covered
    // by the trailing coalesce in saveRules.
    if (rulesContent.trim() !== lastSavedContent) {
      void saveRules();
    }
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
        class="absolute top-2 right-2 transition-opacity duration-spring-moderate ease-spring-moderate motion-reduce:transition-none {saveStatus ===
        'saved'
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
