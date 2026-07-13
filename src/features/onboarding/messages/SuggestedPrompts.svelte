<script lang="ts">
  /**
   * SuggestedPrompts — Clickable prompt suggestions for Message 3.
   *
   * Displays a grid of common tasks the user might want to accomplish.
   * Clicking a prompt populates the chat input.
   */
  import { fly } from 'svelte/transition';

  interface Props {
    /** Called when a prompt is clicked */
    onPromptSelect: (prompt: string) => void;
    /** Whether prompts are disabled (e.g., during workspace creation) */
    disabled?: boolean;
  }

  let { onPromptSelect, disabled = false }: Props = $props();

  const prompts = [
    {
      label: 'Fix a bug',
      prompt: 'Help me fix a bug in this project',
      icon: '🐛',
    },
    {
      label: 'Add a feature',
      prompt: 'Help me add a new feature',
      icon: '✨',
    },
    {
      label: 'Write tests',
      prompt: 'Help me write tests for this project',
      icon: '🧪',
    },
    {
      label: 'Refactor code',
      prompt: 'Help me refactor and improve the code quality',
      icon: '🔧',
    },
    {
      label: 'Review code',
      prompt: 'Review the recent changes and suggest improvements',
      icon: '👀',
    },
    {
      label: 'Explain codebase',
      prompt: 'Help me understand how this codebase is structured',
      icon: '📖',
    },
  ];
</script>

<div class="grid grid-cols-2 gap-2">
  {#each prompts as prompt, i}
    <button
      type="button"
      class="flex items-center gap-2.5 rounded-lg border border-border/40 bg-card/30
             px-3 py-2.5 text-left text-sm transition-all duration-150
             hover:bg-card/60 hover:border-border/60 hover:shadow-sm
             disabled:opacity-40 disabled:cursor-not-allowed
             cursor-pointer"
      in:fly={{ y: 8, duration: 200, delay: 50 * i }}
      onclick={() => onPromptSelect(prompt.prompt)}
      {disabled}
    >
      <span class="text-base shrink-0">{prompt.icon}</span>
      <span class="text-foreground">{prompt.label}</span>
    </button>
  {/each}
</div>
