<script lang="ts">
  /**
   * Review an app: what its level grants, the features it asks for (the user may
   * decline each), and the exact bundle the approval binds to. Approve sends
   * `app.approve { appId, bundleHash, level, features }` with the installed
   * hash, so the user approves what they saw (a changed bundle is
   * `hash-mismatch`). Level 3 cannot be approved yet.
   */
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { Checkbox } from '$lib/components/patterns/settings/custom-controls';
  import { m } from '$shared/paraglide/messages.js';
  import { untrack } from 'svelte';
  import type { IntentApp } from '$shared/intent-apps/intent-apps-types';
  import { store as appStore } from '$store/renderer/store';
  import { selectIntentApps } from '$store/renderer/slices/intent-apps/intent-apps-selectors';
  import { intentAppApproveRequested } from '$store/renderer/slices/intent-apps/intent-apps-slice';

  let {
    app,
    open = $bindable(false),
    onClose,
  }: {
    app: IntentApp;
    open?: boolean;
    onClose: () => void;
  } = $props();

  const intentApps$ = selectIntentApps();

  const featureLabels: Record<string, () => string> = {
    notifications: () => m.settings_intentApps_feature_notifications(),
    models: () => m.settings_intentApps_feature_models(),
    globalShortcuts: () => m.settings_intentApps_feature_globalShortcuts(),
    alwaysOnTop: () => m.settings_intentApps_feature_alwaysOnTop(),
  };

  /** Granted features: the current grant for this bundle, else everything it asks for. */
  let granted = $state<Record<string, boolean>>(
    untrack(() =>
      Object.fromEntries(
        app.permissions.features.map((feature) => [
          feature,
          app.approval.bundleHash === app.bundleHash && app.approval.status !== 'pending'
            ? app.approval.features.includes(feature)
            : true,
        ]),
      ),
    ),
  );
  let submitted = $state(false);

  const level = $derived(app.permissions.level);
  const busy = $derived(
    $intentApps$.busy?.kind === 'approve' && $intentApps$.busy.appId === app.id,
  );
  const failure = $derived(
    $intentApps$.failure?.kind === 'approve' && $intentApps$.failure.appId === app.id
      ? $intentApps$.failure.error
      : null,
  );
  const shortHash = $derived(app.bundleHash.replace(/^sha256:/, '').slice(0, 12));

  // The approval landed: the request finished without a failure.
  $effect(() => {
    if (submitted && !busy && !failure) {
      submitted = false;
      onClose();
    }
  });

  function submit() {
    if (level === 3) return;
    submitted = true;
    appStore.dispatch(
      intentAppApproveRequested({
        appId: app.id,
        bundleHash: app.bundleHash,
        level,
        features: app.permissions.features.filter((feature) => granted[feature]),
      }),
    );
  }
</script>

<FormDialog
  bind:open
  title={m.settings_intentApps_approveDialog_title({ name: app.name })}
  description={m.settings_intentApps_approveDialog_description({ version: app.version })}
  submitLabel={m.settings_intentApps_approveDialog_approve_label()}
  canSubmit={level !== 3 && !busy}
  submitBusy={busy}
  onSubmit={submit}
  onCancel={onClose}
  onCloseAutoFocus={() => {
    if (!busy) onClose();
  }}
>
  <div class="space-y-3" data-intent-app-approve>
    {#if app.description}
      <p class="type-body text-foreground">{app.description}</p>
    {/if}
    {#if level === 1}
      <p class="type-body text-muted-foreground">{m.settings_intentApps_approveDialog_level1()}</p>
    {:else if level === 2}
      <p class="type-body text-muted-foreground">{m.settings_intentApps_approveDialog_level2()}</p>
      <div class="space-y-2">
        {#each app.permissions.features as feature (feature)}
          <div class="flex items-center gap-2">
            <Checkbox
              id={`intent-app-feature-${feature}`}
              checked={granted[feature] ?? false}
              onCheckedChange={(checked) => (granted = { ...granted, [feature]: checked })}
            />
            <label for={`intent-app-feature-${feature}`} class="type-caption"
              >{featureLabels[feature]?.() ?? feature}</label
            >
          </div>
        {/each}
      </div>
    {:else}
      <p class="type-body text-muted-foreground">{m.settings_intentApps_approveDialog_level3()}</p>
    {/if}
    {#if app.publisher}
      <!-- M1 never verifies publisher data: it is only what the manifest says. -->
      <p class="type-caption text-muted-foreground" data-intent-app-publisher>
        {m.settings_intentApps_approveDialog_publisher({ name: app.publisher.name })}
      </p>
    {/if}
    {#if app.signature}
      <p class="type-caption text-muted-foreground" data-intent-app-signature>
        {m.settings_intentApps_approveDialog_signature()}
      </p>
    {/if}
    <p class="type-caption text-muted-foreground" data-intent-app-bundle>
      {m.settings_intentApps_approveDialog_bundle({ hash: shortHash })}
    </p>
    {#if failure}
      <p class="type-caption text-danger" role="alert">
        {m.settings_intentApps_actionFailed_error({ message: failure.message })}
      </p>
    {/if}
  </div>
</FormDialog>
