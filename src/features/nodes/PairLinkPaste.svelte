<!--
  Settings → Machines → Add machine → "Paste an intent:// link": an inline
  field (when the clipboard held no pair or node link), then the test with
  the token or invite secret masked. Errors show inline. The typed link stays in this component and the
  main process; state holds only the masked copy. Hidden while the Set up a
  new machine wizard owns the paste.
-->
<script lang="ts">
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { selectNodePaste } from './nodes-selectors';
  import { pasteClosed, pasteLinkSubmitted } from './nodes-slice';
  import { stashPastedLink } from './pasted-link';
  import PairLinkField from './PairLinkField.svelte';

  const paste$ = selectNodePaste();
  let text = $state('');

  const paste = $derived($paste$);

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

{#snippet cancelButton(size: 'sm' | undefined)}
  <Button type="button" variant="ghost-light" {size} onclick={cancel}
    >{m.nodes_paste_cancel_label()}</Button
  >
{/snippet}

{#if paste.phase !== 'closed' && paste.surface === 'inline'}
  <form
    class="space-y-3 rounded-xl border border-border bg-card px-4 py-4 sm:px-5"
    aria-label={m.nodes_addMenu_paste_label()}
    data-pair-link-paste={paste.phase}
    onsubmit={submit}
  >
    <PairLinkField bind:text>
      {#snippet actions()}
        <Button type="submit" variant="outline" disabled={!text.trim()}
          >{m.nodes_paste_add_label()}</Button
        >
        {@render cancelButton(undefined)}
      {/snippet}
      {#snippet testingAction()}
        {@render cancelButton('sm')}
      {/snippet}
    </PairLinkField>
  </form>
{/if}
