<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { formatInteger } from '$lib/i18n/format';
  import type {
    DevConsolePayload,
    DevConsoleRecord,
    DevConsoleRow,
  } from '$shared/types/dev-console';
  import PayloadViewer from './PayloadViewer.svelte';
  import * as m from '$shared/paraglide/messages.js';
  let {
    row,
    record,
    full,
    ontoggle,
    onclose,
    height,
    onminimumheight,
  }: {
    row: DevConsoleRow;
    record: DevConsoleRecord | null;
    full: boolean;
    ontoggle: (enabled: boolean) => void;
    onclose: () => void;
    height?: number;
    onminimumheight?: (height: number) => void;
  } = $props();
  let copied = $state('');
  let root: HTMLElement;
  const minimumEditorHeight = 80;
  let payloadMinimum = $state(minimumEditorHeight);
  $effect(() => {
    // Reobserve when replies, capture state, or copy status change the controls.
    void record;
    void copied;
    const shared = [
      ...root.querySelectorAll<HTMLElement>(
        ':scope > header, :scope > .capture, :scope > .copy-status',
      ),
    ];
    const panes = [...root.querySelectorAll<HTMLElement>('.payload')].map((pane) => [
      ...pane.querySelectorAll<HTMLElement>('.payload-heading, [data-payload-toolbar]'),
    ]);
    function measure() {
      const sum = (nodes: HTMLElement[]) =>
        nodes.reduce((total, node) => total + node.getBoundingClientRect().height, 0);
      // Native find controls, padding, and at least two lines of payload text.
      const minimum = Math.ceil(minimumEditorHeight + Math.max(0, ...panes.map(sum)));
      payloadMinimum = minimum;
      const style = getComputedStyle(root);
      onminimumheight?.(
        Math.ceil(
          sum(shared) +
            minimum +
            parseFloat(style.borderTopWidth || '0') +
            parseFloat(style.borderBottomWidth || '0'),
        ),
      );
    }
    const observer = new ResizeObserver(measure);
    for (const node of [...shared, ...panes.flat()]) observer.observe(node);
    measure();
    return () => observer.disconnect();
  });
  const stateLabel = (payload: DevConsolePayload) =>
    ({
      complete: m.devConsole_fullState_label,
      truncated: m.devConsole_truncated_label,
      absent: m.devConsole_absent_label,
      unserializable: m.devConsole_unserializable_label,
    })[payload.state]();
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = m.devConsole_copied_label();
    } catch {
      copied = m.devConsole_copyError_label();
    }
  }
</script>

<section
  class="details"
  aria-label={row.method}
  bind:this={root}
  style:flex-basis={height === undefined ? 'auto' : `${height}px`}
>
  <header>
    <strong>{row.method}</strong><span
      >{m.devConsole_connection_label()}: {row.connectionId} / {row.connectionGeneration}</span
    ><Button
      size="compact"
      variant="ghost"
      wrapContent={false}
      class="payload-control"
      data-close-details
      onclick={onclose}>{m.devConsole_closeDetails_label()}</Button
    >
  </header>
  <div class="capture">
    <label
      ><Checkbox
        size="sm"
        class="payload-checkbox"
        ariaLabel={m.devConsole_full_label()}
        bind:checked={() => full, ontoggle}
      />{m.devConsole_full_label()}</label
    ><span>{m.devConsole_prospective_label()}</span>
  </div>
  {#snippet payloadBlock(label: string, payload: DevConsolePayload)}
    <section class="payload">
      <div class="payload-heading">
        <strong>{label}</strong><span class:truncated={payload.state === 'truncated'}
          >{stateLabel(payload)} · {m.devConsole_payloadBytes_label({
            retained: formatInteger(payload.retainedBytes),
            original:
              payload.originalBytes === null
                ? m.devConsole_unknown_label()
                : formatInteger(payload.originalBytes),
          })}</span
        ><Button
          size="compact"
          variant="ghost"
          wrapContent={false}
          class="payload-control"
          disabled={!payload.text}
          onclick={() => copy(payload.text)}>{m.devConsole_copy_label()}</Button
        >
      </div>
      <PayloadViewer text={payload.text} {label} />
    </section>
  {/snippet}
  <div class="payloads" style:min-height={`${payloadMinimum}px`}>
    {#if record}
      {@render payloadBlock(
        row.kind === 'request' ? m.devConsole_request_label() : m.devConsole_event_label(),
        record.payload,
      )}
      {#if record.response}{@render payloadBlock(
          m.devConsole_response_label(),
          record.response,
        )}{/if}
    {:else}<p>{m.devConsole_loading_label()}</p>{/if}
  </div>
  {#if copied}<span class="copy-status" role="status">{copied}</span>{/if}
</section>

<style>
  .details {
    flex: 0 0 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-top: 1px solid hsl(var(--border));
    overflow: auto;
  }
  header,
  .payload-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 2px 10px;
    flex-shrink: 0;
    background: hsl(var(--muted));
  }
  header strong {
    overflow-wrap: anywhere;
  }
  header span {
    color: hsl(var(--muted-foreground));
  }
  .details :global(.payload-control) {
    margin-left: auto;
    white-space: nowrap;
    font: inherit;
    padding: 2px 6px;
    border: 1px solid hsl(var(--border));
    border-radius: 3px;
  }
  .details :global(.payload-control):focus-visible,
  .details :global(.payload-checkbox):focus-visible {
    outline: 2px solid hsl(var(--ring));
  }
  .details :global(.payload-control):disabled {
    opacity: 0.5;
  }
  .capture {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    padding: 2px 10px;
    flex-shrink: 0;
    border-bottom: 1px solid hsl(var(--border));
  }
  label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .capture > span {
    color: hsl(var(--muted-foreground));
  }
  .payloads {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .payload {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid hsl(var(--border));
  }
  .payload-heading {
    flex-wrap: wrap;
    gap: 4px 10px;
  }
  .truncated {
    color: hsl(var(--danger));
  }
  .details :global(.payload-control) {
    height: auto;
    min-height: 0;
    font-size: inherit;
    line-height: inherit;
    font-weight: inherit;
  }
  .details :global(.payload-checkbox) {
    width: 13px;
    height: 13px;
    padding: 0;
  }
  .copy-status {
    flex-shrink: 0;
  }
</style>
