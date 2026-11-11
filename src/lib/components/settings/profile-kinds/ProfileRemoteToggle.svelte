<script lang="ts">
  /**
   * Advanced profiles: "Use on remote machines", with warnings for settings
   * that may only work on this backend while it is on. An account folder
   * can't be marked, so the toggle turns off and locks while one is set.
   */
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { Switch } from '$lib/components/patterns/settings/custom-controls';
  import type { EnvRow } from '$features/settings/profile-env-form';
  import {
    accountFolderKeys,
    remoteWarningMessage,
    remoteWarningsForRows,
  } from '$lib/provider-remote-ready';

  interface Props {
    rows: EnvRow[];
    checked?: boolean;
    disabled?: boolean;
  }

  let { rows, checked = $bindable(true), disabled = false }: Props = $props();

  const folderKeys = $derived(accountFolderKeys(rows));
  $effect(() => {
    if (folderKeys.length > 0 && checked) checked = false;
  });
  const warnings = $derived(checked ? remoteWarningsForRows(rows) : []);
</script>

<div class="space-y-2" data-testid="provider-profile-remote">
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0 space-y-1">
      <label for="provider-profile-remote-switch" class="type-body text-foreground">
        {m.settings_providerRemote_useOnRemote_label()}
      </label>
      <p id="provider-profile-remote-description" class="type-caption text-muted-foreground">
        {folderKeys.length > 0
          ? m.settings_providerRemote_accountFolderBlocked_description({
              keys: folderKeys.join(', '),
            })
          : m.settings_providerRemote_useOnRemote_description()}
      </p>
    </div>
    <Switch
      id="provider-profile-remote-switch"
      bind:checked
      size="sm"
      disabled={disabled || folderKeys.length > 0}
      ariaLabel={m.settings_providerRemote_useOnRemote_label()}
      ariaDescribedby="provider-profile-remote-description"
    />
  </div>
  {#if warnings.length > 0}
    <div class="space-y-1" data-testid="provider-profile-remote-warnings">
      {#each warnings as warning (warning.reason)}
        <p
          class="flex items-start gap-2 type-caption text-warning-ink"
          data-reason={warning.reason}
        >
          <Fa icon={faTriangleExclamation} class="mt-0.5 size-3 shrink-0" />
          <span>{remoteWarningMessage(warning)}</span>
        </p>
      {/each}
    </div>
  {/if}
</div>
