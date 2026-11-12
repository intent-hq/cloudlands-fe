<!--
  The intent:// link field shared by the inline paste row and the Set up a
  new machine wizard: the field, then the test with the token or invite
  secret masked, and inline errors with Try again. It renders no form: the
  host submits (stash the text with `stashPastedLink`, then dispatch
  `pasteLinkSubmitted`). The typed link stays here and in main.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button, Input } from '$lib/components/patterns/settings/custom-controls';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { selectCurrentBackendLabel } from '$features/remote-machines/remote-machines-selectors';
  import { selectNodePaste } from './nodes-selectors';
  import { pasteLinkRetried } from './nodes-slice';
  import { nodeAddErrorMessage, nodeAddErrorRetryable } from './node-add-errors';

  interface Props {
    text?: string;
    /** The hint under the field when there is no error. */
    hint?: string;
    /** Buttons after the field (the inline row's Add and Cancel). */
    actions?: Snippet;
    /** Shown on the testing row (the inline row's Cancel). */
    testingAction?: Snippet;
  }

  let { text = $bindable(''), hint, actions, testingAction }: Props = $props();

  const paste$ = selectNodePaste();
  const backend$ = selectCurrentBackendLabel();
  const uid = $props.id();
  let input: HTMLInputElement | null = $state(null);

  const paste = $derived($paste$);
  const retryable = $derived(nodeAddErrorRetryable(paste.error));

  $effect(() => {
    if (paste.phase === 'field') requestAnimationFrame(() => input?.focus());
  });
</script>

{#if paste.phase === 'testing'}
  <div class="flex items-center gap-3">
    <IntentMarkLoader size={14} />
    <div class="min-w-0 flex-1">
      <p class="type-body text-foreground" role="status">{m.nodes_paste_testing_label()}</p>
      <p class="truncate font-mono type-caption text-muted-foreground" data-pair-link-masked>
        {paste.masked}
      </p>
    </div>
    {@render testingAction?.()}
  </div>
{:else}
  <div class="flex gap-2">
    <Input
      id="{uid}-link"
      bind:ref={input}
      bind:value={text}
      class="min-w-0 flex-1 font-mono"
      placeholder="intent://…"
      autocomplete="off"
      spellcheck={false}
      aria-label={m.nodes_paste_field_label()}
      aria-describedby="{uid}-note"
      aria-invalid={paste.error ? true : undefined}
    />
    {@render actions?.()}
  </div>
  {#if paste.error}
    <div class="space-y-1" role="alert" data-pair-link-error={paste.error.code}>
      <p class="type-body text-danger">{nodeAddErrorMessage(paste.error, $backend$)}</p>
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
    <p id="{uid}-note" class="type-body text-muted-foreground">{hint ?? m.nodes_paste_hint()}</p>
  {/if}
{/if}
