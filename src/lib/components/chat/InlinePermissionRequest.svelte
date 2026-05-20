<script lang="ts">
  import { fly } from 'svelte/transition';
  import {
  onMount,
  onDestroy,
} from 'svelte';
  import { selectPermissionOption } from '$lib/store/slices/permission/permission-slice';
  import type { PermissionRequest } from '$lib/store/slices/permission/permission-slice';

  import Fa from 'svelte-fa';
  import {
  faShieldHalved,
  faChevronDown,
  faChevronUp,
} from '@fortawesome/free-solid-svg-icons';
  import { parsePermissionRequest } from './permission-parser';
  import { store as appStore } from '$lib/store/store';

  interface Props {
    request: PermissionRequest;
    pendingCount?: number;
  }

  let { request, pendingCount = 1 }: Props = $props();

  let showDetails = $state(false);
  let isProcessing = $state(false);

  // Parse the permission request into friendly display format
  const display = $derived(parsePermissionRequest(request.title, request.description));

  // Filter out "always" options (not implemented yet) and add keyboard shortcuts
  const optionsWithShortcuts = $derived.by(() => {
    const filtered = request.options.filter((opt) => !opt.id.toLowerCase().includes('always'));
    return filtered.map((opt, idx) => ({
      ...opt,
      shortcut: idx < 9 ? String(idx + 1) : null,
    }));
  });

  function getCategoryColor(category: string): string {
    switch (category) {
      case 'delete':
        return 'text-red-500 bg-red-500/10 border-red-500/30';
      case 'write':
        return 'text-amber-500 bg-amber-500/10 border-amber-500/30';
      case 'execute':
        return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30';
      case 'read':
        return 'text-blue-500 bg-blue-500/10 border-blue-500/30';
      default:
        return 'text-violet-500 bg-violet-500/10 border-violet-500/30';
    }
  }

  function handleSelectOption(optionId: string) {
    if (isProcessing) return;
    isProcessing = true;
    appStore.dispatch(selectPermissionOption(request.requestId, optionId));
    isProcessing = false;
  }

  // Keyboard shortcut handler
  function handleKeydown(event: KeyboardEvent) {
    if (isProcessing) return;

    // Check for number keys 1-9
    const num = parseInt(event.key, 10);
    if (num >= 1 && num <= optionsWithShortcuts.length) {
      event.preventDefault();
      const option = optionsWithShortcuts[num - 1];
      if (option) {
        handleSelectOption(option.id);
      }
    }
    // Escape to deny/cancel
    if (event.key === 'Escape') {
      event.preventDefault();
      const denyOption = request.options.find(
        (o) => o.id === 'reject_once' || o.id === 'deny' || o.destructive,
      );
      if (denyOption) {
        handleSelectOption(denyOption.id);
      }
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
  });
</script>

<div
  class="inline-permission-request my-3 rounded-lg border border-border bg-card overflow-hidden"
  in:fly={{ y: 10, duration: 200 }}
>
  <!-- Header with friendly question -->
  <div class="flex items-center justify-between px-4 py-3 bg-muted/30 border-b border-border">
    <div class="flex items-center gap-3">
      <div class={`p-1.5 rounded-md border ${getCategoryColor(display.category)}`}>
        <Fa icon={faShieldHalved} class="text-sm" />
      </div>
      <div>
        <div class="text-sm font-medium text-foreground">{display.question}</div>
        {#if request.agentName}
          <div class="text-xs text-subtle">from {request.agentName}</div>
        {/if}
      </div>
    </div>
    {#if pendingCount > 1}
      <span class="px-2 py-0.5 text-xs bg-muted rounded-full text-subtle">
        {pendingCount} pending
      </span>
    {/if}
  </div>

  <!-- Content -->
  <div class="px-4 py-3">
    <!-- Details (command, path, etc.) -->
    {#if display.details}
      <div
        class="text-xs text-subtle mb-3 font-mono bg-muted/50 p-2 rounded overflow-x-auto"
      >
        {display.details}
      </div>
    {/if}

    <!-- Raw details toggle (for debugging/advanced users) -->
    {#if request.description}
      <button
        type="button"
        class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
        onclick={() => (showDetails = !showDetails)}
      >
        <Fa icon={showDetails ? faChevronUp : faChevronDown} class="text-ui" />
        {showDetails ? 'Hide' : 'Show'} raw details
      </button>

      {#if showDetails}
        <div
          class="text-xs text-subtle mb-3 p-2 bg-muted/30 rounded font-mono overflow-x-auto max-h-32 overflow-y-auto"
        >
          {request.description}
        </div>
      {/if}
    {/if}

    <!-- Options with keyboard shortcuts -->
    <div class="flex flex-col gap-2">
      {#each optionsWithShortcuts as option (option.id)}
        <button
          type="button"
          class="flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors
                 disabled:opacity-50 disabled:cursor-not-allowed
                 {option.destructive
            ? 'bg-muted text-muted-foreground hover:bg-destructive hover:text-destructive-foreground'
            : 'bg-primary/10 text-foreground hover:bg-primary hover:text-primary-foreground'}"
          onclick={() => handleSelectOption(option.id)}
          disabled={isProcessing}
        >
          {#if option.shortcut}
            <kbd
              class="inline-flex items-center justify-center w-5 h-5 text-xs font-mono rounded border border-current/30 bg-background/50"
            >
              {option.shortcut}
            </kbd>
          {/if}
          <span class="flex-1 text-left">{option.label}</span>
          {#if option.description}
            <span class="text-xs opacity-60">{option.description}</span>
          {/if}
        </button>
      {/each}
    </div>

    <!-- Keyboard hint -->
    <div class="mt-2 text-xs text-subtle text-center">
      Press number key to select • Esc to cancel
    </div>
  </div>
</div>
