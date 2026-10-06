<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    settingsFormOpened,
    settingsFormClosed,
    settingsFormLoadRequested,
    settingsFormSaveRequested,
    settingsFormDraftChanged,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import {
    selectSettingsForm,
    selectSettingsFormEntry,
    selectSettingsFormOperation,
  } from '$store/renderer/slices/settings-events/settings-events-selectors';
  import {
    selectCanAdministerHost,
    selectCollaborationReady,
    selectPrincipalActionContext,
  } from '$store/renderer/slices/principal/principal-selectors';
  import {
    defineSettings,
    SettingsForm,
    type SettingsControlContext,
  } from '$lib/components/patterns/settings';
  import { Button, Input } from '$lib/components/patterns/settings/custom-controls';
  import {
    normalizeCollaborationMachineName,
    validCollaborationMachineName,
  } from '$shared/collaboration-machine-name';
  import { m } from '$shared/paraglide/messages.js';

  let { context }: { context: string } = $props();
  const path = 'sharing.machineName';
  const identity = { formId: crypto.randomUUID(), sessionId: untrack(() => context) };
  const form$ = selectSettingsForm(identity);
  const entry$ = selectSettingsFormEntry(identity, path);
  const load$ = selectSettingsFormOperation(identity, 'load');
  const save$ = selectSettingsFormOperation(identity, path);
  const saved = $derived(String($entry$?.value ?? ''));
  const draft = $derived(String($form$?.drafts[path] ?? saved));
  const fallback = $derived(String($form$?.values.fallback ?? ''));
  const valid = $derived(validCollaborationMachineName(draft));
  const busy = $derived($load$?.status === 'pending' || $save$?.status === 'pending');

  function current() {
    return (
      selectCanAdministerHost.select(appStore.state) &&
      selectCollaborationReady.select(appStore.state) &&
      selectPrincipalActionContext.select(appStore.state) === identity.sessionId
    );
  }
  function load() {
    if (!current()) return;
    appStore.dispatch(
      settingsFormLoadRequested({ ...identity, resource: 'load', requestId: crypto.randomUUID() }),
    );
  }
  onMount(() => {
    appStore.dispatch(settingsFormOpened(identity, 'collaboration-machine-name'));
    load();
    return () => appStore.dispatch(settingsFormClosed(identity));
  });
  function save(value: string) {
    if (!current() || busy || !$form$?.loaded || !validCollaborationMachineName(value)) return;
    appStore.dispatch(
      settingsFormSaveRequested({ ...identity, resource: path, requestId: crypto.randomUUID() }, [
        { path, value: normalizeCollaborationMachineName(value) },
      ]),
    );
  }
  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'collaboration-machine-name',
          title: m.settings_machineName_title(),
          entries: [
            {
              id: 'collaboration-machine-name-field',
              kind: 'custom',
              label: m.settings_machineName_title(),
              description: m.settings_machineName_description(),
              disabled: busy || !$form$?.loaded,
              error: !valid
                ? m.settings_machineName_invalid_error()
                : ($save$?.error ?? $load$?.error ?? undefined),
              status:
                $save$?.status === 'succeeded' && draft === saved
                  ? m.settings_machineName_saved()
                  : undefined,
            },
          ],
        },
      ],
    }),
  );
</script>

{#snippet controls({ labelId, descriptionId, errorId, disabled }: SettingsControlContext)}
  <div class="flex w-72 max-w-full flex-col gap-2">
    <Input
      value={draft}
      placeholder={fallback}
      {disabled}
      aria-labelledby={labelId}
      aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
      oninput={(event) => {
        if (current())
          appStore.dispatch(settingsFormDraftChanged(identity, path, event.currentTarget.value));
      }}
    />
    <div class="flex flex-wrap items-center gap-2">
      {#if $load$?.status === 'failed'}
        <Button variant="secondary" size="sm" onclick={load}>{m.settings_mcpServers_retry()}</Button
        >
      {:else}
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || !valid || normalizeCollaborationMachineName(draft) === saved}
          onclick={() => save(draft)}
        >
          {busy ? m.settings_wsApi_port_saving() : m.settings_connections_save()}
        </Button>
        <Button variant="ghost" size="sm" disabled={disabled || !saved} onclick={() => save('')}
          >{m.settings_machineName_reset_label()}</Button
        >
      {/if}
    </div>
  </div>
{/snippet}
<SettingsForm {schema} compact={false} custom={{ 'collaboration-machine-name-field': controls }} />
