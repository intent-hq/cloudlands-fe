<!--
  Settings → Machines → Add machine → Intent on this computer (Labs): pick
  another Intent running on this computer and type the code it shows. Purely
  props-driven so previews can render each state; `LocalIntentAdd.svelte`
  connects it to the store. The typed code stays in this component until it
  is submitted; the credential never reaches the renderer.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Button, Input } from '$lib/components/patterns/settings/custom-controls';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { RadioGroup, RadioGroupItem } from '$lib/components/ui/radio-group';
  import { m } from '$shared/paraglide/messages.js';
  import type { LocalIntent, LocalRedeemError } from '$shared/types/local-pairing';
  import {
    formatLocalCode,
    isWellFormedLocalCode,
    LOCAL_CODE_LENGTH,
  } from '$shared/utils/local-pairing-code';
  import { localRedeemErrorMessage } from './local-intent-add-errors';
  import type { LocalIntentAddPhase } from './local-intent-add-slice';

  let {
    phase,
    intents,
    listFailed,
    selectedId,
    error,
    addedName,
    codeResets = 0,
    initialCode = '',
    onPick,
    onSubmit,
    onCodeEdited,
    onClose,
  }: {
    phase: Exclude<LocalIntentAddPhase, 'closed'>;
    /** null until the discovery folder was read once. */
    intents: LocalIntent[] | null;
    listFailed: boolean;
    selectedId: string | null;
    error: LocalRedeemError | null;
    addedName: string | null;
    /** A change clears the typed code. */
    codeResets?: number;
    /** Previews: a code already typed. */
    initialCode?: string;
    onPick: (instanceId: string) => void;
    onSubmit: (code: string) => void;
    onCodeEdited: () => void;
    onClose: () => void;
  } = $props();

  const uid = $props.id();
  let code = $state(untrack(() => formatLocalCode(initialCode)));
  let codeInput: HTMLInputElement | null = $state(null);
  let seenResets = untrack(() => codeResets);

  $effect(() => {
    if (codeResets === seenResets) return;
    seenResets = codeResets;
    code = '';
    if (untrack(() => phase) === 'ready') requestAnimationFrame(() => codeInput?.focus());
  });

  const selected = $derived(intents?.find((intent) => intent.instanceId === selectedId) ?? null);
  const canConnect = $derived(
    phase === 'ready' && !!selected?.accepting && isWellFormedLocalCode(code),
  );

  function describe(intent: LocalIntent): string {
    return intent.accepting
      ? intent.dataDir
      : m.localPairing_add_notAcceptingFolder_label({ folder: intent.dataDir });
  }

  function pick(instanceId: string) {
    onPick(instanceId);
    requestAnimationFrame(() => codeInput?.focus());
  }

  function onCodeInput(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    code = formatLocalCode(target.value);
    target.value = code;
    onCodeEdited();
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (canConnect) onSubmit(code);
  }

  function close() {
    code = '';
    onClose();
  }
</script>

<form
  class="space-y-4 rounded-xl border border-border bg-card px-4 py-4 sm:px-5"
  aria-labelledby="{uid}-title"
  data-testid="local-intent-add"
  data-phase={phase}
  onsubmit={submit}
>
  <div>
    <h3 id="{uid}-title" class="type-body font-medium text-foreground">
      {m.localPairing_add_title()}
    </h3>
    {#if phase !== 'added'}
      <p class="mt-1 max-w-2xl type-body text-muted-foreground">
        {m.localPairing_add_description()}
      </p>
    {/if}
  </div>

  {#if phase === 'added'}
    <div class="space-y-1" role="status" data-testid="local-intent-added">
      <p class="type-body font-medium text-foreground">
        {m.localPairing_add_added_title({ name: addedName ?? '' })}
      </p>
      <p class="type-body text-muted-foreground">{m.localPairing_add_added_description()}</p>
    </div>
    <div class="flex justify-end">
      <Button type="button" variant="outline" size="sm" onclick={close}
        >{m.localPairing_add_done_label()}</Button
      >
    </div>
  {:else}
    {#if intents === null && !listFailed}
      <div class="flex items-center gap-2" role="status">
        <IntentMarkLoader size={14} />
        <p class="type-body text-muted-foreground">{m.localPairing_add_searching_label()}</p>
      </div>
    {:else if listFailed && !intents?.length}
      <p class="type-body text-danger" role="alert" data-testid="local-intent-list-failed">
        {m.localPairing_add_unavailable_error()}
      </p>
    {:else if intents?.length === 0}
      <div
        class="rounded-lg border border-dashed border-border p-4"
        data-testid="local-intent-empty"
      >
        <p class="type-body font-medium text-foreground">{m.localPairing_add_empty_title()}</p>
        <p class="mt-1 type-body text-muted-foreground">
          {m.localPairing_add_empty_description()}
        </p>
      </div>
    {:else if intents}
      <div class="space-y-2">
        <p id="{uid}-pick" class="type-caption text-muted-foreground">
          {m.localPairing_add_pick_label()}
        </p>
        <RadioGroup
          value={selectedId ?? ''}
          onValueChange={pick}
          disabled={phase === 'redeeming'}
          aria-labelledby="{uid}-pick"
          class="w-full max-w-2xl"
          data-testid="local-intent-list"
        >
          {#each intents as intent (intent.instanceId)}
            <RadioGroupItem
              value={intent.instanceId}
              title={intent.displayName}
              description={describe(intent)}
              data-local-intent={intent.instanceId}
            />
          {/each}
        </RadioGroup>
      </div>

      {#if selected && !selected.accepting}
        <p class="type-body text-warning" data-testid="local-intent-not-accepting-hint">
          {m.localPairing_redeem_notListening_error({ name: selected.displayName })}
        </p>
      {/if}

      <div class="space-y-1.5">
        <label for="{uid}-code" class="type-caption text-muted-foreground"
          >{m.localPairing_add_code_label()}</label
        >
        <div class="flex flex-wrap gap-2">
          <Input
            id="{uid}-code"
            bind:ref={codeInput}
            value={code}
            oninput={onCodeInput}
            class="w-40 font-mono tracking-widest"
            maxlength={LOCAL_CODE_LENGTH + 1}
            autocomplete="off"
            spellcheck={false}
            disabled={phase === 'redeeming' || !selected}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${uid}-error` : undefined}
            data-testid="local-intent-code"
          />
          <Button type="submit" variant="outline" disabled={!canConnect}>
            {#if phase === 'redeeming'}
              <IntentMarkLoader size={12} class="mr-1.5" />
            {/if}
            {m.localPairing_add_connect_label()}
          </Button>
        </div>
      </div>
    {/if}

    {#if phase === 'redeeming' && selected}
      <p class="type-body text-muted-foreground" role="status">
        {m.localPairing_add_connecting_label({ name: selected.displayName })}
      </p>
    {/if}
    {#if error}
      <p
        id="{uid}-error"
        class="type-body text-danger"
        role="alert"
        data-testid="local-intent-error"
        data-error-code={error.code}
      >
        {localRedeemErrorMessage(error, selected?.displayName ?? m.localPairing_add_otherIntent())}
      </p>
    {/if}

    <div class="flex justify-end">
      <Button type="button" variant="ghost-light" size="sm" onclick={close}
        >{m.localPairing_add_cancel_label()}</Button
      >
    </div>
  {/if}
</form>
