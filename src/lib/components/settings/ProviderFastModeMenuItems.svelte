<script lang="ts">
  /**
   * Fast mode (Claude Code) / Service Tier (Codex) entries for a provider's
   * ⋯ menu. `providerRef` is the `providers.fastMode` key: a base provider
   * id, or a named profile's reference (§5.54) with its own setting that
   * defaults to off and never inherits the Default profile's value.
   */
  import { m } from '$shared/paraglide/messages.js';
  import { providerRefBaseId } from '$shared/provider-profiles';
  import { Menu } from '$lib/components/patterns/settings/custom-controls';
  import { store as appStore } from '$store/renderer/store';
  import { setProviderFastMode } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import { selectProviderFastModeValues } from '$store/renderer/slices/provider-settings/provider-settings-selectors';

  interface Props {
    providerRef: string;
  }

  let { providerRef }: Props = $props();

  const fastModeValues$ = selectProviderFastModeValues();
  const isCodex = $derived(providerRefBaseId(providerRef) === 'codex');
  const enabled = $derived($fastModeValues$[providerRef] ?? false);
  const descriptionId = $derived(`fast-mode-description-${providerRef}`);
  const ultraFastDescriptionId = $derived(`ultra-fast-description-${providerRef}`);

  function currentValue(): boolean {
    return selectProviderFastModeValues.select(appStore.state)[providerRef] ?? false;
  }

  function handleToggle(event: Event) {
    // Keep Redux as the only checked state: local checkbox mutation can hide a
    // fast rejection, and cached binding values can coalesce rapid activations.
    event.preventDefault();
    appStore.dispatch(setProviderFastMode(providerRef, !currentValue()));
  }

  function handleSelectServiceTier(fast: boolean, event: Event) {
    // Keep selection tied to the confirmed/optimistic Redux value, including failed saves.
    event.preventDefault();
    if (currentValue() !== fast) appStore.dispatch(setProviderFastMode(providerRef, fast));
  }
</script>

{#if isCodex}
  <Menu.Sub>
    <Menu.SubTrigger>{m.settings_providers_serviceTier_label()}</Menu.SubTrigger>
    <Menu.SubContent class="w-64">
      <Menu.RadioGroup
        value={enabled ? 'fast' : 'standard'}
        aria-label={m.settings_providers_serviceTier_label()}
      >
        <Menu.RadioItem
          value="standard"
          onSelect={(event) => handleSelectServiceTier(false, event)}
          aria-describedby={descriptionId}
        >
          {m.settings_providers_serviceTierStandard_label()}
        </Menu.RadioItem>
        <Menu.RadioItem
          value="fast"
          onSelect={(event) => handleSelectServiceTier(true, event)}
          aria-describedby={descriptionId}
        >
          {m.settings_providers_serviceTierFast_label()}
        </Menu.RadioItem>
        <Menu.RadioItem value="ultra-fast" disabled aria-describedby={ultraFastDescriptionId}>
          {m.settings_providers_serviceTierUltraFast_label()}
        </Menu.RadioItem>
      </Menu.RadioGroup>
      <Menu.Separator />
      <p id={descriptionId} class="px-2 py-1.5 type-caption text-muted-foreground">
        {m.settings_providers_fastMode_description()}
      </p>
      <p id={ultraFastDescriptionId} class="px-2 py-1.5 type-caption text-muted-foreground">
        {m.settings_providers_serviceTierUltraFast_description()}
      </p>
    </Menu.SubContent>
  </Menu.Sub>
{:else}
  <Menu.CheckboxItem checked={enabled} onSelect={handleToggle} aria-describedby={descriptionId}>
    {m.settings_providers_fastMode_label()}
  </Menu.CheckboxItem>
  <p id={descriptionId} class="px-2 py-1.5 type-caption text-muted-foreground">
    {m.settings_providers_fastMode_description()}
  </p>
{/if}
