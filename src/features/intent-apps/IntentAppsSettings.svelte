<script lang="ts">
  /**
   * Settings → Advanced → Apps (Labs): the app library of this computer's
   * daemon. Each row opens, reviews (approves), removes the approval of or
   * uninstalls an app; "Install app…" installs one from a workspace folder.
   * Main owns the library and the app windows; this view only shows the slice
   * and dispatches requests.
   */
  import {
    SettingsFieldRow,
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
  } from '$lib/components/patterns/settings';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { ActionBar, defineActions } from '$lib/components/patterns/action-menu';
  import { confirm } from '$lib/components/patterns/confirm';
  import { notify } from '$lib/components/patterns/notify';
  import { m } from '$shared/paraglide/messages.js';
  import { isIntentAppOpenable, type IntentApp } from '$shared/intent-apps/intent-apps-types';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectIntentApps,
    selectIntentAppsCanInstallHere,
  } from '$store/renderer/slices/intent-apps/intent-apps-selectors';
  import {
    intentAppOpenRequested,
    intentAppRevokeRequested,
    intentAppUninstallRequested,
    intentAppsRefreshRequested,
  } from '$store/renderer/slices/intent-apps/intent-apps-slice';
  import IntentAppApproveDialog from './IntentAppApproveDialog.svelte';
  import IntentAppInstallDialog from './IntentAppInstallDialog.svelte';
  import { onMount } from 'svelte';

  const intentApps$ = selectIntentApps();
  const canInstallHere$ = selectIntentAppsCanInstallHere();
  const library = $derived($intentApps$.library);

  let installOpen = $state(false);
  let reviewAppId = $state<string | null>(null);
  const reviewApp = $derived(library.apps.find((app) => app.id === reviewAppId) ?? null);

  onMount(() => {
    appStore.dispatch(intentAppsRefreshRequested());
  });

  // A failed row action reports once, as a toast; dialogs show their own failures.
  let reportedFailure: unknown = null;
  $effect(() => {
    const failure = $intentApps$.failure;
    if (!failure || failure === reportedFailure) return;
    reportedFailure = failure;
    if (failure.kind === 'open' || failure.kind === 'revoke' || failure.kind === 'uninstall') {
      notify.error(m.settings_intentApps_actionFailed_error({ message: failure.error.message }));
    }
  });

  function statusLabel(app: IntentApp): string {
    if (library.openAppIds.includes(app.id)) return m.settings_intentApps_status_open();
    if (isIntentAppOpenable(app)) return m.settings_intentApps_status_approved();
    if (app.approval.status === 'revoked') return m.settings_intentApps_status_revoked();
    return m.settings_intentApps_status_pending();
  }

  function actionsFor(app: IntentApp) {
    const openable = isIntentAppOpenable(app);
    return defineActions([
      openable
        ? { kind: 'action', id: 'open', label: m.settings_intentApps_open_label() }
        : { kind: 'action', id: 'review', label: m.settings_intentApps_review_label() },
      ...(openable
        ? [
            { kind: 'action' as const, id: 'review', label: m.settings_intentApps_review_label() },
            { kind: 'action' as const, id: 'revoke', label: m.settings_intentApps_revoke_label() },
          ]
        : []),
      {
        kind: 'action',
        id: 'uninstall',
        label: m.settings_intentApps_uninstall_label(),
        destructive: true,
      },
    ]);
  }

  async function runAction(app: IntentApp, id: string) {
    if (id === 'open') appStore.dispatch(intentAppOpenRequested(app.id));
    else if (id === 'review') reviewAppId = app.id;
    else if (id === 'revoke') appStore.dispatch(intentAppRevokeRequested(app.id));
    else if (id === 'uninstall') {
      const confirmed = await confirm({
        title: m.settings_intentApps_uninstallConfirm_title({ name: app.name }),
        description: m.settings_intentApps_uninstallConfirm_description(),
        confirmLabel: m.settings_intentApps_uninstall_label(),
        destructive: true,
      });
      if (confirmed) appStore.dispatch(intentAppUninstallRequested(app.id));
    }
  }

  function iconUrl(app: IntentApp): string | null {
    return $intentApps$.icons[`${app.id}@${app.bundleHash}`] ?? null;
  }

  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'intent-apps',
          title: m.settings_section_intentApps(),
          description: m.settings_intentApps_description(),
          entries: [
            {
              kind: 'custom',
              id: 'intent-apps-library',
              label: m.settings_section_intentApps(),
              layout: 'full-width',
              class: 'py-0 first:pt-0 last:pb-0',
            },
          ],
        },
      ],
    }),
  );
</script>

{#snippet libraryControl()}
  <div class="min-w-0 space-y-1" data-intent-apps-library>
    {#if !library.supported}
      <p class="type-body py-3 text-muted-foreground">
        {library.error
          ? m.settings_intentApps_loadFailed_error({ message: library.error })
          : m.settings_intentApps_unsupported()}
      </p>
    {:else}
      {#if library.error}
        <p class="type-body py-2 text-muted-foreground">
          {m.settings_intentApps_loadFailed_error({ message: library.error })}
        </p>
      {/if}
      {#if library.apps.length === 0}
        <p class="type-body py-3 text-muted-foreground">{m.settings_intentApps_empty()}</p>
      {/if}
      {#each library.apps as app (app.id)}
        <SettingsFieldRow
          id={`intent-app-${app.id}`}
          label={app.name}
          description={m.settings_intentApps_row_description({
            version: app.version,
            status: statusLabel(app),
          })}
          busy={$intentApps$.busy?.appId === app.id}
          class="py-2.5 first:pt-2.5 last:pb-2.5 [&>div:first-child]:items-center md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-4"
        >
          {#snippet leading()}
            <div
              class="flex size-8 items-center justify-center overflow-hidden rounded-(--radius-small) bg-muted/50 text-muted-foreground"
              data-intent-app-icon
            >
              {#if iconUrl(app)}
                <img src={iconUrl(app)} alt="" class="size-8 object-cover" />
              {:else}
                <span class="type-caption font-medium!" aria-hidden="true"
                  >{app.name.slice(0, 1).toUpperCase()}</span
                >
              {/if}
            </div>
          {/snippet}
          {#snippet control()}
            <ActionBar
              actions={actionsFor(app)}
              visibleCount={1}
              destructiveInline={false}
              overflowLabel={m.settings_intentApps_actions_ariaLabel({ name: app.name })}
              onAction={(id) => void runAction(app, id)}
            />
          {/snippet}
        </SettingsFieldRow>
      {/each}
      <div class="flex items-center gap-3 py-3">
        {#if $canInstallHere$}
          <Button variant="secondary" size="sm" onclick={() => (installOpen = true)}>
            {m.settings_intentApps_install_label()}
          </Button>
        {:else}
          <p class="type-caption text-muted-foreground">
            {m.settings_intentApps_installElsewhere()}
          </p>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<SettingsForm
  {schema}
  compact={false}
  custom={defineSettingsCustomControls({ 'intent-apps-library': libraryControl })}
/>

<IntentAppInstallDialog bind:open={installOpen} onInstalled={(appId) => (reviewAppId = appId)} />
{#if reviewApp}
  <IntentAppApproveDialog
    app={reviewApp}
    open={true}
    onClose={() => {
      reviewAppId = null;
    }}
  />
{/if}
