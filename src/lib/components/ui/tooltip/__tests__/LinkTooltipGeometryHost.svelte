<script lang="ts">
  /**
   * CT host for the singleton link tooltip's placement logic. Positions one
   * anchor in the viewport and shows the tooltip for it the way
   * `showLinkTooltip` does (anchor rect → state), minus the hover delay and
   * the daemon fetch: the preview is supplied so the wider GitHub card can be
   * exercised without a backend.
   */
  import { MockAppClient } from '$lib/client';
  import LinkTooltip from '../LinkTooltip.svelte';
  import { state as tooltip, type LinkTooltipPreview } from '../link-tooltip-state.svelte';

  interface Props {
    /** Fixed anchor position (viewport px); `right` / `bottom` pin to the far edges. */
    anchor: { top?: number; left?: number; right?: number; bottom?: number };
    /** `card` shows a ready PR hover card; `url` the plain URL tooltip. */
    content: 'card' | 'url';
  }

  let { anchor, content }: Props = $props();

  const url = 'https://github.com/acme/web-app/pull/42';
  let anchorElement = $state<HTMLAnchorElement | null>(null);

  const px = (value: number | undefined) => (value === undefined ? 'auto' : `${value}px`);
  const anchorStyle = $derived(
    `position: fixed; top: ${px(anchor.top)}; left: ${px(anchor.left)}; right: ${px(anchor.right)}; bottom: ${px(anchor.bottom)};`,
  );

  $effect(() => {
    if (!anchorElement) return;
    let cancelled = false;
    const show = (preview: LinkTooltipPreview) => {
      if (cancelled || !anchorElement) return;
      const rect = anchorElement.getBoundingClientRect();
      tooltip.url = url;
      tooltip.x = rect.left + rect.width / 2;
      tooltip.y = rect.top;
      tooltip.anchorBottom = rect.bottom;
      tooltip.preview = preview;
      tooltip.visible = true;
    };
    if (content === 'url') {
      show({ status: 'idle' });
    } else {
      new MockAppClient().integrations
        .githubPullRequest('acme', 'web-app', 42)
        .then((data) => show({ status: 'ready', data: { kind: 'pr', ...data } }));
    }
    return () => {
      cancelled = true;
      tooltip.visible = false;
      tooltip.preview = { status: 'idle' };
    };
  });
</script>

<LinkTooltip />

<a
  bind:this={anchorElement}
  href={url}
  style={anchorStyle}
  data-testid="link-anchor"
  onclick={(event) => event.preventDefault()}
>
  acme/web-app#42
</a>
