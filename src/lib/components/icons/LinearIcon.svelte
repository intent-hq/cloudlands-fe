<script lang="ts">
  import { selectIsDarkTheme } from '$store/renderer/slices/theme/theme-selectors';
  import linearDark from '../../../assets/logos/linear-dark.svg?url';
  import linearLight from '../../../assets/logos/linear-light.svg?url';

  interface Props {
    size?: number;
    class?: string;
  }

  let { size = 16, class: className = '' }: Props = $props();
  const isDarkTheme = selectIsDarkTheme();
  // i18n-ignore (brand name)
  const altText = 'Linear';
</script>

<img
  src={$isDarkTheme ? linearLight : linearDark}
  alt={altText}
  width={size}
  height={size}
  class={className}
/>
