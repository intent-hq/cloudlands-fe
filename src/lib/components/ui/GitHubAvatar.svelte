<script lang="ts">
  /**
   * GitHub owner avatar with a load-failure fallback.
   *
   * The failure state is cleared whenever the identity changes, so switching the
   * same node to another login (or back again) retries the load instead of
   * leaving the image hidden forever (the defect the hand-copied
   * `onerror → display:none` pattern had, see intent-hq/intent#4644).
   */
  import type { Snippet } from 'svelte';

  interface Props {
    /** GitHub login (user or organization) whose avatar is rendered. */
    identity: string;
    /** Rendered size in CSS px; the image is requested at 2x for HiDPI screens. */
    size?: number;
    /** Layout classes for the `<img>` (dimensions, rounding, object-fit). */
    class?: string;
    /**
     * Accessible alt text. Omit to render the avatar as decorative
     * (`alt=""` + `aria-hidden`), which is right whenever adjacent text already
     * names the owner.
     */
    alt?: string;
    /** Rendered in place of the image once it fails to load. */
    fallback?: Snippet;
  }

  let { identity, size = 16, class: className = '', alt, fallback }: Props = $props();

  let failed = $state(false);
  const src = $derived(`https://github.com/${identity}.png?size=${size * 2}`);

  $effect.pre(() => {
    void identity;
    failed = false;
  });
</script>

{#if failed}
  {@render fallback?.()}
{:else}
  <img
    {src}
    alt={alt ?? ''}
    aria-hidden={alt === undefined ? 'true' : undefined}
    class={className}
    loading="lazy"
    onerror={() => {
      failed = true;
    }}
  />
{/if}
