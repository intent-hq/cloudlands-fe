<script lang="ts">
  import { selectIsDarkTheme } from '$lib/store/slices/theme/theme-selectors';
  import linearDark from '../../../assets/logos/linear-dark.svg?url';
  import linearLight from '../../../assets/logos/linear-light.svg?url';

  interface Props {
    size?: number;
    class?: string;
  }

  let { size = 16, class: className = '' }: Props = $props();
  const isDarkTheme = selectIsDarkTheme();
</script>

<img
  src={$isDarkTheme ? linearLight : linearDark}
  alt="Linear"
  width={size}
  height={size}
  class={className}
/>
