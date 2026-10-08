<script lang="ts">
  import { untrack } from 'svelte';
  import Fa from 'svelte-fa';
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { FormField } from '$lib/components/patterns/form';
  import { Input } from '$lib/components/ui/input';
  import { InputMessage } from '$lib/components/ui/input-message';
  import { Select } from '$lib/components/ui/select';
  import { m } from '$shared/paraglide/messages.js';
  import {
    customViewIcons,
    type CustomView,
    type CustomViewIcon,
  } from '$shared/types/custom-views';
  import { store as appStore } from '$store/renderer/store';
  import { closeCustomViewEditor, saveCustomView } from '../custom-views-slice';
  import { selectCustomViewsState } from '../custom-views-selectors';
  import {
    customViewErrorMessage,
    customViewIconDefinitions,
    customViewIconLabel,
  } from '../custom-views-labels';
  import { validCustomViewInput } from '../custom-views-model';

  let { view, preview = false }: { view?: CustomView; preview?: boolean } = $props();
  const initial = untrack(() => view);
  let name = $state(initial?.name ?? '');
  let directory = $state(initial?.directory ?? '');
  let command = $state(initial?.command ?? '');
  let port = $state<number | undefined>(initial?.port ?? 3000);
  let icon = $state<CustomViewIcon>(initial?.icon ?? 'globe');
  const state$ = selectCustomViewsState();
  const input = $derived({
    ...(initial ? { id: initial.id } : {}),
    name: name.trim(),
    directory: directory.trim(),
    command: command.trim(),
    port: port ?? 0,
    icon,
  });
</script>

<FormDialog
  open
  title={initial ? m.custom_views_edit() : m.custom_views_add()}
  description={m.custom_views_form_description()}
  submitLabel={m.settings_connections_save()}
  canSubmit={!preview && validCustomViewInput(input)}
  busy={$state$.busy}
  onSubmit={() => {
    appStore.dispatch(saveCustomView(input));
  }}
  onCancel={() => {
    appStore.dispatch(closeCustomViewEditor());
  }}
>
  <div class="grid gap-4">
    <FormField label={m.custom_views_name()} required>
      {#snippet control(props)}<Input {...props} bind:value={name} maxlength={100} />{/snippet}
    </FormField>
    <FormField
      label={m.custom_views_directory()}
      description={m.custom_views_directory_hint()}
      required
    >
      {#snippet control(props)}<Input
          {...props}
          bind:value={directory}
          spellcheck={false}
        />{/snippet}
    </FormField>
    <FormField
      label={m.custom_views_command()}
      description={m.custom_views_command_hint()}
      required
    >
      {#snippet control(props)}<Input
          {...props}
          bind:value={command}
          spellcheck={false}
        />{/snippet}
    </FormField>
    <FormField label={m.custom_views_port()} description={m.custom_views_port_hint()} required>
      {#snippet control(props)}<Input
          {...props}
          type="number"
          min={1024}
          max={65535}
          step={1}
          bind:value={port}
        />{/snippet}
    </FormField>
    <FormField label={m.custom_views_icon()}>
      {#snippet control(props)}
        <Select.Root
          value={icon}
          onchange={(value) => {
            if (customViewIcons.includes(value as CustomViewIcon)) icon = value as CustomViewIcon;
          }}
        >
          <Select.Trigger id={props.id} aria-label={m.custom_views_icon()} class="w-full">
            <Fa icon={customViewIconDefinitions[icon]} />{customViewIconLabel(icon)}
          </Select.Trigger>
          <Select.Content portal>
            {#each customViewIcons as option (option)}
              <Select.Item value={option} label={customViewIconLabel(option)}
                ><Fa icon={customViewIconDefinitions[option]} />{customViewIconLabel(
                  option,
                )}</Select.Item
              >
            {/each}
          </Select.Content>
        </Select.Root>
      {/snippet}
    </FormField>
    {#if $state$.error}<InputMessage tone="error" role="alert"
        >{customViewErrorMessage($state$.error)}</InputMessage
      >{/if}
  </div>
</FormDialog>
