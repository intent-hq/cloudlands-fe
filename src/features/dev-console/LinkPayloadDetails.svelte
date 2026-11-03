<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { formatDatePattern, formatInteger } from '$lib/i18n/format';
  import type { LinkTrafficRecord, LinkTrafficRow } from '$shared/types/daemon-links';
  import PayloadViewer from './PayloadViewer.svelte';
  import { linkPayloadText, peerName } from './daemon-links-view';
  import { linkDirectionLabel, linkPeerKindLabel } from './traffic-labels';
  import * as m from '$shared/paraglide/messages.js';
  let {
    row,
    record,
    maxPayloadBytes,
    onclose,
  }: {
    row: LinkTrafficRow;
    /** undefined while loading; null once the daemon no longer retains the frame. */
    record: LinkTrafficRecord | null | undefined;
    maxPayloadBytes: number;
    onclose: () => void;
  } = $props();
  const text = $derived(record ? linkPayloadText(record) : null);
</script>

<section class="details" aria-label={row.frameType}>
  <header>
    <strong>{row.frameType}</strong>
    <span
      >{linkDirectionLabel(row.direction)} · {linkPeerKindLabel(row.peer.kind)}
      {peerName(row.peer)}</span
    >
    {#if row.agentId}<span>{m.devConsole_links_agent_label()}: {row.agentId}</span>{/if}
    {#if row.requestId}<span>{m.devConsole_links_request_label({ id: row.requestId })}</span>{/if}
    <span>#{formatInteger(row.seq)} · {formatDatePattern(row.timestamp, 'HH:mm:ss.SSS')}</span>
    <Button
      size="compact"
      variant="ghost"
      wrapContent={false}
      class="payload-control"
      data-close-details
      onclick={onclose}>{m.devConsole_closeDetails_label()}</Button
    >
  </header>
  {#if row.summary}<p class="summary">{row.summary}</p>{/if}
  <div class="body" role="status">
    {#if record === undefined}
      <p>{m.devConsole_loading_label()}</p>
    {:else if record === null}
      <p>{m.devConsole_links_evicted_label()}</p>
    {:else if text !== null}
      <PayloadViewer {text} label={m.devConsole_links_payload_label()} />
    {:else if record.truncated}
      <p>
        {m.devConsole_links_payloadTooLarge_label({ bytes: formatInteger(maxPayloadBytes) })}
      </p>
    {:else}
      <p>{m.devConsole_links_payloadAbsent_label()}</p>
    {/if}
  </div>
</section>

<style>
  .details {
    display: flex;
    flex-direction: column;
    flex: 0 0 40%;
    min-height: 140px;
    border-top: 1px solid hsl(var(--border));
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    padding: 5px 10px;
    background: hsl(var(--muted) / 0.5);
    border-bottom: 1px solid hsl(var(--border));
  }
  header span {
    color: hsl(var(--muted-foreground));
  }
  header :global(.payload-control) {
    margin-left: auto;
    font: inherit;
    padding: 2px 6px;
    height: auto;
    min-height: 0;
    border: 1px solid hsl(var(--border));
    border-radius: 3px;
  }
  .summary {
    padding: 4px 10px;
    overflow-wrap: anywhere;
    border-bottom: 1px solid hsl(var(--border) / 0.5);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .body > p {
    padding: 10px;
    color: hsl(var(--muted-foreground));
  }
</style>
