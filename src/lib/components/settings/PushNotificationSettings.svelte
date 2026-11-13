<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    settingsFormOpened,
    settingsFormClosed,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import {
    selectSettingsForm,
    selectSettingsFormOperation,
    selectSettingsFormError,
  } from '$store/renderer/slices/settings-events/settings-events-selectors';
  import { pushSettingsRequested } from '$store/renderer/slices/push-settings/push-settings-slice';
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { pushStatusLine } from '$features/settings/push-status-line';

  const identity = { formId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
  const form$ = selectSettingsForm(identity);
  const save$ = selectSettingsFormOperation(identity, 'save');
  const error$ = selectSettingsFormError(identity);
  let draftEnabled = $state<boolean | null>(null);
  const values = $derived($form$?.values ?? {});
  const loaded = $derived(values.loaded === true);
  const known = $derived(typeof values.enabled === 'boolean');
  const saving = $derived($save$?.status === 'pending');
  const enabled = $derived(draftEnabled ?? values.enabled === true);
  const status = $derived(
    saving || !known
      ? undefined
      : (pushStatusLine({
          enabled: values.enabled === true,
          linked: values.linked === true,
          linkedDevices: typeof values.linkedDevices === 'number' ? values.linkedDevices : null,
          publishing: values.publishing === true,
        }) ?? undefined),
  );

  $effect(() => {
    if (!$save$ || $save$.status === 'pending' || draftEnabled === null) return;
    let active = true;
    // Show the controlled switch's optimistic frame even when a rejection is immediate.
    void tick().then(() => {
      if (active) draftEnabled = null;
    });
    return () => {
      active = false;
    };
  });

  onMount(() => {
    appStore.dispatch(settingsFormOpened(identity, 'push'));
    appStore.dispatch(
      pushSettingsRequested(
        { ...identity, resource: 'load', requestId: crypto.randomUUID() },
        { kind: 'load' },
      ),
    );
    return () => {
      appStore.dispatch(settingsFormClosed(identity));
    };
  });

  function handleToggle(checked: boolean) {
    if (selectSettingsFormOperation.select(appStore.state, identity, 'save')?.status === 'pending')
      return;
    draftEnabled = checked;
    appStore.dispatch(
      pushSettingsRequested(
        { ...identity, resource: 'save', requestId: crypto.randomUUID() },
        { kind: 'toggle', enabled: checked },
      ),
    );
  }

  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'push-notifications',
          title: m.settings_push_label(),
          entries: [
            {
              kind: 'switch',
              id: 'push-relay-enabled',
              label: m.settings_push_label(),
              description: m.settings_push_description(),
              get: () => enabled,
              set: handleToggle,
              busy: () => !loaded,
              disabled: () => !known || saving,
              status: () => status,
              statusTone: 'subtle',
              error: () => $error$ || undefined,
            },
          ],
        },
      ],
    }),
  );
</script>

{#if values.supported !== false}
  <div data-push-settings class="min-w-0 w-full">
    <SettingsForm {schema} embedded compact={false} />
  </div>
{/if}
