<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface Props {
    texts: string[];
    typingSpeed?: number; // ms per character
    erasingSpeed?: number; // ms per character
    pauseDuration?: number; // ms to pause after typing complete
    paused?: boolean;
    onIndexChange?: (index: number) => void;
  }

  let {
    texts,
    typingSpeed = 12,
    erasingSpeed = 12,
    pauseDuration = 4000,
    paused = false,
    onIndexChange,
  }: Props = $props();

  let displayText = $state('');
  let currentIndex = $state(0);
  let isTyping = $state(true); // true = typing, false = erasing
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  function tick() {
    if (paused) {
      // Schedule next check while paused
      timeoutId = setTimeout(tick, 100);
      return;
    }

    const currentText = texts[currentIndex];

    if (isTyping) {
      if (displayText.length < currentText.length) {
        // Still typing
        displayText = currentText.slice(0, displayText.length + 1);
        timeoutId = setTimeout(tick, typingSpeed);
      } else {
        // Finished typing, pause then start erasing
        timeoutId = setTimeout(() => {
          isTyping = false;
          tick();
        }, pauseDuration);
      }
    } else {
      if (displayText.length > 0) {
        // Still erasing
        displayText = displayText.slice(0, -1);
        timeoutId = setTimeout(tick, erasingSpeed);
      } else {
        // Finished erasing, move to next text
        currentIndex = (currentIndex + 1) % texts.length;
        onIndexChange?.(currentIndex);
        isTyping = true;
        timeoutId = setTimeout(tick, typingSpeed);
      }
    }
  }

  onMount(() => {
    // Start with a random text
    currentIndex = Math.floor(Math.random() * texts.length);
    onIndexChange?.(currentIndex);
    displayText = '';
    isTyping = true;
    tick();
  });

  onDestroy(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
</script>

<span class="typewriter-text">
  {displayText}<span class="cursor">|</span>
</span>

<style>
  .typewriter-text {
    display: inline;
  }

  .cursor {
    animation: blink 0.7s infinite;
    opacity: 1;
  }

  @keyframes blink {
    0%,
    50% {
      opacity: 1;
    }
    51%,
    100% {
      opacity: 0;
    }
  }
</style>
