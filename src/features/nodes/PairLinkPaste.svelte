<!--
  Settings → Machines → Add machine → "Paste an intent:// link": an inline
  field (when the clipboard held no pair link), then the test with the token
  masked. Errors show inline. The typed link stays in this component and the
  main process; state holds only the masked copy.
-->
<script lang="ts">
  import { Button, Input } from '$lib/components/patterns/settings/custom-controls';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { selectCurrentBackendLabel } from '$features/remote-machines/remote-machines-selectors';
  import { selectNodePaste } from './nodes-selectors';
  import { pasteClosed, pasteLinkRetried, pasteLinkSubmitted } from './nodes-slice';
  import type { NodeAddError } from './nodes-types';
  import { stashPastedLink } from './pasted-link';

  const paste$ = selectNodePaste();
  const backend$ = selectCurrentBackendLabel();
  const uid = $props.id();
  let text = $state('');
  let input: HTMLInputElement | null = $state(null);

  const paste = $derived($paste$);
  const retryable = $derived(
    paste.error?.code === 'unreachable' ||
      paste.error?.code === 'failed' ||
      paste.error?.code === 'backend-unsupported',
  );

  $effect(() => {
    if (paste.phase === 'field') requestAnimationFrame(() => input?.focus());
  });

  function errorText(error: NodeAddError): string {
    const node = error.node ?? '';
    switch (error.code) {
      case 'not-a-link':
        return m.nodes_error_notLink();
      case 'incomplete':
        return m.nodes_error_incomplete();
      case 'unreachable':
        return m.nodes_error_unreachable();
      case 'rejected':
        return m.nodes_error_rejected();
      case 'certificate':
        return m.nodes_error_certificate();
      case 'not-owner':
        return m.nodes_error_notOwner();
      case 'incompatible':
        return error.message ?? m.nodes_error_failed();
      case 'expired':
        return m.nodes_error_expired();
      case 'labs-off':
        return m.nodes_error_labsOff({ node });
      case 'backend-unsupported':
        return m.nodes_error_backendUnsupported({ node, backend: $backend$ });
      default:
        return m.nodes_error_failed();
    }
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    stashPastedLink(text);
    appStore.dispatch(pasteLinkSubmitted());
  }

  function cancel() {
    text = '';
    appStore.dispatch(pasteClosed());
  }
</script>

{#if paste.phase !== 'closed'}
  <form
    class="space-y-3 rounded-xl border border-border bg-card px-4 py-4 sm:px-5"
    aria-label={m.nodes_addMenu_paste_label()}
    data-pair-link-paste={paste.phase}
    onsubmit={submit}
  >
    {#if paste.phase === 'testing'}
      <div class="flex items-center gap-3">
        <IntentMarkLoader size={14} />
        <div class="min-w-0 flex-1">
          <p class="type-body text-foreground" role="status">{m.nodes_paste_testing_label()}</p>
          <p class="truncate font-mono type-caption text-muted-foreground" data-pair-link-masked>
            {paste.masked}
          </p>
        </div>
        <Button type="button" variant="ghost-light" size="sm" onclick={cancel}
          >{m.nodes_paste_cancel_label()}</Button
        >
      </div>
    {:else}
      <div class="flex gap-2">
        <Input
          id="{uid}-link"
          bind:ref={input}
          bind:value={text}
          class="min-w-0 flex-1 font-mono"
          placeholder="intent://pair?…"
          autocomplete="off"
          spellcheck={false}
          aria-label={m.nodes_paste_field_label()}
          aria-describedby="{uid}-note"
          aria-invalid={paste.error ? true : undefined}
        />
        <Button type="submit" variant="outline" disabled={!text.trim()}
          >{m.nodes_paste_add_label()}</Button
        >
        <Button type="button" variant="ghost-light" onclick={cancel}
          >{m.nodes_paste_cancel_label()}</Button
        >
      </div>
      {#if paste.error}
        <div class="space-y-1" role="alert" data-pair-link-error={paste.error.code}>
          <p class="type-body text-danger">{errorText(paste.error)}</p>
          {#if paste.error.routes?.length}
            <p class="font-mono type-caption whitespace-pre-line text-muted-foreground">
              {paste.error.routes.join('\n')}
            </p>
          {/if}
          {#if retryable}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="-ml-2"
              onclick={() => appStore.dispatch(pasteLinkRetried())}
              >{m.nodes_paste_tryAgain_label()}</Button
            >
          {/if}
        </div>
      {:else}
        <p id="{uid}-note" class="type-body text-muted-foreground">{m.nodes_paste_hint()}</p>
      {/if}
    {/if}
  </form>
{/if}
