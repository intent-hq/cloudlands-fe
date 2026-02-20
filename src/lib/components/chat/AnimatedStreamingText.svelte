<!--
  AnimatedStreamingText.svelte

  A robust Svelte 5 component for animating streaming text content.
  Uses native Svelte 5 features for smooth, performant animations.
-->
<script lang="ts">
  interface Props {
    text: string;
    isStreaming?: boolean;
    animationSpeed?: number; // ms per character
    animationType?: 'character' | 'word' | 'line';
    class?: string;
  }

  let {
    text = '',
    isStreaming = false,
    animationSpeed = 15,
    animationType = 'character',
    class: className = '',
  }: Props = $props();

  // State for animated text
  let displayedText = $state('');
  let currentIndex = $state(0);
  let animationFrame: number | null = null;
  let lastUpdateTime = 0;
  let accumulatedTime = 0;

  // Track previous text to detect changes
  let previousText = '';
  let previousLength = 0;

  // Split text based on animation type
  const getTextUnits = (text: string, type: typeof animationType) => {
    switch (type) {
      case 'word':
        return text.split(/(\s+)/).filter(Boolean);
      case 'line':
        return text.split('\n');
      case 'character':
      default:
        return text.split('');
    }
  };

  // Animate text appearance
  const animateText = (timestamp: number) => {
    if (!lastUpdateTime) lastUpdateTime = timestamp;

    const deltaTime = timestamp - lastUpdateTime;
    lastUpdateTime = timestamp;
    accumulatedTime += deltaTime;

    const units = getTextUnits(text, animationType);
    const targetIndex = Math.min(Math.floor(accumulatedTime / animationSpeed), units.length);

    if (targetIndex > currentIndex) {
      currentIndex = targetIndex;
      displayedText = units.slice(0, currentIndex).join('');
    }

    if (currentIndex < units.length) {
      animationFrame = requestAnimationFrame(animateText);
    } else {
      // Animation complete
      displayedText = text;
      animationFrame = null;
    }
  };

  // Handle text changes and streaming
  $effect(() => {
    // Don't use untrack for text - we want to track changes to it
    const currentText = text;
    const streaming = isStreaming;

    if (currentText !== previousText) {
      if (streaming && previousText && currentText.startsWith(previousText)) {
        // For streaming, immediately show all previous content and animate only new content
        // But don't restart animation if we're already showing everything
        if (displayedText.length < currentText.length) {
          // Immediately show all text up to where we were
          displayedText = previousText;

          // Reset animation state for new content
          if (animationFrame) {
            cancelAnimationFrame(animationFrame);
          }

          // Start animating from where we left off
          const previousUnits = getTextUnits(previousText, animationType);
          currentIndex = previousUnits.length;
          accumulatedTime = currentIndex * animationSpeed;
          lastUpdateTime = 0;

          // Start animation
          animationFrame = requestAnimationFrame(animateText);
        }
      } else {
        // Not streaming or text completely changed - animate entire text
        displayedText = '';
        currentIndex = 0;
        accumulatedTime = 0;
        lastUpdateTime = 0;

        if (animationFrame) {
          cancelAnimationFrame(animationFrame);
        }

        if (currentText) {
          animationFrame = requestAnimationFrame(animateText);
        }
      }

      previousText = currentText;
      previousLength = currentText.length;
    }
  });

  // Cleanup on unmount
  $effect(() => {
    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
  });

  // Add cursor for streaming text
  const showCursor = $derived(
    isStreaming && currentIndex < getTextUnits(text, animationType).length,
  );
</script>

<span
  class="inline wrap-break-word whitespace-break-spaces {className}"
  class:animate-subtle-fade-in={isStreaming}
>
  {displayedText}
</span>
