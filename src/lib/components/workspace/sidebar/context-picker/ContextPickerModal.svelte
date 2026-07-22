<script lang="ts">
  /**
   * ContextPickerModal - Modal overlay for picking context items
   *
   * A sleek modal that shows when user clicks a provider in AddContextSection.
   * Handles Linear issues, GitHub issues, Sentry issues, and browser URLs.
   */
  import type { ContextProvider } from '$features/context/types';
  import ProviderIcon from '$lib/components/icons/ProviderIcon.svelte';
  import { faTimes } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import {
  fade,
  fly,
} from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import LinearPicker from './LinearPicker.svelte';
  import SentryPicker from './SentryPicker.svelte';
  import BrowserUrlPicker from './BrowserUrlPicker.svelte';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';

  interface Props {
    provider: ContextProvider;
    workspaceId: string;
    isOpen: boolean;
    onClose: () => void;
    onSelect: (item: { type: string; title: string; url: string; identifier: string; metadata?: Record<string, unknown> }) => void;
  }

  let { provider, workspaceId, isOpen, onClose, onSelect }: Props = $props();

  const providerTitles: Record<ContextProvider, string> = {
    linear: 'Linear Issues',
    github: 'GitHub Issues',
    sentry: 'Sentry Issues',
    browser: 'Add URL',
    internal: 'Context',
  };

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  // Escape layer: registered only while open so stacked overlays dismiss
  // one at a time in LIFO order
  $effect(() => {
    if (!isOpen) return;
    return pushEscapeLayer(() => onClose());
  });
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50" transition:fade={{ duration: 150 }}>
    <button
      type="button"
      class="absolute inset-0 bg-black/50 backdrop-blur-sm border-0 p-0"
      aria-label="Close modal"
      onclick={handleBackdropClick}
    ></button>
    <div class="absolute inset-0 flex items-center justify-center">
      <div
        class="bg-background border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[70vh] flex flex-col overflow-hidden"
        transition:fly={{ y: 20, duration: 200, easing: quintOut }}
      >
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-border">
        <div class="flex items-center gap-2">
          <ProviderIcon {provider} size={18} />
          <h2 class="text-sm font-semibold">{providerTitles[provider]}</h2>
        </div>
        <button
          type="button"
          class="p-1.5 rounded hover:bg-muted transition-colors cursor-pointer"
          onclick={onClose}
        >
          <Fa icon={faTimes} size="sm" class="text-ghost" />
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto">
        {#if provider === 'linear'}
          <LinearPicker {workspaceId} {onSelect} {onClose} />
        {:else if provider === 'sentry'}
          <SentryPicker {workspaceId} {onSelect} {onClose} />
        {:else if provider === 'browser'}
          <BrowserUrlPicker {workspaceId} {onSelect} {onClose} />
        {:else if provider === 'github'}
          <div class="p-8 text-center text-subtle">
            <p class="text-sm">GitHub issues coming soon...</p>
            <p class="text-xs mt-2">Use browser URLs to link to GitHub issues for now.</p>
          </div>
        {:else}
          <div class="p-8 text-center text-subtle">
            <p class="text-sm">Select a different provider</p>
          </div>
        {/if}
      </div>
      </div>
    </div>
  </div>
{/if}
