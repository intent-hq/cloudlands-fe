<script lang="ts">
  import { Button, Input } from '$lib/components/patterns/settings/custom-controls';
  import {
    SettingsForm,
    defineSettings,
    type SettingsControlContext,
  } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';
  import { selectCurrentConnectionId } from '$store/renderer/slices/connections/connections-selectors';
  import {
    settingsFormOpened,
    settingsFormClosed,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import {
    selectSettingsFormById,
    selectSettingsFormOperationById,
  } from '$store/renderer/slices/settings-events/settings-events-selectors';
  import { websocketApiRequested } from '$store/renderer/slices/websocket-api/websocket-api-slice';
  import { selectWebsocketApiSnapshotById } from '$store/renderer/slices/websocket-api/websocket-api-selectors';
  import { isRelayUrl } from '$store/renderer/slices/websocket-api/relay-url';
  import { store as appStore } from '$store/renderer/store';
  import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
  import {
    selectCanAdministerHost,
    selectHostAdministrationDenied,
    selectPrincipalActionContext,
  } from '$store/renderer/slices/principal/principal-selectors';

  const connectionId$ = selectCurrentConnectionId();
  const principalContext$ = selectPrincipalActionContext();
  const canAdminister$ = selectCanAdministerHost();
  const denied$ = selectHostAdministrationDenied();
  const formId = crypto.randomUUID();
  let identity = { formId, sessionId: '' };
  const form$ = selectSettingsFormById(formId);
  const snapshot$ = selectWebsocketApiSnapshotById(formId);
  const save$ = selectSettingsFormOperationById(formId, 'save');
  const load$ = selectSettingsFormOperationById(formId, 'load');

  const isRemote = $derived($connectionId$ !== LOCAL_CONNECTION_ID);
  // The relay is the host owner's to read and change, here or on a connected backend.
  const remoteContext = $derived(isRemote && $canAdminister$ ? $principalContext$ : null);
  const available = $derived(!$denied$ && (!isRemote || !!remoteContext));
  const busy = $derived(!$form$ || $load$?.status === 'pending' || $save$?.status === 'pending');

  const relaySupported = $derived($snapshot$.relaySupported);
  const relayUrl = $derived($snapshot$.relayUrl);
  let editedRelay = $state('');
  let relayTouched = $state(false);
  // Follow the saved value; a refused save keeps the draft for a fix.
  $effect.pre(() => {
    editedRelay = relayUrl;
    relayTouched = false;
  });
  const relayValid = $derived(isRelayUrl(editedRelay.trim()));
  const relayChanged = $derived(editedRelay.trim() !== relayUrl);

  $effect(() => {
    const connectionId = $connectionId$;
    const context = remoteContext ?? undefined;
    if (!available) return;
    const session = { formId, sessionId: crypto.randomUUID() };
    identity = session;
    appStore.dispatch(settingsFormOpened(session, 'websocket-api'));
    appStore.dispatch(
      websocketApiRequested(
        { ...session, resource: 'load', requestId: crypto.randomUUID() },
        { kind: 'loadRelay', connectionId, context },
      ),
    );
    return () => appStore.dispatch(settingsFormClosed(session));
  });

  // The relay-unreachable card links here with #tunnel-relay: focus the field.
  let relayInput = $state<HTMLInputElement | null>(null);
  let relayLinked = $state(false);
  $effect(() => {
    const read = () => {
      if (window.location.hash === '#tunnel-relay') relayLinked = true;
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  });
  $effect(() => {
    if (!relayLinked || !relayInput || busy) return;
    relayInput.scrollIntoView?.({ block: 'center' });
    relayInput.focus();
    relayLinked = false;
  });

  function handleRelaySave() {
    relayTouched = true;
    if (!relayValid || !relayChanged || busy) return;
    appStore.dispatch(
      websocketApiRequested(
        { ...identity, resource: 'save', requestId: crypto.randomUUID() },
        {
          kind: 'relay',
          url: editedRelay.trim(),
          connectionId: $connectionId$,
          context: remoteContext ?? undefined,
        },
      ),
    );
  }

  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'tunnel-relay',
          title: m.settings_section_network(),
          entries: [
            {
              kind: 'custom',
              id: 'websocket-tunnel-relay',
              label: m.settings_tunnel_relay_label(),
              description: m.settings_tunnel_relay_description(),
              error: relayValid || !relayTouched ? undefined : m.settings_tunnel_relay_invalid(),
              disabled: busy,
              class:
                'md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:[&>[data-field-control]]:w-full',
            },
          ],
        },
      ],
    }),
  );
</script>

{#snippet relayControl({ labelId, descriptionId, errorId }: SettingsControlContext)}
  <div class="flex min-w-0 w-full items-center gap-2">
    <Input
      bind:ref={relayInput}
      type="url"
      bind:value={editedRelay}
      placeholder={m.settings_tunnel_relay_placeholder()}
      disabled={busy}
      spellcheck={false}
      autocomplete="off"
      class="min-w-0 flex-1"
      aria-labelledby={labelId}
      aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ')}
      onblur={() => (relayTouched = true)}
      onkeydown={(event: KeyboardEvent) => {
        if (event.key === 'Enter') handleRelaySave();
      }}
    />
    {#if relayChanged}
      <Button
        variant="link"
        size="sm"
        type="button"
        onclick={handleRelaySave}
        disabled={busy || !relayValid}
        class="h-auto shrink-0 px-0"
      >
        {$save$?.status === 'pending'
          ? m.settings_wsApi_port_saving()
          : m.settings_wsApi_port_save()}
      </Button>
    {/if}
  </div>
{/snippet}

{#if available && relaySupported}
  <SettingsForm {schema} compact={false} custom={{ 'websocket-tunnel-relay': relayControl }} />
{/if}
