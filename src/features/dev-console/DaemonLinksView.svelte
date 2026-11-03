<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Select } from '$lib/components/ui/select';
  import { truncatedTitle } from '$lib/actions/observe-overflow';
  import { formatDatePattern, formatInteger } from '$lib/i18n/format';
  import type { LinkTrafficRecord, LinkTrafficRow } from '$shared/types/daemon-links';
  import type { DaemonLinksFeed, DaemonLinksState } from './daemon-links-feed';
  import {
    linkAgents,
    linkPeers,
    linkStream,
    orderLinks,
    peerKey,
    peerName,
    type LinkColumn,
  } from './daemon-links-view';
  import { linkDirectionLabel, linkErrorLabel, linkPeerKindLabel } from './traffic-labels';
  import TrafficTable from './TrafficTable.svelte';
  import LinkPayloadDetails from './LinkPayloadDetails.svelte';
  import * as m from '$shared/paraglide/messages.js';
  let {
    linksState,
    feed,
  }: {
    linksState: DaemonLinksState;
    feed: Pick<DaemonLinksFeed, 'start' | 'stop' | 'record'>;
  } = $props();

  let peer = $state(''),
    agent = $state(''),
    text = $state(''),
    column = $state<LinkColumn>('timestamp'),
    descending = $state(false);
  let selected = $state<string | null>(null);
  let record = $state<LinkTrafficRecord | null | undefined>(undefined);
  const capture = $derived(linksState.capture);
  const peers = $derived(linkPeers(linksState.rows));
  const agents = $derived(linkAgents(linksState.rows, peer));
  // A filter whose peer or agent left the buffer falls back to all.
  const peerFilter = $derived(peers.some((p) => peerKey(p) === peer) ? peer : '');
  const agentFilter = $derived(agents.includes(agent) ? agent : '');
  const rows = $derived(
    orderLinks(linksState.rows, { peer: peerFilter, agent: agentFilter, text }, column, descending),
  );
  const selectedRow = $derived(selected ? (rows.find((row) => row.id === selected) ?? null) : null);
  const peerOptions = $derived([
    { value: '', label: m.devConsole_links_allPeers_label() },
    ...peers.map((p) => ({
      value: peerKey(p),
      label: `${peerName(p)} (${linkPeerKindLabel(p.kind)})`,
    })),
  ]);
  const agentOptions = $derived([
    { value: '', label: m.devConsole_links_allAgents_label() },
    ...agents.map((id) => ({ value: id, label: id })),
  ]);
  const columns = $derived([
    ['timestamp', m.devConsole_time_label()],
    ['direction', m.devConsole_links_direction_label()],
    ['peer', m.devConsole_links_peer_label()],
    ['frameType', m.devConsole_links_frame_label()],
    ['agentId', m.devConsole_links_agent_label()],
    ['bytes', m.devConsole_bytes_label()],
    ['summary', m.devConsole_links_summary_label()],
  ] as [LinkColumn, string][]);

  // Fetch only the selected frame's payload; a newer selection discards older replies.
  let selection = 0;
  $effect(() => {
    const row = selectedRow;
    const token = ++selection;
    record = undefined;
    if (!row) return;
    feed.record(row.seq, row.captureStartedAt).then(
      (result) => {
        if (token === selection) record = result;
      },
      () => {
        if (token === selection) record = null;
      },
    );
  });
  $effect(() => {
    if (selected && !selectedRow) selected = null;
  });

  function sort(next: LinkColumn, reverse: boolean) {
    column = next;
    descending = reverse;
  }
</script>

{#snippet filterSelect(
  value: string,
  options: { value: string; label: string }[],
  label: string,
  onchange: (value: string) => void,
)}
  <Select.Root {value} {onchange} disabled={options.length < 2}>
    <Select.Trigger variant="ghost" class="links-select" aria-label={label}>
      <span class="truncate">{options.find((option) => option.value === value)?.label}</span>
    </Select.Trigger>
    <Select.Content portal class="w-max min-w-48">
      {#each options as option (option.value)}
        <Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>
{/snippet}

{#snippet cells(row: LinkTrafficRow)}
  <span role="cell">{formatDatePattern(row.timestamp, 'HH:mm:ss.SSS')}</span>
  <span role="cell">{linkDirectionLabel(row.direction)}</span>
  <span role="cell" title={`${linkPeerKindLabel(row.peer.kind)} · ${row.peer.id}`}
    >{peerName(row.peer)}</span
  >
  <span role="cell" class="frame" use:truncatedTitle={row.frameType}>{row.frameType}</span>
  <span role="cell" use:truncatedTitle={row.agentId ?? ''}>{row.agentId ?? '—'}</span>
  <span role="cell">{formatInteger(row.bytes)}{row.truncated ? ' *' : ''}</span>
  <span role="cell" use:truncatedTitle={row.summary}>{row.summary}</span>
{/snippet}

<div class="links" data-capture={capture?.active ? 'on' : 'off'}>
  <div class="tools">
    {#if capture?.active}
      <Button
        size="compact"
        variant="ghost"
        wrapContent={false}
        class="links-control"
        disabled={linksState.busy}
        onclick={() => feed.stop()}>{m.devConsole_links_stop_label()}</Button
      >
      <span class="state" role="status"
        >{m.devConsole_links_on_label({
          time: capture.startedAt
            ? formatDatePattern(Date.parse(capture.startedAt), 'HH:mm:ss')
            : '—',
        })}{capture.payloads ? '' : ` · ${m.devConsole_links_payloadsOff_label()}`}</span
      >
    {:else}
      <Button
        size="compact"
        variant="ghost"
        wrapContent={false}
        class="links-control"
        disabled={linksState.busy || capture === null}
        onclick={() => feed.start()}>{m.devConsole_links_start_label()}</Button
      >
    {/if}
    {@render filterSelect(peerFilter, peerOptions, m.devConsole_links_peer_label(), (value) => {
      peer = value;
    })}
    {@render filterSelect(agentFilter, agentOptions, m.devConsole_links_agent_label(), (value) => {
      agent = value;
    })}
    <Input
      size="compact"
      class="links-input"
      aria-label={m.devConsole_links_filter_label()}
      placeholder={m.devConsole_links_filter_label()}
      bind:value={text}
    />
  </div>
  {#if linksState.error}<div role="alert">{linkErrorLabel(linksState.error)}</div>{/if}
  {#if capture && !capture.active}<p class="off">{m.devConsole_links_off_description()}</p>{/if}
  <div class="panel" class:inspecting={!!selectedRow}>
    <TrafficTable
      {rows}
      {columns}
      {cells}
      streamOf={linkStream}
      label={m.devConsole_daemonLinks_label()}
      empty={m.devConsole_links_empty_label()}
      {selected}
      onselect={(id) => {
        selected = id;
      }}
      {column}
      {descending}
      onsort={sort}
    />
    {#if selectedRow}{#key selectedRow.id}<LinkPayloadDetails
          row={selectedRow}
          {record}
          maxPayloadBytes={capture?.maxPayloadBytes ?? 0}
          onclose={() => {
            selected = null;
          }}
        />{/key}
    {:else}<div class="hint">{m.devConsole_links_select_label()}</div>{/if}
  </div>
  {#if capture}<footer>
      <span
        >{m.devConsole_accounting_label({
          shown: formatInteger(rows.length),
          retained: formatInteger(capture.retained),
          evicted: formatInteger(capture.evicted),
          dropped: formatInteger(capture.dropped),
          oversize: formatInteger(capture.oversized),
        })}</span
      ><span
        >{m.devConsole_links_limits_label({
          rows: formatInteger(capture.maxRecords),
          bytes: formatInteger(capture.maxPayloadBytes),
        })}</span
      >
    </footer>{/if}
</div>

<style>
  .links {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    font:
      11px ui-monospace,
      SFMono-Regular,
      Menlo,
      monospace;
    --traffic-columns: 116px 86px minmax(120px, 180px) minmax(110px, 160px) minmax(120px, 200px)
      80px minmax(200px, 1fr);
    --traffic-min-width: 940px;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    min-height: 35px;
    padding: 4px 10px;
    border-bottom: 1px solid hsl(var(--border));
  }
  /* The canonical Select root is a full-width block; keep the filters inline. */
  .tools > :global(div) {
    width: auto;
    flex: 0 1 auto;
  }
  .state,
  .off,
  .hint,
  footer {
    color: hsl(var(--muted-foreground));
  }
  .links :global(.links-control),
  .links :global(.links-select) {
    font: inherit;
    height: auto;
    min-height: 0;
    padding: 3px 8px;
    border: 1px solid hsl(var(--border));
    border-radius: 3px;
    width: auto;
    min-width: 120px;
    max-width: 260px;
    flex: 0 1 auto;
  }
  .links :global(.links-input) {
    font: inherit;
    height: auto;
    min-height: 0;
    width: 240px;
    flex: 0 1 240px;
    padding: 4px 7px;
    border: 1px solid hsl(var(--border));
    border-radius: 3px;
  }
  [role='alert'] {
    padding: 6px 10px;
    color: hsl(var(--danger));
  }
  .off {
    padding: 6px 10px;
    border-bottom: 1px solid hsl(var(--border));
  }
  .panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .frame {
    font-weight: 500;
  }
  .hint,
  footer {
    padding: 5px 10px;
    border-top: 1px solid hsl(var(--border));
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 16px;
  }
</style>
