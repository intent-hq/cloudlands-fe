<script lang="ts">
  import { faPaperPlane, faPencil } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { SuggestedPrompt } from '$shared/types';
  import { fade } from 'svelte/transition';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** Array of suggested prompts to display */
    prompts: SuggestedPrompt[];
    /** Called when a suggestion is selected - sends immediately */
    onSelect: (prompt: string) => void;
    /** Called when a suggestion is edited - loads into input without sending */
    onEdit?: (prompt: string) => void;
    /**
     * Whether to display the keyboard shortcut hints (⌃1 / Alt+1 etc.).
     * Hidden by default so the hints only appear on the focused chat when multiple
     * chats are visible at once — matches the shortcut's runtime gating.
     */
    showShortcutHints?: boolean;
  }

  let { prompts, onSelect, onEdit, showShortcutHints = false }: Props = $props();

  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  // Mac: Ctrl+number (⌥ produces special chars, ⌘ is tab switching)
  // Win/Linux: Alt+number (Ctrl is tab switching)
  const modifierSymbol = isMac ? '⌃' : 'Alt+';

  function handleClick(prompt: SuggestedPrompt) {
    onSelect(prompt);
  }

  function handleKeyDown(event: KeyboardEvent, prompt: SuggestedPrompt) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick(prompt);
    }
  }

  // Only the first 3 prompts get keyboard shortcut hints
  function hasShortcutHint(index: number): boolean {
    return index < 3;
  }
</script>

{#if prompts.length > 0}
  <div class="flex flex-col gap-px" transition:fade={{ duration: 150 }}>
    <div class="flex flex-col gap-px">
      {#each prompts as prompt, index (`prompt-${index}`)}
        <div
          role="button"
          tabindex="0"
          class="group flex items-baseline gap-3 py-0.5 px-1.5 rounded-md bg-transparent border border-transparent cursor-pointer text-left transition-all duration-150 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          onclick={() => handleClick(prompt)}
          onkeydown={(e) => handleKeyDown(e, prompt)}
        >
          <Fa
            icon={faPaperPlane}
            class="opacity-50 self-start mt-1.5 transition-all duration-150 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            size="xs"
          />
          <span class="flex-1">{prompt}</span>
          {#if onEdit}
            <Tooltip side="top" delayDuration={300}>
              {#snippet trigger()}
                <button
                  type="button"
                  class="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded cursor-pointer transition-all duration-150 text-muted-foreground/50 hover:text-foreground"
                  onclick={(e) => {
                    e.stopPropagation();
                    onEdit(prompt);
                  }}
                  aria-label={m.chat_suggestedPrompts_editInInput_ariaLabel()}
                >
                  <Fa icon={faPencil} size="xs" />
                </button>
              {/snippet}
              {#snippet content()}
                <span class="text-sm">{m.chat_suggestedPrompts_edit_tooltip()}</span>
              {/snippet}
            </Tooltip>
          {/if}
          {#if hasShortcutHint(index) && showShortcutHints}
            <span
              class="shrink-0 text-ui font-medium text-ghost group-hover:text-muted-foreground/60 transition-colors duration-150"
            >
              {modifierSymbol}{index + 1}
            </span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}
