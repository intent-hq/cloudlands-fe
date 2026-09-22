<script lang="ts">
  /**
   * Principal avatar: the avatar URL as a circular image, otherwise the label's
   * initial.
   *
   * A failed image load flips to the initial instead of leaving a broken image
   * with no fallback, and the failure state is cleared whenever `avatarUrl`
   * changes so the new URL is retried (the defect every hand-rolled
   * `<img src={avatarUrl}>` site had, see
   * https://github.com/intent-hq/cloudlands-fe/pull/2774#discussion_r4068058882).
   */
  import type { HTMLImgAttributes } from 'svelte/elements';

  interface Props {
    /** Avatar image URL; the initial renders when absent or once the load fails. */
    avatarUrl?: string | null;
    /** Principal name whose first character is the fallback initial (`?` when empty). */
    label: string;
    /** Rendered size in CSS px. Ignored when `fill` is set. */
    size?: number;
    /** Classes applied to the outer element (ring, margin, …). */
    class?: string;
    referrerpolicy?: HTMLImgAttributes['referrerpolicy'];
    /**
     * `data-testid` of the image; the initial gets the same id with a
     * `-fallback` suffix so existing test selectors survive migration.
     */
    testid?: string;
    /**
     * Fill the parent tile (`h-full w-full`) without own rounding or background,
     * for presence stacks that own the ring wrapper.
     */
    fill?: boolean;
  }

  let {
    avatarUrl = null,
    label,
    size = 24,
    class: className = '',
    referrerpolicy,
    testid,
    fill = false,
  }: Props = $props();

  let failed = $state(false);
  const showsImage = $derived(Boolean(avatarUrl) && !failed);
  const initial = $derived(label.trim().slice(0, 1).toUpperCase() || '?');
  const dimension = $derived(fill ? undefined : `${size}px`);

  $effect.pre(() => {
    void avatarUrl;
    failed = false;
  });
</script>

{#if showsImage}
  <img
    src={avatarUrl}
    alt=""
    aria-hidden="true"
    class="{fill ? 'h-full w-full object-cover' : 'shrink-0 rounded-full'} {className}"
    style:width={dimension}
    style:height={dimension}
    loading="lazy"
    {referrerpolicy}
    data-testid={testid}
    onerror={() => {
      failed = true;
    }}
  />
{:else}
  <span
    class="{fill
      ? 'grid h-full w-full place-items-center'
      : 'grid shrink-0 place-items-center rounded-full bg-muted type-caption text-foreground'} {className}"
    style:width={dimension}
    style:height={dimension}
    aria-hidden="true"
    data-testid={testid === undefined ? undefined : `${testid}-fallback`}>{initial}</span
  >
{/if}
