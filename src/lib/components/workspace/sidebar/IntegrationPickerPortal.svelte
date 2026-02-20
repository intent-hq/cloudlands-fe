<script lang="ts">
  /**
   * IntegrationPickerPortal - Portal wrapper for IssueSuggestions
   *
   * Opens the integration picker (Linear, GitHub, Sentry, Browser URLs) in a portal
   * with click-outside-to-close behavior.
   */
  import Portal from '$lib/components/ui/Portal.svelte';
  import IssueSuggestions, {
    type IssueSelectionData,
  } from '$lib/components/workspace/initializer/IssueSuggestions.svelte';

  interface Props {
    open: boolean;
    onClose: () => void;
    onSelect?: (text: string, metadata?: IssueSelectionData) => void;
    /** GitHub repository owner (e.g., "augmentcode") */
    repositoryOwner?: string;
    /** GitHub repository name (e.g., "augment") */
    repositoryName?: string;
    /** Anchor element to position the picker near */
    anchorElement?: HTMLElement | null;
  }

  let { open, onClose, onSelect, repositoryOwner, repositoryName, anchorElement }: Props = $props();

  // Calculate position based on anchor element
  const position = $derived.by(() => {
    if (!anchorElement) {
      // Fallback to centered
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }

    const rect = anchorElement.getBoundingClientRect();
    // Position overlapping the anchor - start at the top of the anchor
    const top = rect.top;
    const left = rect.left;

    // Ensure it doesn't go off-screen
    const maxLeft = window.innerWidth - 480; // 30rem = 480px
    const adjustedLeft = Math.min(left, maxLeft);

    return {
      top: `${top}px`,
      left: `${adjustedLeft}px`,
      transform: 'none',
    };
  });

  function handleSelect(text: string, metadata?: IssueSelectionData) {
    onSelect?.(text, metadata);
    onClose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <Portal zIndex={50}>
    <!-- Backdrop for click-outside -->
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-50" onclick={handleBackdropClick}>
      <!-- Picker container - positioned near anchor or centered -->
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div
        class="absolute bg-popover border border-border rounded-lg shadow-lg min-w-[30rem] max-w-[40rem] overflow-hidden"
        style="top: {position.top}; left: {position.left}; transform: {position.transform};"
        onclick={(e: MouseEvent) => e.stopPropagation()}
      >
        <IssueSuggestions
          onSelect={handleSelect}
          {repositoryOwner}
          {repositoryName}
          initiallyExpanded={true}
          hideToggle={true}
        />
      </div>
    </div>
  </Portal>
{/if}
