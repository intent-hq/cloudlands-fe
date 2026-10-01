<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { formatInteger } from '$lib/i18n/format';
  import type {
    DevConsolePayload,
    DevConsoleRecord,
    DevConsoleRow,
  } from '$shared/types/dev-console';
  import { readablePayload } from './traffic-view';
  import * as m from '$shared/paraglide/messages.js';
  let {
    row,
    record,
    full,
    ontoggle,
    onclose,
  }: {
    row: DevConsoleRow;
    record: DevConsoleRecord | null;
    full: boolean;
    ontoggle: (enabled: boolean) => void;
    onclose: () => void;
  } = $props();
  let copied = $state('');
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

<section class="details" aria-label={row.method}>
  <header>
    <strong>{row.method}</strong><span
      >{m.devConsole_connection_label()}: {row.connectionId} / {row.connectionGeneration}</span
    ><Button
      size="compact"
      variant="ghost"
      wrapContent={false}
      class="payload-control"
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
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable payload must be keyboard reachable.) -->
      <pre tabindex="0">{readablePayload(payload.text)}</pre>
    </section>
  {/snippet}
  <div class="payloads">
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
  {#if copied}<span role="status">{copied}</span>{/if}
</section>

<style>
  .details {
    flex: 0 0 38%;
    min-height: min(180px, 55%);
    max-height: 55%;
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
    padding: 5px 10px;
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
  pre:focus-visible,
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
    padding: 6px 10px;
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
  pre {
    flex: 1;
    min-height: 60px;
    overflow: auto;
    white-space: pre;
    padding: 8px 12px;
    margin: 0;
    line-height: 1.45;
    user-select: text;
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
  @media (max-height: 500px) {
    .details {
      flex: 0 0 calc(100% - 78px);
      min-height: 0;
      max-height: none;
    }
    header,
    .payload-heading {
      padding-block: 2px;
      flex-shrink: 0;
    }
    .capture {
      padding-block: 2px;
      flex-shrink: 0;
    }
    pre {
      min-height: 0;
    }
  }
</style>
