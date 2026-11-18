<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    scenario?: 'default' | 'before' | 'many' | 'missing' | 'system-only' | 'long-name';
    open?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'font-picker',
    title: 'Settings font picker',
    defaultState: 'default',
    states: {
      default: { props: {} },
      open: { props: { open: true } },
      before: { props: { scenario: 'before', open: true } },
      many: { props: { scenario: 'many', open: true } },
      missing: { props: { scenario: 'missing' } },
      'system-only': { props: { scenario: 'system-only' } },
      'long-name': { props: { scenario: 'long-name', open: true } },
    },
  });
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import { Select } from '$lib/components/ui/select';
  import {
    SYSTEM_DEFAULT_FONT,
    type FontOption,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { m } from '$shared/paraglide/messages.js';
  import FontPicker from './FontPicker.svelte';

  let { scenario = 'default', open: initiallyOpen = false }: Props = $props();
  const longName = 'A Very Long Editorial Programming Font Family Name';
  const fontNames = $derived(
    scenario === 'system-only'
      ? []
      : [
          'Fira Code',
          'JetBrains Mono',
          'Menlo',
          'Monaco',
          'SF Mono',
          longName,
          ...(scenario === 'many'
            ? Array.from(
                { length: 150 },
                (_, index) => `Example Mono ${String(index).padStart(3, '0')}`,
              )
            : []),
        ],
  );
  const options = $derived<FontOption[]>([
    {
      value: 'system-default',
      label: m.settings_fonts_systemDefault_label(),
      fontFamily: SYSTEM_DEFAULT_FONT,
    },
    ...fontNames.map((name) => ({ value: name, label: name, fontFamily: `'${name}', monospace` })),
  ]);
  let value = $state(
    untrack(() =>
      scenario === 'missing'
        ? 'Uninstalled Mono'
        : scenario === 'long-name'
          ? longName
          : 'system-default',
    ),
  );
  let open = $state(untrack(() => initiallyOpen));
  const fontFamily = $derived(
    options.find((option) => option.value === value)?.fontFamily ?? `'${value}', monospace`,
  );
</script>

<div class="min-h-104 w-full bg-background p-6 text-foreground" data-testid="font-picker-preview">
  <section id="code-font" class="rounded-xl bg-card px-6 py-4">
    <SettingsFieldRow
      id="settings-font-code-label-field"
      label={m.settings_font_code_label()}
      description={m.settings_font_code_description()}
    >
      {#snippet control({ labelId, descriptionId })}
        <div class="w-45 max-w-full shrink-0">
          {#if scenario === 'before'}
            <Select.Root bind:value bind:open>
              <Select.Trigger aria-labelledby={labelId} aria-describedby={descriptionId}>
                <span class="truncate" style:font-family={fontFamily}>
                  {options.find((option) => option.value === value)?.label ?? value}
                </span>
              </Select.Trigger>
              <Select.Content portal class="max-h-75 w-45">
                {#each options as option}
                  <Select.Item value={option.value}>
                    <span class="truncate" style:font-family={option.fontFamily}>
                      {option.label}
                    </span>
                  </Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          {:else}
            <FontPicker
              {value}
              {options}
              {fontFamily}
              bind:open
              ariaLabelledby={labelId}
              ariaDescribedby={descriptionId}
              onchange={(next) => (value = next)}
            />
          {/if}
        </div>
      {/snippet}
    </SettingsFieldRow>
  </section>
  <output class="sr-only" data-testid="selected-font">{value}</output>
</div>
