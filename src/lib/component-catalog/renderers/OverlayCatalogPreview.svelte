<script lang="ts">
  import { faPaperclip } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import * as Menu from '$lib/components/ui/menu';
  import * as Sheet from '$lib/components/ui/sheet';
  import type { CatalogRendererProps } from '../catalog-renderers';

  let { componentId, fixture }: CatalogRendererProps = $props();
  let menuChecked = $state(false);
  let menuDensity = $state('comfortable');
</script>

<div class="flex flex-wrap gap-3" data-catalog-renderer-fixture={fixture.id}>
  {#if componentId === 'menu'}
    <div data-catalog-rendered-state="closed open disabled checked radio-selected submenu-open">
      <Menu.Root>
        <Menu.Trigger>Open catalog menu</Menu.Trigger>
        <Menu.Content preventScroll={false} interactOutsideBehavior="close">
          <Menu.Item>Run command</Menu.Item>
          <Menu.CommandItem icon={faPaperclip} label="Attach files" shortcut="⇧⌘A" />
          <Menu.Item disabled>Disabled command</Menu.Item>
          <Menu.CheckboxItem bind:checked={menuChecked} closeOnSelect={false}
            >Show panel</Menu.CheckboxItem
          >
          <Menu.RadioGroup bind:value={menuDensity}>
            <Menu.RadioItem value="compact" closeOnSelect={false}>Compact</Menu.RadioItem>
            <Menu.RadioItem value="comfortable" closeOnSelect={false}>Comfortable</Menu.RadioItem>
          </Menu.RadioGroup>
          <Menu.Sub
            ><Menu.SubTrigger>More actions</Menu.SubTrigger><Menu.SubContent portal={false}
              ><Menu.Item>Archive</Menu.Item></Menu.SubContent
            ></Menu.Sub
          >
        </Menu.Content>
      </Menu.Root>
      <Button variant="outline" size="sm">Menu outside target</Button>
    </div>
  {:else if componentId === 'dialog'}
    <div data-catalog-rendered-state="closed open focused nested-content long-content">
      <Dialog.Root>
        <Dialog.Trigger>Open catalog dialog</Dialog.Trigger>
        <Dialog.Content>
          <Dialog.Header
            ><Dialog.Title>Catalog dialog</Dialog.Title><Dialog.Description
              >Host-independent dialog preview with deliberately long content for compact layouts.</Dialog.Description
            ></Dialog.Header
          >
          <Input class="h-8" aria-label="Dialog preview field" />
          <Button size="sm">Dialog nested action</Button>
        </Dialog.Content>
      </Dialog.Root>
    </div>
    <div data-catalog-rendered-state="disabled-close">
      <Dialog.Root
        ><Dialog.Trigger>Open dialog with disabled close</Dialog.Trigger><Dialog.Content
          closeDisabled
          ><Dialog.Title>Disabled close dialog</Dialog.Title><Dialog.Description
            >Escape and outside dismissal remain testable.</Dialog.Description
          ></Dialog.Content
        ></Dialog.Root
      >
    </div>
  {:else if componentId === 'sheet'}
    <div data-catalog-rendered-state="closed open right nested-content">
      <Sheet.Root>
        <Sheet.Trigger>Open catalog sheet</Sheet.Trigger>
        <Sheet.Content side="right"
          ><Sheet.Header
            ><Sheet.Title>Catalog sheet</Sheet.Title><Sheet.Description
              >Host-independent sheet preview.</Sheet.Description
            ></Sheet.Header
          ><Input class="h-8" aria-label="Sheet preview field" /></Sheet.Content
        >
      </Sheet.Root>
    </div>
    <div data-catalog-rendered-state="left disabled-close">
      <Sheet.Root
        ><Sheet.Trigger>Open left sheet with disabled close</Sheet.Trigger><Sheet.Content
          side="left"
          closeDisabled
          ><Sheet.Title>Left sheet</Sheet.Title><Sheet.Description
            >Disabled close control state.</Sheet.Description
          ></Sheet.Content
        ></Sheet.Root
      >
    </div>
  {/if}
</div>
