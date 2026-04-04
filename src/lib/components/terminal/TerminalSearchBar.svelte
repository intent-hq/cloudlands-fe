<script lang="ts">
  import Fa from 'svelte-fa';
  import { faSearch, faChevronUp, faChevronDown, faXmark } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    isOpen: boolean;
    hasMatches?: boolean;
    currentMatchIndex?: number;
    totalMatches?: number;
    focusTrigger?: number;
    onFindNext: (query: string) => void;
    onFindPrevious: (query: string) => void;
    onClose: () => void;
  }

  let {
    isOpen,
    hasMatches = true,
    currentMatchIndex = -1,
    totalMatches = 0,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    focusTrigger = 0,
    onFindNext,
    onFindPrevious,
    onClose,
  }: Props = $props();

  let searchQuery = $state('');
  let inputRef: HTMLInputElement | undefined = $state();

  // Auto-focus and select when opened or focus requested
  $effect(() => {
    // Track focusTrigger to react to focus requests
    if (isOpen && inputRef) {
      inputRef.focus();
      inputRef.select();
    }
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        onFindPrevious(searchQuery);
      } else {
        onFindNext(searchQuery);
      }
    }
  }
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="terminal-search-bar" onkeydown={handleKeydown}>
    <div class="terminal-search-input-wrapper">
      <Fa icon={faSearch} class="terminal-search-icon" />
      <input
        bind:this={inputRef}
        bind:value={searchQuery}
        type="text"
        placeholder="Find in terminal..."
        class="terminal-search-input"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
      />
      {#if searchQuery}
        {#if hasMatches === false}
          <span class="terminal-search-count terminal-search-no-results">No results</span>
        {:else if totalMatches > 0}
          <span class="terminal-search-count">{currentMatchIndex + 1} of {totalMatches}</span>
        {/if}
      {/if}
    </div>
    <div class="terminal-search-actions">
      <button
        type="button"
        class="terminal-search-nav-btn"
        onclick={() => onFindPrevious(searchQuery)}
        disabled={!searchQuery}
        title="Previous match (Shift+Enter)"
      >
        <Fa icon={faChevronUp} />
      </button>
      <button
        type="button"
        class="terminal-search-nav-btn"
        onclick={() => onFindNext(searchQuery)}
        disabled={!searchQuery}
        title="Next match (Enter)"
      >
        <Fa icon={faChevronDown} />
      </button>
      <button type="button" class="terminal-search-close-btn" onclick={onClose} title="Close (Esc)">
        <Fa icon={faXmark} />
      </button>
    </div>
  </div>
{/if}

<style>
  .terminal-search-bar {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    background: hsl(var(--background) / 0.9);
    backdrop-filter: blur(8px);
    border-left: 1px solid hsl(var(--border));
    border-bottom: 1px solid hsl(var(--border));
    box-shadow: -2px 2px 8px hsl(var(--background) / 0.5);
  }

  .terminal-search-input-wrapper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: hsl(var(--muted) / 0.5);
    border: 1px solid hsl(var(--border));
    padding: 0.25rem 0.5rem;
  }

  .terminal-search-input-wrapper :global(.terminal-search-icon) {
    color: hsl(var(--muted-foreground));
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  .terminal-search-input {
    width: 140px;
    border: none;
    background: transparent;
    font-size: 0.8125rem;
    color: hsl(var(--foreground));
    outline: none;
    min-width: 0;
  }

  .terminal-search-input::placeholder {
    color: hsl(var(--muted-foreground));
  }

  .terminal-search-count {
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
    white-space: nowrap;
  }

  .terminal-search-no-results {
    color: hsl(var(--destructive));
  }

  .terminal-search-actions {
    display: flex;
    align-items: center;
    gap: 0.125rem;
  }

  .terminal-search-nav-btn,
  .terminal-search-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
    border: none;
    background: transparent;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    transition: all 0.15s;
  }

  .terminal-search-nav-btn:hover:not(:disabled),
  .terminal-search-close-btn:hover {
    background: hsl(var(--muted));
    color: hsl(var(--foreground));
  }

  .terminal-search-nav-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
