<!--
  Settings → Machines → E2B: the inline setup and edit form. The API key is
  kept only in this component's local state until it is sent in one
  `cloudMachines.configure` request; the field is cleared afterwards.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { untrack } from 'svelte';
  import { Button, Input, Label, Select } from '$lib/components/patterns/settings/custom-controls';
  import { faCircleCheck, faCloud } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import {
    DEFAULT_CLOUD_MACHINE_SIZE,
    DEFAULT_IDLE_PAUSE_MINUTES,
    DEFAULT_PAUSED_DELETE_DAYS,
    isCloudMachineSize,
    type CloudMachineProvider,
    type CloudMachineSize,
    type CloudMachineSizeInfo,
  } from '$shared/types/cloud-machines';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectCloudFailures,
    selectCloudOperations,
    selectCloudValidated,
  } from './cloud-machines-selectors';
  import {
    CLOUD_CONFIGURE_KEY,
    CLOUD_VALIDATE_KEY,
    cloudMachinesConfigureRequested,
    cloudMachineValidated,
    cloudMachineFailureDismissed,
  } from './cloud-machines-slice';
  import { cloudErrorText, cloudSizeLabel, hourlyCostLabel } from './cloud-machines-format';

  interface Props {
    /** The saved provider; null for a first setup. */
    provider: CloudMachineProvider | null;
    backendLabel: string;
    onClose: () => void;
  }

  let { provider, backendLabel, onClose }: Props = $props();

  const uid = $props.id();
  const operations$ = selectCloudOperations();
  const failures$ = selectCloudFailures();
  const validated$ = selectCloudValidated();

  let apiKey = $state('');
  let size = $state<string>(untrack(() => provider?.size ?? DEFAULT_CLOUD_MACHINE_SIZE));
  let idlePause = $state(
    untrack(() => String(provider?.idlePauseMinutes ?? DEFAULT_IDLE_PAUSE_MINUTES)),
  );
  let pausedDelete = $state(
    untrack(() => String(provider?.pausedDeleteDays ?? DEFAULT_PAUSED_DELETE_DAYS)),
  );
  let submitted = $state(false);

  const saving = $derived($operations$[CLOUD_CONFIGURE_KEY] === 'saving');
  const testing = $derived($operations$[CLOUD_VALIDATE_KEY] === 'testing');
  const busy = $derived(saving || testing);
  const saveFailure = $derived($failures$[CLOUD_CONFIGURE_KEY] ?? null);
  const testFailure = $derived($failures$[CLOUD_VALIDATE_KEY] ?? null);
  /** Published sizes: from the last test, else the saved provider. */
  const sizes = $derived<CloudMachineSizeInfo[]>($validated$?.sizes ?? provider?.sizes ?? []);
  const keyRequired = $derived(!provider && !apiKey.trim());
  const hourly = $derived(hourlyCostLabel(size));

  const IDLE_OPTIONS = [5, 10, 15, 30, 60, 120, 240];
  const DELETE_OPTIONS = [1, 3, 7, 14, 30];
  const idleItems = $derived(
    withValue(IDLE_OPTIONS, Number(idlePause)).map((minutes) => ({
      value: String(minutes),
      label:
        minutes % 60 === 0 && minutes >= 60
          ? m.cloudMachines_form_hours({ hours: String(minutes / 60) })
          : m.cloudMachines_form_minutes({ minutes: String(minutes) }),
    })),
  );
  const deleteItems = $derived(
    withValue(DELETE_OPTIONS, Number(pausedDelete)).map((days) => ({
      value: String(days),
      label:
        days === 1 ? m.cloudMachines_form_day() : m.cloudMachines_form_days({ days: String(days) }),
    })),
  );
  const sizeItems = $derived(
    sizes.map((info) => ({ value: info.id, label: cloudSizeLabel(info.id) })),
  );

  function withValue(options: number[], value: number): number[] {
    return Number.isFinite(value) && value > 0 && !options.includes(value)
      ? [...options, value].sort((a, b) => a - b)
      : options;
  }

  function failureText(failure: {
    message: string;
    cloud?: Parameters<typeof cloudErrorText>[0];
    forbidden?: boolean;
  }) {
    if (failure.forbidden) return m.cloudMachines_error_ownerOnly();
    return failure.cloud ? cloudErrorText(failure.cloud).description : failure.message;
  }

  /** The size to send: only a known id, and only when it changed or a key is new. */
  function sizeParam(): { size?: CloudMachineSize } {
    if (!isCloudMachineSize(size)) return {};
    return !provider || size !== provider.size || apiKey.trim() ? { size } : {};
  }

  function resetTest() {
    if ($validated$) appStore.dispatch(cloudMachineValidated(null));
    if (testFailure) appStore.dispatch(cloudMachineFailureDismissed(CLOUD_VALIDATE_KEY));
  }

  function test() {
    appStore.dispatch(
      cloudMachinesConfigureRequested(
        { ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), ...sizeParam() },
        true,
      ),
    );
  }

  function save() {
    if (keyRequired || busy) return;
    submitted = true;
    appStore.dispatch(
      cloudMachinesConfigureRequested({
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...sizeParam(),
        idlePauseMinutes: Number(idlePause),
        pausedDeleteDays: Number(pausedDelete),
      }),
    );
  }

  function cancel() {
    resetTest();
    if (saveFailure) appStore.dispatch(cloudMachineFailureDismissed(CLOUD_CONFIGURE_KEY));
    onClose();
  }

  // A save that settles without a failure closes the form and drops the key.
  $effect(() => {
    if (!submitted || saving) return;
    untrack(() => {
      submitted = false;
      if (saveFailure) return;
      apiKey = '';
      resetTest();
      onClose();
    });
  });
</script>

<form
  class="@container space-y-4 border-t border-border bg-muted/20 px-4 py-4 sm:px-5"
  aria-label={m.cloudMachines_form_ariaLabel()}
  data-cloud-machine-form
  onsubmit={(event) => {
    event.preventDefault();
    save();
  }}
>
  <p class="max-w-2xl type-body text-muted-foreground">
    {m.cloudMachines_form_intro({ backend: backendLabel })}
  </p>

  <div class="grid gap-x-6 gap-y-4 @xl:grid-cols-[10rem_minmax(0,1fr)]">
    <Label for="{uid}-key" class="@xl:pt-2">{m.cloudMachines_form_apiKey_label()}</Label>
    <div class="min-w-0 space-y-1">
      <div class="flex gap-2">
        <Input
          id="{uid}-key"
          type="password"
          autocomplete="off"
          spellcheck={false}
          class="min-w-0 flex-1"
          placeholder={provider
            ? m.cloudMachines_form_apiKeySaved_placeholder()
            : m.cloudMachines_form_apiKey_placeholder()}
          bind:value={apiKey}
          disabled={busy}
          oninput={resetTest}
          aria-describedby="{uid}-key-note"
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy || keyRequired}
          loading={testing}
          onclick={test}>{m.cloudMachines_form_test_label()}</Button
        >
      </div>
      {#if $validated$}
        <p class="flex items-center gap-1.5 type-body text-success" role="status" data-cloud-key-ok>
          <Fa icon={faCircleCheck} class="size-3.5!" />
          {m.cloudMachines_form_keyWorks()}
        </p>
      {:else if testFailure}
        <p class="type-body text-danger" role="alert" data-cloud-key-error>
          {failureText(testFailure)}
        </p>
      {/if}
      <p id="{uid}-key-note" class="type-body text-muted-foreground">
        {m.cloudMachines_form_apiKey_note({ backend: backendLabel })}
      </p>
    </div>

    <Label for="{uid}-size" class="@xl:pt-2">{m.cloudMachines_form_size_label()}</Label>
    <div class="min-w-0 space-y-1">
      {#if sizeItems.length > 0}
        <Select.Root bind:value={size} items={sizeItems} disabled={busy} onchange={resetTest}>
          <Select.Trigger id="{uid}-size" class="w-full max-w-sm">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each sizes as info (info.id)}
              <Select.Item value={info.id} label={cloudSizeLabel(info.id)}>
                <span class="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                  <span>{cloudSizeLabel(info.id)}</span>
                  {#if info.plan !== 'hobby'}
                    <span class="type-caption text-muted-foreground"
                      >{m.cloudMachines_form_sizePro()}</span
                    >
                  {/if}
                </span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
        {#if hourly}
          <p class="type-body text-muted-foreground">
            {hourly}
            {#if sizes.find((info) => info.id === size)?.plan === 'pro-raised-limits'}
              {m.cloudMachines_form_sizeProNote()}
            {/if}
          </p>
        {/if}
      {:else}
        <p id="{uid}-size" class="pt-2 type-body text-muted-foreground" data-cloud-sizes-unknown>
          {provider ? cloudSizeLabel(size) : m.cloudMachines_form_sizeUnknown()}
        </p>
      {/if}
    </div>

    <Label for="{uid}-idle" class="@xl:pt-2">{m.cloudMachines_form_idlePause_label()}</Label>
    <Select.Root bind:value={idlePause} items={idleItems} disabled={busy}>
      <Select.Trigger id="{uid}-idle" class="w-full max-w-sm"><Select.Value /></Select.Trigger>
      <Select.Content>
        {#each idleItems as item (item.value)}
          <Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>

    <Label for="{uid}-delete" class="@xl:pt-2">{m.cloudMachines_form_pausedDelete_label()}</Label>
    <Select.Root bind:value={pausedDelete} items={deleteItems} disabled={busy}>
      <Select.Trigger id="{uid}-delete" class="w-full max-w-sm"><Select.Value /></Select.Trigger>
      <Select.Content>
        {#each deleteItems as item (item.value)}
          <Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <p
    class="flex items-start gap-2 rounded-md bg-muted/60 p-3 type-body text-muted-foreground"
    data-cloud-privacy-note
  >
    <Fa icon={faCloud} class="mt-1 size-3.5! shrink-0" />
    <span>{m.cloudMachines_form_privacy({ backend: backendLabel })}</span>
  </p>

  {#if saveFailure}
    <p class="type-body text-danger" role="alert" data-cloud-save-error>
      {failureText(saveFailure)}
    </p>
  {/if}

  <div class="flex justify-end gap-2">
    <Button type="button" variant="ghost-light" disabled={saving} onclick={cancel}
      >{m.settings_devices_cancel_label()}</Button
    >
    <Button type="submit" disabled={busy || keyRequired} loading={saving}
      >{m.cloudMachines_form_save_label()}</Button
    >
  </div>
</form>
