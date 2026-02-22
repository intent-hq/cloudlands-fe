<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    faToggleOn,
    faToggleOff,
    faFileExport,
    faFileImport,
    faCircleExclamation,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Logger } from '$lib/utils/logger';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import type {
    GetRulesResponse,
    UpdateRulesResponse,
    SetEnabledResponse,
    ExportRulesResponse,
  } from '../../../features/rules/workspace-rules.types';

  const logger = new Logger({ category: 'WorkspaceRulesEditor' });

  // Character limit constants
  // These align with the system prompt limit of 200k characters
  // User rules can take up to ~25% of the total prompt budget
  const MAX_RULES_LENGTH = 50000; // 50k characters
  const WARNING_THRESHOLD = 40000; // 80% of max - show warning

  // State
  let rulesContent = $state('');
  let rulesEnabled = $state(true);
  let saving = $state(false);
  let loading = $state(true);
  let errorMessage = $state<string | null>(null);
  let successMessage = $state<string | null>(null);
  let hasChanges = $state(false);
  let originalContent = '';

  // Derived character limit state
  let charCount = $derived(rulesContent.length);
  let isOverLimit = $derived(charCount > MAX_RULES_LENGTH);
  let isApproachingLimit = $derived(charCount > WARNING_THRESHOLD && !isOverLimit);
  let charCountPercentage = $derived(Math.min(100, Math.round((charCount / MAX_RULES_LENGTH) * 100)));
  let excessChars = $derived(isOverLimit ? charCount - MAX_RULES_LENGTH : 0);

  // Timeout references for cleanup
  let errorTimeout: ReturnType<typeof setTimeout> | null = null;
  let successTimeout: ReturnType<typeof setTimeout> | null = null;

  onMount(async () => {
    await loadRules();
  });

  onDestroy(() => {
    // Clean up timeouts to prevent memory leaks
    if (errorTimeout) clearTimeout(errorTimeout);
    if (successTimeout) clearTimeout(successTimeout);
  });

  function showError(message: string) {
    if (errorTimeout) clearTimeout(errorTimeout);
    errorMessage = message;
    errorTimeout = setTimeout(() => {
      errorMessage = null;
      errorTimeout = null;
    }, 5000);
  }

  function showSuccess(message: string) {
    if (successTimeout) clearTimeout(successTimeout);
    successMessage = message;
    successTimeout = setTimeout(() => {
      successMessage = null;
      successTimeout = null;
    }, 3000);
  }

  async function loadRules() {
    try {
      loading = true;
      errorMessage = null;
      const result = await window.electronAPI.invoke('user-rules:get-all', {});
      if (result.success) {
        // result.data is EndUserRulesConfig with all types (system, debug, etc.)
        // We want the 'system' type for workspace-wide rules
        const systemRules = result.data.system;
        rulesContent = systemRules?.content || '';
        originalContent = rulesContent;
        rulesEnabled = systemRules?.enabled !== false;
        hasChanges = false;
      } else {
        showError(result.error || 'Failed to load rules');
      }
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
        `Rules exceed the maximum length of ${MAX_RULES_LENGTH.toLocaleString()} characters. ` +
          `Please reduce by ${excessChars.toLocaleString()} characters before saving.`,
      );
      return;
    }

    try {
      saving = true;
      errorMessage = null;
      const trimmedContent = rulesContent.trim();
      const result = await window.electronAPI.invoke('user-rules:update', {
        content: trimmedContent,
      });

      if (result.success) {
        // Save the trimmed content as the new original
        rulesContent = trimmedContent;
        originalContent = trimmedContent;
        hasChanges = false;
        showSuccess('Rules saved successfully');
      } else {
        showError(result.error || 'Failed to save rules');
      }
    } catch (error) {
      logger.error('Failed to save rules', error instanceof Error ? error : undefined);
      showError('Failed to save rules. Please try again.');
    } finally {
      saving = false;
    }
  }

  async function toggleRules() {
    try {
      const newEnabledState = !rulesEnabled;
      const result = await window.electronAPI.invoke('user-rules:set-enabled', {
        enabled: newEnabledState,
      });

      if (result.success) {
        rulesEnabled = newEnabledState;
        showSuccess(`Rules ${newEnabledState ? 'enabled' : 'disabled'}`);
      } else {
        showError(result.error || 'Failed to toggle rules');
      }
    } catch (error) {
      logger.error('Failed to toggle rules', error instanceof Error ? error : undefined);
      showError('Failed to toggle rules. Please try again.');
    }
  }

  async function exportRules() {
    try {
      const result = await window.electronAPI.invoke('user-rules:export', {});
      if (result.success) {
        const blob = new Blob([result.data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'workspace-rules.json';
        a.click();
        URL.revokeObjectURL(url);
        showSuccess('Rules exported successfully');
      }
    } catch (error) {
      logger.error('Failed to export rules', error instanceof Error ? error : undefined);
      showError('Failed to export rules');
    }
  }

  async function importRules() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.md,.txt';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();

        // Try to parse as JSON first
        let importedContent = '';
        try {
          const parsed = JSON.parse(text);
          if (parsed.content) {
            importedContent = parsed.content;
          } else if (Array.isArray(parsed.rules)) {
            // Old format - convert to single content
            importedContent = parsed.rules
              .filter((r: any) => r.enabled !== false)
              .map((r: any) => r.content)
              .join('\n\n---\n\n');
          } else if (typeof parsed === 'string') {
            importedContent = parsed;
          }
        } catch {
          // Not JSON, treat as plain text/markdown
          importedContent = text;
        }

        if (importedContent) {
          rulesContent = importedContent;
          hasChanges = true;
          showSuccess('Rules imported successfully. Remember to save your changes.');
        } else {
          showError('Could not parse imported file');
        }
      } catch (error) {
        logger.error('Failed to import rules', error instanceof Error ? error : undefined);
        showError('Failed to import rules. Please check the file format.');
      }
    };
    input.click();
  }

  function handleContentChange() {
    hasChanges = rulesContent !== originalContent;
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Save on Cmd/Ctrl + S
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveRules();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="space-y-4">
  {#if errorMessage}
    <div
      class="bg-destructive/10 border border-destructive/20 text-destructive-foreground px-4 py-2 rounded-md text-sm"
    >
      {errorMessage}
    </div>
  {/if}

  {#if successMessage}
    <div
      class="bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 px-4 py-2 rounded-md text-sm"
    >
      {successMessage}
    </div>
  {/if}

  <div class="flex items-start justify-between">
    <div class="flex-1">
      <h3 class="text-lg font-semibold text-foreground">Space Rules</h3>
      <p class="text-xs text-muted-foreground mt-1">
        Define rules that guide how agents work within your spaces. These rules are included in
        every agent's system prompt.
      </p>
    </div>

    <!-- No buttons needed here -->
  </div>

  {#if loading}
    <div class="text-center py-8 text-muted-foreground">Loading rules...</div>
  {:else}
    <div class="space-y-3">
      <!-- Character limit warning/error callout -->
      {#if isOverLimit}
        <div
          class="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-md text-destructive-foreground"
        >
          <Fa icon={faCircleExclamation} class="w-4 h-4 flex-shrink-0" />
          <span class="text-sm">
            Rules exceed the maximum length of {MAX_RULES_LENGTH.toLocaleString()} characters.
            Please reduce by {excessChars.toLocaleString()} characters to save.
          </span>
        </div>
      {:else if isApproachingLimit}
        <div
          class="flex items-center gap-2 p-3 bg-warning/10 border border-warning/30 rounded-md text-warning"
        >
          <Fa icon={faTriangleExclamation} class="w-4 h-4 flex-shrink-0" />
          <span class="text-sm">
            Approaching character limit ({charCountPercentage}% used). Consider reducing rules to
            avoid issues.
          </span>
        </div>
      {/if}

      <div class="relative workspace-rules-textarea">
        <Textarea
          bind:value={rulesContent}
          oninput={handleContentChange}
          placeholder="Example:
# Development Guidelines
- Always write tests for new features
- Use TypeScript for type safety
- Follow the existing code style

# Agent Behavior
- Be thorough in code reviews
- Suggest improvements when appropriate
- Explain complex changes clearly"
          class="min-h-[400px] text-sm resize-y placeholder:opacity-40 placeholder:italic {!rulesEnabled
            ? 'opacity-50'
            : ''} {isOverLimit ? 'border-destructive' : ''}"
          disabled={!rulesEnabled}
        />

        <!-- Character count indicator - only show when approaching or over limit -->
        {#if isApproachingLimit || isOverLimit}
          <div
            class="flex items-center justify-end mt-2 text-xs {isOverLimit
              ? 'text-destructive'
              : 'text-warning'}"
          >
            <span>{charCountPercentage}% of limit used</span>
          </div>
        {/if}
      </div>

      {#if hasChanges}
        <div
          class="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-md"
        >
          <span class="text-sm text-muted-foreground">You have unsaved changes</span>
          <div class="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onclick={() => {
                rulesContent = originalContent;
                hasChanges = false;
              }}
            >
              Discard
            </Button>
            <Button
              variant="default"
              size="sm"
              onclick={saveRules}
              disabled={saving || isOverLimit}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .workspace-rules-textarea :global(textarea::placeholder) {
    opacity: 0.2;
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
