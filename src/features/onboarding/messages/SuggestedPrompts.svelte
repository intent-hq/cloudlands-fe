<script lang="ts">
  /**
   * SuggestedPrompts — Clickable prompt suggestions for Message 3.
   *
   * Displays a grid of common tasks the user might want to accomplish.
   * Clicking a prompt populates the chat input.
   */
  import { fly } from 'svelte/transition';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** Called when a prompt is clicked */
    onPromptSelect: (prompt: string) => void;
    /** Whether prompts are disabled (e.g., during workspace creation) */
    disabled?: boolean;
  }

  let { onPromptSelect, disabled = false }: Props = $props();

  const prompts = [
    {
      get label() {
        return m.onboarding_suggestedPrompts_fixBug_label();
      },
      get prompt() {
        return m.onboarding_suggestedPrompts_fixBug_prompt();
      },
      icon: '🐛',
    },
    {
      get label() {
        return m.onboarding_suggestedPrompts_addFeature_label();
      },
      get prompt() {
        return m.onboarding_suggestedPrompts_addFeature_prompt();
      },
      icon: '✨',
    },
    {
      get label() {
        return m.onboarding_suggestedPrompts_writeTests_label();
      },
      get prompt() {
        return m.onboarding_suggestedPrompts_writeTests_prompt();
      },
      icon: '🧪',
    },
    {
      get label() {
        return m.onboarding_suggestedPrompts_refactor_label();
      },
      get prompt() {
        return m.onboarding_suggestedPrompts_refactor_prompt();
      },
      icon: '🔧',
    },
    {
      get label() {
        return m.onboarding_suggestedPrompts_review_label();
      },
      get prompt() {
        return m.onboarding_suggestedPrompts_review_prompt();
      },
      icon: '👀',
    },
    {
      get label() {
        return m.onboarding_suggestedPrompts_explain_label();
      },
      get prompt() {
        return m.onboarding_suggestedPrompts_explain_prompt();
      },
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
