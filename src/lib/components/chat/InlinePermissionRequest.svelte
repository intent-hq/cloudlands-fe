<script lang="ts">
  import { fly } from 'svelte/transition';
  import { onMount, onDestroy } from 'svelte';
  import { selectPermissionOption } from '$store/renderer/slices/permission/permission-slice';
  import type { PermissionRequest } from '$store/renderer/slices/permission/permission-slice';

  import Fa from 'svelte-fa';
  import { faShieldHalved, faChevronDown, faChevronLeft } from '@fortawesome/free-solid-svg-icons';
  import { parsePermissionRequest } from './permission-parser';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { shouldHandlePermissionShortcut } from './permission-shortcut';

  interface Props {
    request: PermissionRequest;
    pendingCount?: number;
    keyboardShortcutsEnabled?: boolean;
  }

  let { request, pendingCount = 1, keyboardShortcutsEnabled = false }: Props = $props();

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
    if (isProcessing || !shouldHandlePermissionShortcut(event, keyboardShortcutsEnabled)) return;

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
        <Fa icon={faShieldHalved} class="h-3.5 w-3.5" />
      </div>
      <div>
        <div class="type-body font-medium text-foreground">{display.question}</div>
        {#if request.agentName}
          <div class="type-caption text-subtle">
            {m.chat_inlinePermission_from_label({ name: request.agentName })}
          </div>
        {/if}
      </div>
    </div>
    {#if pendingCount > 1}
      <span class="type-caption rounded-full bg-muted px-2 py-0.5 text-subtle">
        {m.chat_inlinePermission_pending_label({ count: formatInteger(pendingCount) })}
      </span>
    {/if}
  </div>

  <!-- Content -->
  <div class="px-4 py-3">
    <!-- Details (command, path, etc.) -->
    {#if display.details}
      <div class="type-code mb-3 overflow-x-auto rounded bg-muted/50 p-2 text-subtle">
        {display.details}
      </div>
    {/if}

    <!-- Raw details toggle (for debugging/advanced users) -->
    {#if request.description}
      <button
        type="button"
        class="type-caption mb-3 flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        onclick={() => (showDetails = !showDetails)}
      >
        <Fa icon={showDetails ? faChevronDown : faChevronLeft} class="text-ui" />
        {showDetails
          ? m.chat_inlinePermission_hideRawDetails_label()
          : m.chat_inlinePermission_showRawDetails_label()}
      </button>

      {#if showDetails}
        <div
          class="type-code mb-3 max-h-32 overflow-x-auto overflow-y-auto rounded bg-muted/30 p-2 text-subtle"
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
          class="type-body flex items-center gap-3 rounded-md px-3 py-2 transition-colors
                 disabled:opacity-50 disabled:cursor-not-allowed
                 {option.destructive
            ? 'bg-muted text-muted-foreground hover:bg-danger hover:text-danger-background'
            : 'bg-primary/10 text-foreground hover:bg-primary hover:text-primary-foreground'}"
          onclick={() => handleSelectOption(option.id)}
          disabled={isProcessing}
        >
          {#if option.shortcut}
            <kbd
              class="type-caption inline-flex h-5 w-5 items-center justify-center rounded border border-current/30 bg-background/50"
            >
              {option.shortcut}
            </kbd>
          {/if}
          <span class="flex-1 text-left">{option.label}</span>
          {#if option.description}
            <span class="type-caption opacity-60">{option.description}</span>
          {/if}
        </button>
      {/each}
    </div>

    <!-- Keyboard hint -->
    <div class="type-caption mt-2 text-center text-subtle">
      {m.chat_inlinePermission_keyboardHint_label()}
    </div>
  </div>
</div>
