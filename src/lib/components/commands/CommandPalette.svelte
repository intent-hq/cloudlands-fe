<script lang="ts">
  /**
   * Inline Slash Command Palette
   *
   * Purpose: lightweight inline suggestions when the user types '/'
   * in a text input field (e.g., chat/prompt boxes). This is distinct
   * from the global modal CommandPalette.svelte (Cmd/Ctrl+K), which
   * provides app-wide navigation and actions.
   */
  import { fly } from 'svelte/transition';
  import { AgentId } from '$shared/types/branded-ids';
  import Fa from 'svelte-fa';
  import {
    faQuestionCircle,
    faBroom,
    faUndo,
    faRedo,
    faLocationDot,
    faDownload,
    faGear,
    faTerminal,
    faFolder,
    faEdit,
    faWrench,
    faPuzzlePiece,
  } from '@fortawesome/free-solid-svg-icons';
  import { commandRegistry } from '../../../features/acp-official/commands/command-registry';
  import type { CommandSuggestion } from '../../../features/acp-official/commands/command-registry';
  import { track } from '$lib/services/analytics';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('CommandPalette');

  interface Props {
    value?: string;
    visible?: boolean;
    sessionId: string;
    onCommand?: (result: any) => void;
    onCancel?: () => void;
  }

  let {
    value = $bindable(''),
    visible = $bindable(false),
    sessionId,
    onCommand,
    onCancel,
  }: Props = $props();

  let suggestions = $state<CommandSuggestion[]>([]);
  let selectedIndex = $state(0);
  let inputElement = $state<HTMLInputElement | null>(null);

  // Icon mapping
  const iconMap: Record<string, any> = {
    'fa-question-circle': faQuestionCircle,
    'fa-broom': faBroom,
    'fa-undo': faUndo,
    'fa-redo': faRedo,
    'fa-location-dot': faLocationDot,
    'fa-download': faDownload,
    'fa-gear': faGear,
    'fa-terminal': faTerminal,
    'fa-folder': faFolder,
    'fa-edit': faEdit,
    'fa-wrench': faWrench,
    'fa-puzzle-piece': faPuzzlePiece,
  };

  function getIcon(iconName?: string) {
    if (!iconName) return faTerminal;
    return iconMap[iconName] || faTerminal;
  }

  $effect(() => {
    if (value.startsWith('/')) {
      visible = true;
      updateSuggestions(value);
    } else {
      visible = false;
      suggestions = [];
    }
  });

  function updateSuggestions(input: string) {
    suggestions = commandRegistry.getSuggestions(input);
    selectedIndex = 0;
  }

  function selectSuggestion(index: number) {
    if (index >= 0 && index < suggestions.length) {
      const suggestion = suggestions[index];

      // Track command palette usage
      track('Used Command Palette', {
        action_type: 'command',
        query_length: value.length,
      });

      value = '/' + suggestion.command.name;

      // Add parameter hints
      if (suggestion.command.parameters && suggestion.command.parameters.length > 0) {
        const required = suggestion.command.parameters
          .filter((p) => p.required)
          .map((p) => `${p.name}=`);
        if (required.length > 0) {
          value += ' ' + required.join(' ');
        }
      }

      visible = false;
      inputElement?.focus();
    }
  }

  async function executeCommand() {
    if (!value.startsWith('/')) return;

    const result = await commandRegistry.executeCommand(value, {
      sessionId: AgentId(sessionId),
      timestamp: Date.now(),
    });

    onCommand?.(result);

    // Clear input on success
    if (result.success) {
      value = '';
      visible = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    // Only handle keys when palette is visible
    if (!visible || suggestions.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        event.stopPropagation();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        break;
      case 'Tab':
        event.preventDefault();
        event.stopPropagation();
        selectSuggestion(selectedIndex);
        break;
      case 'Enter':
        event.preventDefault();
        event.stopPropagation();
        if (suggestions.length > 0 && selectedIndex >= 0) {
          selectSuggestion(selectedIndex);
        } else {
          executeCommand();
        }
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        visible = false;
        onCancel?.();
        break;
    }
  }

  // Add global keydown listener when component is visible
  $effect(() => {
    if (typeof window === 'undefined') return;

    if (visible) {
      window.addEventListener('keydown', handleKeydown, true);
    } else {
      window.removeEventListener('keydown', handleKeydown, true);
    }

    // Cleanup on unmount or when visible changes
    return () => {
      window.removeEventListener('keydown', handleKeydown, true);
    };
  });

  function getCategoryIcon(category?: string) {
    switch (category) {
      case 'system':
        return faTerminal;
      case 'navigation':
        return faFolder;
      case 'editing':
        return faEdit;
      case 'utility':
        return faWrench;
      case 'custom':
        return faPuzzlePiece;
      default:
        return faTerminal;
    }
  }
</script>

<!-- Input Field -->
<div class="command-input-wrapper">
  <input
    bind:this={inputElement}
    bind:value
    onkeydown={handleKeydown}
    placeholder="Type / for commands..."
    class="command-input"
    autocomplete="off"
    spellcheck="false"
  />

  {#if value.startsWith('/')}
    <span class="command-indicator">
      <Fa icon={faTerminal} />
    </span>
  {/if}
</div>

<!-- Suggestions Dropdown -->
{#if visible && suggestions.length > 0}
  <div class="command-palette" transition:fly={{ y: -5, duration: 150 }}>
    <div class="suggestions-list">
      {#each suggestions as suggestion, index (suggestion.command.name)}
        <button
          class="suggestion-item"
          class:selected={index === selectedIndex}
          onclick={() => selectSuggestion(index)}
          onmouseenter={() => (selectedIndex = index)}
        >
          <span class="suggestion-icon">
            <Fa
              icon={getIcon(suggestion.command.icon) ||
                getCategoryIcon(suggestion.command.category)}
              size="sm"
            />
          </span>

          <div class="suggestion-content">
            <div class="suggestion-name">
              <span class="command-text">/{suggestion.command.name}</span>
              {#if suggestion.matchedAlias}
                <span class="alias-text">
                  {suggestion.matchedAlias}
                </span>
              {/if}
            </div>

            {#if suggestion.command.description}
              <div class="suggestion-description">
                {suggestion.command.description}
              </div>
            {/if}

            {#if suggestion.command.parameters && suggestion.command.parameters.length > 0}
              <div class="suggestion-params">
                {#each suggestion.command.parameters as param (param.name)}
                  <span class="param-badge" class:required={param.required}>
                    {param.name}{param.required ? '*' : ''}
                  </span>
                {/each}
              </div>
            {/if}
          </div>

          {#if suggestion.command.shortcut}
            <kbd class="suggestion-shortcut">
              {suggestion.command.shortcut}
            </kbd>
          {/if}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .command-input-wrapper {
    position: relative;
  }

  .command-input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background-color: hsl(var(--background));
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
    color: hsl(var(--foreground));
  }

  .command-input:focus {
    outline: none;
    box-shadow: 0 0 0 2px hsl(var(--ring));
  }

  .command-indicator {
    position: absolute;
    right: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    color: hsl(var(--muted-foreground) / 0.5);
    font-size: 0.75rem;
  }

  .command-palette {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    margin-bottom: 0.25rem;
    background-color: hsl(var(--background));
    border-radius: 0.375rem;
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.1),
      0 2px 4px -1px rgba(0, 0, 0, 0.06);
    border: 1px solid hsl(var(--border) / 0.5);
    max-height: 16rem;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    z-index: 50;
  }

  .suggestions-list {
    overflow-y: auto;
    flex: 1;
    padding: 0.25rem;
  }

  .suggestion-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.5rem;
    margin-bottom: 0.125rem;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 0.25rem;
    transition: all 0.15s ease;
    cursor: pointer;
  }

  .suggestion-item:last-child {
    margin-bottom: 0;
  }

  .suggestion-item:hover {
    background-color: hsl(var(--muted) / 0.5);
  }

  .suggestion-item.selected {
    background-color: hsl(var(--muted));
  }

  .suggestion-icon {
    font-size: 0.875rem;
    color: hsl(var(--muted-foreground) / 0.7);
    width: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .suggestion-item.selected .suggestion-icon {
    color: hsl(var(--foreground) / 0.8);
  }

  .suggestion-content {
    flex: 1;
    min-width: 0;
  }

  .suggestion-name {
    font-size: 0.8125rem;
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .command-text {
    color: hsl(var(--foreground));
    font-weight: 500;
  }

  .alias-text {
    color: hsl(var(--muted-foreground) / 0.6);
    font-size: 0.75rem;
  }

  .suggestion-description {
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground) / 0.8);
    margin-top: 0.0625rem;
    line-height: 1.3;
  }

  .suggestion-params {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.25rem;
  }

  .param-badge {
    padding: 0.0625rem 0.25rem;
    font-size: 0.625rem;
    border-radius: 0.125rem;
    background-color: hsl(var(--muted) / 0.3);
    color: hsl(var(--muted-foreground) / 0.8);
    font-family: monospace;
  }

  .param-badge.required {
    background-color: hsl(var(--primary) / 0.1);
    color: hsl(var(--primary));
  }

  .suggestion-shortcut {
    padding: 0.125rem 0.25rem;
    font-size: 0.625rem;
    background-color: hsl(var(--muted) / 0.3);
    border-radius: 0.125rem;
    color: hsl(var(--muted-foreground) / 0.7);
    font-family: monospace;
  }
</style>
