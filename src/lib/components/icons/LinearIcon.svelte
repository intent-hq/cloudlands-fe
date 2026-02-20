<script lang="ts">
  import { onMount } from 'svelte';
  import linearDark from '../../../assets/logos/linear-dark.svg?url';
  import linearLight from '../../../assets/logos/linear-light.svg?url';

  interface Props {
    size?: number;
    class?: string;
  }

  let { size = 16, class: className = '' }: Props = $props();

  // Detect current theme
  function isDarkMode(): boolean {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  }

  let isDark = $state(isDarkMode());

  function updateTheme() {
    isDark = isDarkMode();
  }

  onMount(() => {
    // Initial check
    updateTheme();

    // Listen for theme changes
    const handleThemeChange = () => updateTheme();
    window.addEventListener('theme-changed', handleThemeChange);

    // Also watch for class changes on documentElement (fallback)
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      window.removeEventListener('theme-changed', handleThemeChange);
      observer.disconnect();
    };
  });
</script>

<img
  src={isDark ? linearLight : linearDark}
  alt="Linear"
  width={size}
  height={size}
  class={className}
/>
