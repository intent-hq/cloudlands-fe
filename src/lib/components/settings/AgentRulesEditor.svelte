<script lang="ts">
  import {
  onMount,
  onDestroy,
} from 'svelte';
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
  import { formatInteger } from '$lib/i18n/format';


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
        showError('Failed to load rules. Please try again.');
        return;
      }
      rulesContent = rule.content;
      originalContent = rulesContent;
      hasChanges = false;
    } catch (error) {
      logger.error('Failed to load rules', error instanceof Error ? error : undefined);
      showError('Failed to load rules. Please try again.');
    } finally {
      loading = false;
    }
  }

  async function saveRules() {
    if (!hasChanges) return;

    // Block saving if over limit
    if (isOverLimit) {
      showError(
        `Rules exceed the maximum length of ${formatInteger(MAX_RULES_LENGTH)} characters. ` +
          `Please reduce by ${formatInteger(excessChars)} characters before saving.`,
      );
      return;
    }

    try {
      saveStatus = 'saving';
      errorMessage = null;

      const trimmedContent = rulesContent.trim();
      const result = await appClient.settings.updateUserRule(RULE_TYPE, trimmedContent);

      if (result.success) {
        rulesContent = trimmedContent;
        // Don't update originalContent - we want to keep track of what was loaded
        // so "Undo changes" can revert to the initial state
        hasChanges = rulesContent !== originalContent;
        saveStatus = 'saved';

        // Clear saved status after 2 seconds
        if (savedStatusTimeout) clearTimeout(savedStatusTimeout);
        savedStatusTimeout = setTimeout(() => {
          saveStatus = 'idle';
        }, 2000);
      } else {
        saveStatus = 'idle';
        showError(result.error || 'Failed to save rules');
      }
    } catch (error) {
      logger.error('Failed to save rules', error instanceof Error ? error : undefined);
      saveStatus = 'idle';
      showError('Failed to save rules. Please try again.');
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

<div class="h-full flex flex-col gap-4">
  <div class="flex items-start justify-between gap-4 shrink-0">
    <div>
      <h2 class="text-sm font-medium text-foreground">Agent instructions</h2>
      <p class="text-sm text-muted-foreground mt-1">
        Custom instructions that will be included for all agents.
      </p>
    </div>

    {#if hasChanges}
      <Button variant="ghost-light" size="xs" onclick={undoChanges} class="">
        <Fa icon={faRotateLeft} class="w-3 h-3" />
        Undo changes
      </Button>
    {/if}
  </div>

  {#if errorMessage}
    <div
      class="bg-destructive/10 border border-destructive/20 text-destructive-foreground px-4 py-2 rounded-md text-sm shrink-0"
    >
      {errorMessage}
    </div>
  {/if}

  <!-- Character limit warning/error callout -->
  {#if isOverLimit}
    <div
      class="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-md text-destructive-foreground shrink-0"
    >
      <Fa icon={faCircleExclamation} class="w-4 h-4 flex-shrink-0" />
      <span class="text-sm">
        Rules exceed the maximum length of {formatInteger(MAX_RULES_LENGTH)} characters. Please reduce
        by {formatInteger(excessChars)} characters to save.
      </span>
    </div>
  {:else if isApproachingLimit}
    <div
      class="flex items-center gap-2 p-3 bg-warning/10 border border-warning/30 rounded-md text-warning shrink-0"
    >
      <Fa icon={faTriangleExclamation} class="w-4 h-4 flex-shrink-0" />
      <span class="text-sm">
        Approaching character limit ({charCountPercentage}% used). Consider reducing rules to avoid
        issues.
      </span>
    </div>
  {/if}

  {#if loading}
    <div
      class="flex items-center justify-center py-16 text-subtle border border-border rounded-lg bg-muted/20 grow"
    >
      <Fa icon={faCircleNotch} class="w-4 h-4 animate-spin mr-2" />
      Loading...
    </div>
  {:else}
    <div class="relative agent-rules-textarea grow flex flex-col min-h-0">
      <Textarea
        bind:value={rulesContent}
        oninput={handleContentChange}
        noFocusStyle
        placeholder="Add custom instructions for your agents...

Example:
# Development Guidelines
- Always write tests for new features
- Use TypeScript for type safety
- Follow the existing code style

# Agent Behavior
- Be thorough in code reviews
- Suggest improvements when appropriate
- Explain complex changes clearly"
        class="text-sm leading-relaxed grow {isOverLimit ? 'border-destructive' : ''}"
      />
      <!-- Saved indicator -->
      <div
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
          ? 'text-destructive'
          : 'text-warning'}"
      >
        <span>{charCountPercentage}% of limit used</span>
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
