<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Select } from '$lib/components/ui/select';
  import { Switch } from '$lib/components/ui/switch';
  import type { SettingEntry, SettingsControlContext } from './types';

  let {
    entry,
    context,
  }: {
    entry: Exclude<SettingEntry, { kind: 'custom' }>;
    context: SettingsControlContext;
  } = $props();
  let storeValue = $state<unknown>();
  $effect(() => {
    if (!entry.store) return;
    return entry.store.subscribe((value) => (storeValue = value));
  });
  const current = $derived(entry.store ? storeValue : entry.get?.());
  const describedBy = $derived(
    [context.descriptionId, context.errorId].filter(Boolean).join(' ') || undefined,
  );

  function update(value: unknown) {
    if (entry.store) entry.store.set(value as never);
    else void entry.set?.(value as never);
  }
</script>

<div data-settings-control-kind={entry.kind} class="min-w-0">
  {#if entry.kind === 'switch'}
    <Switch
      id={context.controlId}
      checked={Boolean(current)}
      onCheckedChange={update}
      disabled={context.disabled}
      ariaLabelledby={context.labelId}
      ariaDescribedby={describedBy}
    />
  {:else if entry.kind === 'select'}
    <div class="w-56 max-w-full">
      <Select.Root value={String(current ?? '')} onchange={update} disabled={context.disabled}>
        <Select.Trigger
          id={context.controlId}
          aria-labelledby={context.labelId}
          aria-describedby={describedBy}
        >
          <span class="truncate">
            {entry.options.find((option) => option.value === current)?.label ??
              entry.placeholder ??
              String(current ?? '')}
          </span>
        </Select.Trigger>
        <Select.Content portal class="w-56 max-w-full">
          {#each entry.options as option (option.value)}
            <Select.Item value={option.value} disabled={option.disabled}>{option.label}</Select.Item
            >
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  {:else if entry.kind === 'input' || entry.kind === 'path' || entry.kind === 'keybinding'}
    <Input
      id={context.controlId}
      type={entry.kind === 'input' ? (entry.inputType ?? 'text') : 'text'}
      value={String(current ?? '')}
      placeholder={entry.placeholder}
      readonly={entry.kind !== 'input' && entry.readonly}
      disabled={context.disabled}
      aria-labelledby={context.labelId}
      aria-describedby={describedBy}
      oninput={(event) => update(event.currentTarget.value)}
      onblur={entry.kind === 'keybinding' ? undefined : entry.onBlur}
      onkeydown={entry.kind === 'keybinding' ? entry.onKeydown : undefined}
      class="w-64 max-w-full"
    />
  {:else if entry.kind === 'number'}
    <Input
      id={context.controlId}
      type="number"
      value={current as number}
      min={entry.min}
      max={entry.max}
      step={entry.step}
      placeholder={entry.placeholder}
      disabled={context.disabled}
      aria-labelledby={context.labelId}
      aria-describedby={describedBy}
      oninput={(event) => update(event.currentTarget.valueAsNumber)}
      onblur={entry.onBlur}
      class="w-32 max-w-full"
    />
  {:else if entry.kind === 'action'}
    <Button
      variant={entry.variant ?? (entry.danger ? 'destructive' : 'secondary')}
      disabled={context.disabled}
      onclick={() => void entry.action()}>{entry.actionLabel}</Button
    >
  {/if}
</div>
