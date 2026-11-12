<!--
  Settings → an E2B or Northflank entry: the inline setup and edit form. The
  API key (E2B) or token (Northflank) is kept only in this component's local
  state until it is sent in one `cloudMachines.configure` request; the field
  is cleared afterwards. A new named entry asks for a name, and can copy the
  saved secret of another entry of the same provider. Northflank also takes
  the project its services run in; the region is the project's, read-only.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { untrack } from 'svelte';
  import {
    Button,
    Input,
    Label,
    Menu,
    Select,
  } from '$lib/components/patterns/settings/custom-controls';
  import { faCircleCheck, faCloud, faKey } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import {
    DEFAULT_CLOUD_MACHINE_SIZE,
    DEFAULT_IDLE_PAUSE_MINUTES,
    DEFAULT_PAUSED_DELETE_DAYS,
    isCloudMachineSize,
    nextCloudEntryName,
    type CloudMachineProvider,
    type CloudMachineSize,
    type CloudMachineSizeInfo,
    type CloudProviderKind,
  } from '$shared/types/cloud-machines';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectCloudEntries,
    selectCloudEntriesSupported,
    selectCloudFailures,
    selectCloudOperations,
    selectCloudValidated,
  } from './cloud-machines-selectors';
  import {
    NEW_CLOUD_ENTRY,
    type CloudFormDraft,
    cloudConfigureKey,
    cloudValidateKey,
    cloudMachinesConfigureRequested,
    cloudMachineValidated,
    cloudMachineFailureDismissed,
  } from './cloud-machines-slice';
  import {
    cloudEntryNameError,
    cloudErrorText,
    cloudSizeLabel,
    hourlyCostLabel,
  } from './cloud-machines-format';

  interface Props {
    /** The saved entry; null for a new one. */
    entry: CloudMachineProvider | null;
    /** The provider of a new entry; a saved one keeps its own. */
    newProvider?: CloudProviderKind;
    backendLabel: string;
    onClose: () => void;
    /** Previews: start with these field values. */
    initialDraft?: CloudFormDraft;
  }

  let { entry, newProvider = 'e2b', backendLabel, onClose, initialDraft }: Props = $props();
  const provider = $derived(entry);
  // The provider is fixed for the form's life, like the entry.
  const kind = untrack(() => entry?.provider ?? newProvider);
  const northflank = kind === 'northflank';
  const copy = northflank
    ? {
        ariaLabel: m.cloudMachines_northflank_form_ariaLabel(),
        intro: m.cloudMachines_northflank_form_intro,
        keyLabel: m.cloudMachines_northflank_form_token_label(),
        keyPlaceholder: m.cloudMachines_northflank_form_token_placeholder(),
        keySavedPlaceholder: m.cloudMachines_northflank_form_tokenSaved_placeholder(),
        keyNote: m.cloudMachines_northflank_form_token_note,
        test: m.cloudMachines_northflank_form_test_label(),
        works: m.cloudMachines_northflank_form_tokenWorks(),
        keyFrom: m.cloudMachines_northflank_form_keyFrom,
        keyFromLabel: m.cloudMachines_northflank_form_keyFrom_label(),
        keyFromClear: m.cloudMachines_northflank_form_keyFrom_clear(),
        sizeLabel: m.cloudMachines_northflank_form_size_label(),
        sizeUnknown: m.cloudMachines_northflank_form_sizeUnknown(),
        privacy: m.cloudMachines_northflank_form_privacy,
      }
    : {
        ariaLabel: m.cloudMachines_form_ariaLabel(),
        intro: m.cloudMachines_form_intro,
        keyLabel: m.cloudMachines_form_apiKey_label(),
        keyPlaceholder: m.cloudMachines_form_apiKey_placeholder(),
        keySavedPlaceholder: m.cloudMachines_form_apiKeySaved_placeholder(),
        keyNote: m.cloudMachines_form_apiKey_note,
        test: m.cloudMachines_form_test_label(),
        works: m.cloudMachines_form_keyWorks(),
        keyFrom: m.cloudMachines_form_keyFrom,
        keyFromLabel: m.cloudMachines_form_keyFrom_label(),
        keyFromClear: m.cloudMachines_form_keyFrom_clear(),
        sizeLabel: m.cloudMachines_form_size_label(),
        sizeUnknown: m.cloudMachines_form_sizeUnknown(),
        privacy: m.cloudMachines_form_privacy,
      };
  // The form edits one entry (or one new entry) for its whole life.
  const formKey = untrack(() => entry?.id ?? NEW_CLOUD_ENTRY);
  const configureKey = cloudConfigureKey(formKey);
  const validateKey = cloudValidateKey(formKey);

  const uid = $props.id();
  const operations$ = selectCloudOperations();
  const failures$ = selectCloudFailures();
  const validatedByForm$ = selectCloudValidated();
  const validated = $derived($validatedByForm$[formKey] ?? null);
  const named$ = selectCloudEntriesSupported();
  const entries$ = selectCloudEntries();
  // Other entries of the same provider whose saved key this one can copy.
  const keySources = $derived(
    $named$
      ? $entries$.filter((other) => other.id !== provider?.id && other.provider === kind)
      : [],
  );
  // With named entries every entry has a name: required to create, editable after.
  const askName = $derived($named$);

  let name = $state(
    untrack(
      () =>
        initialDraft?.name ??
        entry?.name ??
        nextCloudEntryName(
          $entries$.map((other) => other.name),
          kind,
        ),
    ),
  );
  let apiKeyFrom = $state<string | null>(null);
  const apiKeyFromName = $derived(
    keySources.find((other) => other.id === apiKeyFrom)?.name ?? null,
  );
  const nameError = $derived(askName ? cloudEntryNameError(name, $entries$, provider?.id) : null);
  let apiKey = $state(untrack(() => initialDraft?.apiKey ?? ''));
  let projectId = $state(
    untrack(() => initialDraft?.projectId ?? entry?.northflank?.projectId ?? ''),
  );
  const placeMissing = $derived(northflank && !projectId.trim());
  let size = $state<string>(untrack(() => provider?.size ?? DEFAULT_CLOUD_MACHINE_SIZE));
  let idlePause = $state(
    untrack(() => String(provider?.idlePauseMinutes ?? DEFAULT_IDLE_PAUSE_MINUTES)),
  );
  let pausedDelete = $state(
    untrack(() => String(provider?.pausedDeleteDays ?? DEFAULT_PAUSED_DELETE_DAYS)),
  );
  let submitted = $state(false);

  const saving = $derived($operations$[configureKey] === 'saving');
  const testing = $derived($operations$[validateKey] === 'testing');
  const busy = $derived(saving || testing);
  const saveFailure = $derived($failures$[configureKey] ?? null);
  const testFailure = $derived($failures$[validateKey] ?? null);
  /** Published sizes from the last test, kept when an edit clears the test result. */
  let testedSizes = $state<CloudMachineSizeInfo[] | null>(untrack(() => validated?.sizes ?? null));
  $effect(() => {
    const tested = validated?.sizes;
    if (tested) untrack(() => (testedSizes = tested));
  });
  const sizes = $derived<CloudMachineSizeInfo[]>(testedSizes ?? provider?.sizes ?? []);
  const keyRequired = $derived(!provider && !apiKey.trim() && !apiKeyFrom);
  // The project's region: from the last test, else the saved entry.
  const region = $derived(validated?.northflank?.region || provider?.northflank?.region || '');
  // Northflank bills by plan; the E2B estimate does not apply.
  const hourly = $derived(northflank ? null : hourlyCostLabel(size));

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
    if (failure.forbidden)
      return northflank
        ? m.cloudMachines_northflank_error_ownerOnly()
        : m.cloudMachines_error_ownerOnly();
    return failure.cloud ? cloudErrorText(failure.cloud, kind).description : failure.message;
  }

  /** The size to send: only a known id, and only when it changed or a key is new. */
  function sizeParam(): { size?: CloudMachineSize } {
    if (!isCloudMachineSize(size)) return {};
    return !provider || size !== provider.size || apiKey.trim() || apiKeyFrom ? { size } : {};
  }

  /** Northflank: the project, when new or changed. */
  function placeParams(): { projectId?: string } {
    if (!northflank) return {};
    const project = projectId.trim();
    return project && project !== provider?.northflank?.projectId ? { projectId: project } : {};
  }

  /** Which entry, its name when new, and its key: pasted or copied. */
  function entryParams() {
    return {
      ...(provider ? { cloudMachineId: provider.id } : { provider: kind }),
      ...(askName && (!provider || name.trim() !== provider.name) ? { name: name.trim() } : {}),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : apiKeyFrom ? { apiKeyFrom } : {}),
    };
  }

  function resetTest() {
    if (validated) appStore.dispatch(cloudMachineValidated(formKey, null));
    if (testFailure) appStore.dispatch(cloudMachineFailureDismissed(validateKey));
  }

  function useKeyOf(id: string | null) {
    apiKeyFrom = id;
    apiKey = '';
    resetTest();
  }

  function test() {
    appStore.dispatch(
      cloudMachinesConfigureRequested({ ...entryParams(), ...placeParams(), ...sizeParam() }, true),
    );
  }

  function save() {
    if (keyRequired || placeMissing || nameError || busy) return;
    submitted = true;
    appStore.dispatch(
      cloudMachinesConfigureRequested({
        ...entryParams(),
        ...placeParams(),
        ...sizeParam(),
        idlePauseMinutes: Number(idlePause),
        pausedDeleteDays: Number(pausedDelete),
      }),
    );
  }

  function cancel() {
    resetTest();
    if (saveFailure) appStore.dispatch(cloudMachineFailureDismissed(configureKey));
    onClose();
  }

  // A save that settles without a failure closes the form and drops the key.
  $effect(() => {
    if (!submitted || saving) return;
    untrack(() => {
      submitted = false;
      if (saveFailure) return;
      apiKey = '';
      apiKeyFrom = null;
      resetTest();
      onClose();
    });
  });
</script>

<form
  class="@container space-y-4 border-t border-border bg-muted/20 px-4 py-4 sm:px-5"
  aria-label={copy.ariaLabel}
  data-cloud-machine-form
  data-cloud-provider={kind}
  onsubmit={(event) => {
    event.preventDefault();
    save();
  }}
>
  <p class="max-w-2xl type-body text-muted-foreground">
    {copy.intro({ backend: backendLabel })}
  </p>

  <div class="grid gap-x-6 gap-y-4 @xl:grid-cols-[10rem_minmax(0,1fr)]">
    {#if askName}
      <Label for="{uid}-name" class="@xl:pt-2">{m.cloudMachines_form_name_label()}</Label>
      <div class="min-w-0 space-y-1">
        <Input
          id="{uid}-name"
          class="w-full max-w-sm"
          autocomplete="off"
          spellcheck={false}
          placeholder={m.cloudMachines_form_name_placeholder()}
          bind:value={name}
          disabled={busy}
          oninput={resetTest}
          aria-invalid={nameError ? 'true' : undefined}
          aria-describedby={nameError ? `${uid}-name-error` : undefined}
        />
        {#if nameError}
          <p id="{uid}-name-error" class="type-body text-danger" data-cloud-name-error>
            {nameError}
          </p>
        {/if}
      </div>
    {/if}

    <Label for="{uid}-key" class="@xl:pt-2">{copy.keyLabel}</Label>
    <div class="min-w-0 space-y-1">
      <div class="flex gap-2">
        {#if apiKeyFromName}
          <p
            id="{uid}-key"
            class="flex min-w-0 flex-1 items-center gap-2 pt-2 type-body text-foreground"
            data-cloud-key-from
          >
            <Fa icon={faKey} class="size-3.5! shrink-0 text-muted-foreground" />
            <span class="truncate">{copy.keyFrom({ name: apiKeyFromName })}</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              class="h-auto px-0"
              disabled={busy}
              onclick={() => useKeyOf(null)}>{copy.keyFromClear}</Button
            >
          </p>
        {:else}
          <Input
            id="{uid}-key"
            type="password"
            autocomplete="off"
            spellcheck={false}
            class="min-w-0 flex-1"
            placeholder={provider ? copy.keySavedPlaceholder : copy.keyPlaceholder}
            bind:value={apiKey}
            disabled={busy}
            oninput={resetTest}
            aria-describedby="{uid}-key-note"
          />
        {/if}
        <Button
          type="button"
          variant="outline"
          disabled={busy || keyRequired || placeMissing}
          loading={testing}
          onclick={test}>{copy.test}</Button
        >
      </div>
      {#if validated}
        <p class="flex items-center gap-1.5 type-body text-success" role="status" data-cloud-key-ok>
          <Fa icon={faCircleCheck} class="size-3.5!" />
          {copy.works}
        </p>
      {:else if testFailure}
        <p class="type-body text-danger" role="alert" data-cloud-key-error>
          {failureText(testFailure)}
        </p>
      {/if}
      <p id="{uid}-key-note" class="type-body text-muted-foreground">
        {copy.keyNote({ backend: backendLabel })}
      </p>
      {#if keySources.length > 0 && !apiKeyFrom}
        <Menu.Root>
          <Menu.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                type="button"
                variant="link"
                size="sm"
                class="h-auto px-0"
                disabled={busy}>{copy.keyFromLabel}</Button
              >
            {/snippet}
          </Menu.Trigger>
          <Menu.Content align="start" class="w-64">
            {#each keySources as source (source.id)}
              <Menu.Item onSelect={() => useKeyOf(source.id)}>{source.name}</Menu.Item>
            {/each}
          </Menu.Content>
        </Menu.Root>
      {/if}
    </div>

    {#if northflank}
      <Label for="{uid}-project" class="@xl:pt-2"
        >{m.cloudMachines_northflank_form_project_label()}</Label
      >
      <Input
        id="{uid}-project"
        class="w-full max-w-sm"
        autocomplete="off"
        spellcheck={false}
        placeholder={m.cloudMachines_northflank_form_project_placeholder()}
        bind:value={projectId}
        disabled={busy}
        oninput={resetTest}
        data-cloud-project
      />

      <Label for="{uid}-region" class="@xl:pt-2"
        >{m.cloudMachines_northflank_form_region_label()}</Label
      >
      <p
        id="{uid}-region"
        class="pt-2 type-body {region ? 'text-foreground' : 'text-muted-foreground'}"
        data-cloud-region
      >
        {region || m.cloudMachines_northflank_form_regionUnknown()}
      </p>
    {/if}

    <Label for="{uid}-size" class="@xl:pt-2">{copy.sizeLabel}</Label>
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
                  {#if northflank}
                    <span class="type-caption text-muted-foreground">{info.deploymentPlan}</span>
                  {:else if info.plan !== 'hobby'}
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
          {provider ? cloudSizeLabel(size) : copy.sizeUnknown}
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
    <span>{copy.privacy({ backend: backendLabel })}</span>
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
    <Button
      type="submit"
      disabled={busy || keyRequired || placeMissing || !!nameError}
      loading={saving}>{m.cloudMachines_form_save_label()}</Button
    >
  </div>
</form>
