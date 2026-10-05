<script lang="ts">
  import * as Menu from '$lib/components/ui/menu';
  import * as Accordion from '$lib/components/ui/accordion';
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import { Input } from '$lib/components/ui/input';
  import { RadioGroup, RadioGroupItem } from '$lib/components/ui/radio-group';
  let { kind = 'menu' }: { kind?: string } = $props();
</script>

{#snippet icon()}
  <svg data-audit-icon width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"
    ><circle cx="8" cy="8" r="6" fill="currentColor" /></svg
  >
{/snippet}

<div class={kind === 'settings' ? 'w-full max-w-xl p-4' : 'w-64 p-4'}>
  {#if kind === 'menu'}
    <Menu.ActionRow leading={icon} trailing={icon}>
      {#snippet title()}<span data-audit-label>A long label that wraps onto another line</span
        >{/snippet}
      {#snippet description()}Secondary context adds another line without moving the icons.{/snippet}
    </Menu.ActionRow>
  {:else if kind === 'settings'}
    <SettingsFieldRow
      id="first-line-setting"
      label="A long setting label that wraps onto another line"
      description="Additional context below the label."
      leading={icon}
      htmlFor="first-line-input"
    >
      <Input id="first-line-input" />
    </SettingsFieldRow>
  {:else if kind === 'radio'}
    <RadioGroup value="first">
      <RadioGroupItem
        value="first"
        title="A long choice label that wraps onto another line"
        description="Secondary context below the choice."
      >
        {#snippet marker()}{@render icon()}{/snippet}
      </RadioGroupItem>
    </RadioGroup>
  {:else}
    <Accordion.Root type="single">
      <Accordion.Item value="detail">
        <Accordion.Trigger
          ><span data-audit-label>A long disclosure label that wraps onto another line</span
          ></Accordion.Trigger
        >
        <Accordion.Content>Expanded details</Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  {/if}
</div>
