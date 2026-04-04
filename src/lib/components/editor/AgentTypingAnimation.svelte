<!--
  Agent Typing Animation Component

  Handles smooth typing animations when following an agent's edits.
  Integrates with CodeEditor to show text appearing/disappearing character by character.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { selectIsFollowing, selectAgentColor } from '$lib/store/slices/agent-follow/agent-follow-selectors';

  const isFollowing$ = selectIsFollowing();
  const agentColor$ = selectAgentColor();

  interface Props {
    content: string;
    onContentChange: (content: string) => void;
    isActive?: boolean;
  }

  let { content = $bindable(), onContentChange, isActive = false }: Props = $props();

  let animationController: AbortController | null = null;
  let currentAnimation: Promise<void> | null = null;
  let animatedText = '';

  // Listen for animation events
  onMount(() => {
    window.addEventListener('agent-follow-animation', handleAnimationEvent);
    return () => {
      window.removeEventListener('agent-follow-animation', handleAnimationEvent);
      cancelCurrentAnimation();
    };
  });

  function handleAnimationEvent(event: Event) {
    if (!isActive || !$isFollowing$) return;

    const detail = (event as CustomEvent).detail as
      | { content?: string; isAddition?: boolean; speed?: number }
      | undefined;
    if (!detail || typeof detail.content !== 'string') return;
    const { content: newContent, isAddition, speed = 30 } = detail;

    // Cancel any ongoing animation
    cancelCurrentAnimation();

    // Start new animation
    if (isAddition) {
      animateAddition(newContent, speed);
    } else {
      animateRemoval(newContent, speed);
    }
  }

  function cancelCurrentAnimation() {
    if (animationController) {
      animationController.abort();
      animationController = null;
    }
    currentAnimation = null;
  }

  async function animateAddition(text: string, speed: number) {
    animationController = new AbortController();
    const signal = animationController.signal;

    const chars = text.split('');

    currentAnimation = (async () => {
      for (let i = 0; i < chars.length; i++) {
        if (signal.aborted) break;

        animatedText += chars[i];
        content = content + chars[i];
        onContentChange(content);

        // Add slight randomization to make it feel more natural
        const delay = speed + (Math.random() * 10 - 5);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    })();

    await currentAnimation;
  }

  async function animateRemoval(text: string, speed: number) {
    animationController = new AbortController();
    const signal = animationController.signal;

    // Find where the text to remove is in the content
    const removeIndex = content.indexOf(text);
    if (removeIndex === -1) return;

    const beforeText = content.slice(0, removeIndex);
    const afterText = content.slice(removeIndex + text.length);

    currentAnimation = (async () => {
      for (let i = text.length; i > 0; i--) {
        if (signal.aborted) break;

        const remainingText = text.slice(0, i - 1);
        content = beforeText + remainingText + afterText;
        onContentChange(content);

        // Removal is typically faster than addition
        const delay = speed * 0.7 + (Math.random() * 5 - 2.5);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    })();

    await currentAnimation;
  }

  // Provide visual feedback when animating
  let isAnimating = $derived(currentAnimation !== null);
  let cursorClass = $derived(isAnimating ? 'animate-blink' : '');
</script>

{#if isAnimating && $isFollowing$}
  <div
    class="absolute top-2 right-2 flex items-center gap-2 px-2 py-1 rounded-md z-50"
    style="background: {$agentColor$?.start}20; border: 1px solid {$agentColor$?.start}40;"
  >
    <div
      class="w-2 h-2 rounded-full {cursorClass}"
      style="background: {$agentColor$?.start};"
    ></div>
    <span class="text-xs" style="color: {$agentColor$?.start};">
      Agent typing...
    </span>
  </div>
{/if}

<style>
  @keyframes animate-blink {
    0%,
    50% {
      opacity: 1;
    }
    51%,
    100% {
      opacity: 0.3;
    }
  }

  .animate-blink {
    animation: animate-blink 0.8s infinite;
  }
</style>
