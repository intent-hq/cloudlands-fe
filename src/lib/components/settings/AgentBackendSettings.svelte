<script lang="ts">
  /**
   * Agent Backend Settings Component
   *
   * Daemon-side agent configuration:
   * - agents.maxConcurrent: concurrent agent session cap
   */

  import { appClient } from '$lib/client';
  import { onMount } from 'svelte';
  import { Input } from '$lib/components/ui/input';

  // Settings state
  let maxConcurrent = $state(0);
  let inputValue = $state('');
  let settingsError = $state('');

  const SETTING_PATH = 'agents.maxConcurrent';

  onMount(async () => {
    await loadSettings();
  });

  async function loadSettings() {
    try {
      const entry = await appClient.settings.get(SETTING_PATH);
      const value = typeof entry?.value === 'number' ? entry.value : 0;
      maxConcurrent = value;
      // Display empty for 0 (Auto)
      inputValue = value === 0 ? '' : String(value);
      settingsError = '';
    } catch (error) {
      settingsError = 'Failed to load agent settings from the backend.';
      console.error('Failed to load agent settings:', error);
    }
  }

  function handleInput(event: Event) {
    const target = event.target as HTMLInputElement;
    inputValue = target.value;
  }

  async function handleBlur() {
    await saveSettings();
  }

  async function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      await saveSettings();
    }
  }

  async function saveSettings() {
    try {
      // Parse input: empty or 0 → 0 (auto), positive integer → cap
      const trimmed = inputValue.trim();
      let newValue: number;

      if (trimmed === '' || trimmed === '0') {
        newValue = 0;
      } else {
        const parsed = parseInt(trimmed, 10);
        if (isNaN(parsed) || parsed < 0) {
          // Invalid: reset to current value
          inputValue = maxConcurrent === 0 ? '' : String(maxConcurrent);
          return;
        }
        // Clamp to max 200 per daemon schema
        newValue = Math.min(parsed, 200);
      }

      // Only save if changed
      if (newValue !== maxConcurrent) {
        await appClient.settings.update([{ path: SETTING_PATH, value: newValue }]);
        maxConcurrent = newValue;
      }

      // Update display (normalize to empty for 0)
      inputValue = newValue === 0 ? '' : String(newValue);
      settingsError = '';
    } catch (error) {
      settingsError = 'Failed to save agent settings.';
      console.error('Failed to save agent settings:', error);
    }
  }

  const displayValue = $derived(maxConcurrent === 0 ? 'Auto (based on system RAM)' : String(maxConcurrent));
</script>

<div class="space-y-4">
  {#if settingsError}
    <div class="text-xs text-destructive mb-2">
      {settingsError}
    </div>
  {/if}

  <!-- Max Concurrent Agents -->
  <div class="flex items-center justify-between gap-4">
    <div class="flex-1 min-w-0">
      <p class="text-sm font-medium text-foreground">Max concurrent agents</p>
      <p class="text-xs text-subtle mt-0.5">
        Current: {displayValue}. Set to 0 or leave empty for auto (based on system RAM), or specify
        1-200. Changes apply on daemon restart.
      </p>
    </div>
    <div class="shrink-0 w-32">
      <Input
        type="number"
        bind:value={inputValue}
        oninput={handleInput}
        onblur={handleBlur}
        onkeydown={handleKeydown}
        placeholder="Auto"
        min="0"
        max="200"
        step="1"
        class="h-9 text-sm"
      />
    </div>
  </div>
</div>
