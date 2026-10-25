<script lang="ts">
  /**
   * Key/value environment editor for a named provider profile (§5.54),
   * modeled on the MCP server env editor. Typed values are masked by
   * default and stay in component-local form state only. A saved value is
   * never shown: leaving its field blank keeps it.
   */
  import { faEye, faEyeSlash, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { Button, Input, Select } from '$lib/components/patterns/settings/custom-controls';
  import {
    keepsSavedValue,
    newRow,
    type EnvRow,
    type EnvRowMode,
  } from '$features/settings/profile-env-form';

  interface Props {
    rows: EnvRow[];
    errors?: Record<string, string>;
    disabled?: boolean;
    /** Shown when there are no rows; defaults to the profile wording. */
    emptyLabel?: string;
  }

  let { rows = $bindable(), errors = {}, disabled = false, emptyLabel }: Props = $props();
  const KEY_PLACEHOLDER = 'KEY'; // i18n-ignore (environment variable name format)
  let revealed = $state<Record<string, boolean>>({});

  const modes: { value: EnvRowMode; label: () => string }[] = [
    { value: 'value', label: () => m.settings_providerProfiles_modeValue_label() },
    { value: 'empty', label: () => m.settings_providerProfiles_modeEmpty_label() },
    { value: 'unset', label: () => m.settings_providerProfiles_modeUnset_label() },
  ];

  function addRow() {
    rows = [...rows, newRow(() => crypto.randomUUID())];
  }

  function removeRow(rowId: string) {
    rows = rows.filter((row) => row.rowId !== rowId);
    delete revealed[rowId];
  }
</script>

<div class="space-y-2" data-testid="provider-profile-env">
  <div class="flex items-center justify-between">
    <span class="type-body font-medium">{m.settings_providerProfiles_env_label()}</span>
    <Button size="sm" variant="ghost" onclick={addRow} {disabled}>
      <Fa icon={faPlus} class="mr-1" size="xs" />
      {m.settings_providerProfiles_addVariable_label()}
    </Button>
  </div>
  <p class="type-body text-subtle">{m.settings_providerProfiles_env_description()}</p>
  {#if errors.env}
    <p class="type-body text-danger" role="alert">{errors.env}</p>
  {/if}
  {#if rows.length === 0}
    <p class="type-body text-subtle italic">
      {emptyLabel ?? m.settings_providerProfiles_envEmpty_label()}
    </p>
  {:else}
    <div class="space-y-3">
      {#each rows as row, index (row.rowId)}
        {@const label =
          row.key.trim() ||
          m.settings_providerProfiles_variableN_label({ n: formatInteger(index + 1) })}
        <div
          class="grid grid-cols-[8.5rem_minmax(0,1fr)_auto] items-start gap-2 [grid-template-areas:'key_key_remove'_'mode_value_value'] sm:grid-cols-[minmax(0,1fr)_8.5rem_minmax(0,1.4fr)_auto] sm:[grid-template-areas:'key_mode_value_remove']"
          data-testid="provider-profile-env-row"
        >
          <div class="min-w-0 [grid-area:key]">
            <Input
              bind:value={row.key}
              placeholder={KEY_PLACEHOLDER}
              autocomplete="off"
              spellcheck={false}
              aria-label={m.settings_providerProfiles_key_ariaLabel({ name: label })}
              error={errors[`${row.rowId}.key`]}
              {disabled}
            />
          </div>
          <div class="min-w-0 [grid-area:mode]">
            <Select.Root bind:value={row.mode} {disabled}>
              <Select.Trigger
                class="w-full"
                aria-label={m.settings_providerProfiles_mode_ariaLabel({ name: label })}
              >
                {modes.find((mode) => mode.value === row.mode)?.label()}
              </Select.Trigger>
              <Select.Content>
                {#each modes as mode (mode.value)}
                  <Select.Item value={mode.value}><span>{mode.label()}</span></Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
          {#if row.mode === 'value'}
            <div class="flex min-w-0 items-start gap-1 [grid-area:value]">
              <div class="min-w-0 flex-1">
                <Input
                  bind:value={row.value}
                  type={revealed[row.rowId] ? 'text' : 'password'}
                  autocomplete="off"
                  spellcheck={false}
                  placeholder={keepsSavedValue(row)
                    ? m.settings_providerProfiles_savedValue_placeholder()
                    : m.settings_providerProfiles_value_placeholder()}
                  aria-label={m.settings_providerProfiles_value_ariaLabel({ name: label })}
                  error={errors[`${row.rowId}.value`]}
                  {disabled}
                />
              </div>
              <Button
                size="icon"
                iconOnly
                variant="ghost"
                aria-pressed={revealed[row.rowId] === true}
                aria-label={revealed[row.rowId]
                  ? m.settings_providerProfiles_hideValue_ariaLabel({ name: label })
                  : m.settings_providerProfiles_showValue_ariaLabel({ name: label })}
                onclick={() => (revealed[row.rowId] = !revealed[row.rowId])}
                {disabled}
              >
                <Fa icon={revealed[row.rowId] ? faEyeSlash : faEye} size="xs" />
              </Button>
            </div>
          {:else}
            <div class="min-w-0 self-center [grid-area:value]">
              <p class="type-caption text-subtle">
                {row.mode === 'empty'
                  ? m.settings_providerProfiles_modeEmpty_description()
                  : m.settings_providerProfiles_modeUnset_description()}
              </p>
              {#if errors[`${row.rowId}.value`]}
                <p class="type-caption text-danger" role="alert">
                  {errors[`${row.rowId}.value`]}
                </p>
              {/if}
            </div>
          {/if}
          <Button
            class="[grid-area:remove]"
            size="icon"
            iconOnly
            variant="ghost"
            onclick={() => removeRow(row.rowId)}
            aria-label={m.settings_providerProfiles_removeVariable_ariaLabel({ name: label })}
            {disabled}
          >
            <Fa icon={faTrash} size="xs" class="text-danger" />
          </Button>
        </div>
      {/each}
    </div>
  {/if}
</div>
