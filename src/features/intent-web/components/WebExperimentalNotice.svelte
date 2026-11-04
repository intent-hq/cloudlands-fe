<script lang="ts">
  /**
   * Friendly notice that running Intent in a browser is experimental, with
   * what only the desktop app can do. Shown at every start of the web build
   * served by a Browser access host; see WebExperimentalNoticeHost.
   */
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { ListRow, ListView } from '$lib/components/patterns/collection';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import {
    WEB_UNAVAILABLE_FEATURE_LABELS,
    webUnavailableFeatures,
  } from '../utils/web-unavailable-features';

  let {
    open = true,
    hostManagesConnections = false,
    static: staticPosition = false,
    onDismiss,
  }: {
    open?: boolean;
    /** The host manages connections itself (intent-web): also list the Mobile tab and iCloud sync. */
    hostManagesConnections?: boolean;
    /** Render in place (sandbox previews) instead of over the page. */
    static?: boolean;
    onDismiss: () => void;
  } = $props();

  const id = $props.id();
  const headingId = `${id}-unavailable`;
  const features = $derived(webUnavailableFeatures(hostManagesConnections));
</script>

<ContentDialog
  {open}
  static={staticPosition}
  size="sm"
  title={m.intentWeb_experimentalNotice_title()}
  description={m.intentWeb_experimentalNotice_description()}
  closeLabel={m.intentWeb_experimentalNotice_close_ariaLabel()}
  onClose={onDismiss}
>
  <div class="flex flex-col gap-3">
    <p id={headingId} class="type-body font-medium text-foreground">
      {m.intentWeb_experimentalNotice_unavailable_heading()}
    </p>
    <ListView
      items={features}
      getKey={(feature) => feature}
      getText={(feature) => WEB_UNAVAILABLE_FEATURE_LABELS[feature]()}
      aria-labelledby={headingId}
      virtualize={false}
      class="overflow-visible"
    >
      {#snippet row({ item })}
        <ListRow
          class="min-h-0 px-0 py-1 [&_[data-slot=list-row-title]]:whitespace-normal"
          data-feature={item}
        >
          {#snippet title()}{WEB_UNAVAILABLE_FEATURE_LABELS[item]()}{/snippet}
        </ListRow>
      {/snippet}
    </ListView>
    <p class="type-body text-muted-foreground">
      {m.intentWeb_experimentalNotice_desktopApp_description()}
    </p>
  </div>
  {#snippet footer()}
    <Button onclick={onDismiss}>{m.intentWeb_experimentalNotice_dismiss_label()}</Button>
  {/snippet}
</ContentDialog>
