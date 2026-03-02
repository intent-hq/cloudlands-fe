<script lang="ts">
  import { faPaperPlane } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { SuggestedPrompt } from '$shared/types';
  import { fade } from 'svelte/transition';

  interface Props {
    /** Array of suggested prompts to display */
    prompts: SuggestedPrompt[];
    /** Called when a suggestion is selected - sends immediately */
    onSelect: (prompt: string) => void;
  }

  let { prompts, onSelect }: Props = $props();

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
</script>

{#if prompts.length > 0}
  <div class="flex flex-col gap-px" transition:fade={{ duration: 150 }}>
    <div class="flex flex-col gap-px">
      {#each prompts as prompt, index (`prompt-${index}`)}
        <button
          type="button"
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
          {#if index < 3}
            <span
              class="shrink-0 text-ui font-medium text-ghost group-hover:text-muted-foreground/60 transition-colors duration-150"
            >
              {modifierSymbol}{index + 1}
            </span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
{/if}
