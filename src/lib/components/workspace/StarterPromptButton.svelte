<script lang="ts">
  import {
  starterPrompts,
  type StarterPrompt,
} from '$lib/data/starter-prompts';
  import { faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import TypewriterText from '$lib/components/ui/TypewriterText.svelte';

  interface Props {
    onSelect: (prompt: StarterPrompt) => void;
  }

  let { onSelect }: Props = $props();

  let isHovered = $state(false);
  let currentIndex = $state(0);

  // Get the labels for the typewriter
  const labels = starterPrompts.map((p) => p.label);

  function handleClick() {
    const prompt = starterPrompts[currentIndex];
    onSelect(prompt);
  }
</script>

<div class="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
  <button
    type="button"
    onclick={handleClick}
    onmouseenter={() => (isHovered = true)}
    onmouseleave={() => (isHovered = false)}
    class="
      starter-prompt-button
      flex items-center gap-2
      px-5 py-2.5
      rounded-full
      text-sm font-medium
      cursor-pointer
      transition-all duration-200
    "
    class:hovered={isHovered}
  >
    <Fa icon={faWandMagicSparkles} />
    <TypewriterText texts={labels} paused={isHovered} onIndexChange={(i) => (currentIndex = i)} />
  </button>
</div>

<style>
  .starter-prompt-button {
    background: transparent;
    color: var(--color-foreground);
    border: 1px solid var(--color-border);
  }

  .starter-prompt-button:hover,
  .starter-prompt-button.hovered {
    background: var(--color-primary);
    color: var(--color-primary-foreground);
    border-color: var(--color-primary);
  }
</style>
