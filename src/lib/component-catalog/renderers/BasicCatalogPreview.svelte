<script lang="ts">
  import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { ButtonGroup } from '$lib/components/ui/button-group';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Switch } from '$lib/components/ui/switch';
  import { Toggle } from '$lib/components/ui/toggle';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import type { CatalogRendererProps } from '../catalog-renderers';

  let { componentId, fixture }: CatalogRendererProps = $props();
  let checkboxChecked = $state(false);
  let switchChecked = $state(false);
  let togglePressed = $state(false);
  let groupValue = $state('list');
  let buttonClicks = $state(0);
  let buttonAction = $state('Choose an action');
  let longButtonAction = $state('Choose the long-label action');

  function recordButtonAction(action: string) {
    buttonClicks += 1;
    buttonAction = action;
  }
</script>

{#snippet arrowIcon()}
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="size-4">
    <path
      d="M3 8h10M9 4l4 4-4 4"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    ></path>
  </svg>
{/snippet}

{#snippet badgeIcon()}<Fa icon={faPlus} size="xs" />{/snippet}

<div
  class="flex min-w-0 max-w-full flex-wrap items-center gap-3"
  data-catalog-renderer-fixture={fixture.id}
>
  {#if componentId === 'badge'}
    <div
      class="flex min-w-0 max-w-full flex-wrap gap-2"
      data-catalog-rendered-state="default outline destructive success-ring-dot info-ring-dot leading-icon removable keyboard-focus long-label light dark compact"
    >
      <Badge>Default badge</Badge>
      <Badge variant="outline">Outline badge</Badge>
      <Badge variant="destructive">Error badge</Badge>
      <Badge variant="success" dot>Ready</Badge>
      <Badge variant="info" dot>Informational</Badge>
      <Badge leadingIcon={badgeIcon}>With icon</Badge>
      <Badge removable removeLabel="Remove badge" onRemove={() => undefined}>Removable</Badge>
      <Badge href="#badge-preview">Focusable badge link</Badge>
      <Badge variant="outline" class="max-w-full truncate"
        >A deliberately long badge label for truncation review</Badge
      >
    </div>
  {:else if componentId === 'button'}
    {#if fixture.id === 'interaction-states'}
      <div
        class="grid min-w-0 gap-4"
        data-catalog-rendered-state="emphasis-ladder size-ladder guidance default primary secondary outline ghost destructive active focus disabled loading loading-variants icon-only icon-weight action-feedback"
      >
        <div class="grid gap-1">
          <p class="type-caption font-medium">Preferred emphasis ladder</p>
          <p class="type-caption text-muted-foreground">
            Choose the lowest emphasis that communicates the action. Use one primary action per
            region.
          </p>
          <ol class="mt-1 flex flex-wrap items-center gap-2" aria-label="Button emphasis ladder">
            <li>
              <Button
                variant="primary"
                leadingIcon={arrowIcon}
                onclick={() => recordButtonAction('Primary action completed')}>1. Primary</Button
              >
            </li>
            <li>
              <Button
                variant="secondary"
                onclick={() => recordButtonAction('Secondary action completed')}
                >2. Secondary</Button
              >
            </li>
            <li>
              <Button variant="ghost" onclick={() => recordButtonAction('Ghost action completed')}
                >3. Ghost</Button
              >
            </li>
            <li>
              <Button variant="destructive" onclick={() => recordButtonAction('Delete requested')}
                ><Fa icon={faTrash} size="xs" />4. Destructive</Button
              >
            </li>
          </ol>
          <p class="type-caption text-muted-foreground">
            Use outline for a bordered neutral control. Default, tertiary, and neumorphic are
            compatibility aliases only.
          </p>
        </div>
        <div class="grid gap-1">
          <p class="type-caption font-medium">Preferred size ladder</p>
          <div class="flex flex-wrap items-center gap-2">
            <Button size="sm">Small</Button>
            <Button>Medium</Button>
            <Button size="lg">Large</Button>
            <Button size="icon-sm" iconOnly aria-label="Small icon button"
              ><Fa icon={faPlus} size="xs" /></Button
            >
            <Button size="icon" iconOnly aria-label="Medium icon button"
              ><Fa icon={faPlus} size="xs" /></Button
            >
            <Button size="icon-lg" iconOnly aria-label="Large icon button"
              ><Fa icon={faPlus} size="xs" /></Button
            >
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="outline" active>Active</Button>
          <Button disabled>Disabled action</Button>
          <Button loading>Loading action</Button>
          <Button variant="outline" loading>Outline loading</Button>
          <Button variant="ghost" loading>Ghost loading</Button>
          <Button size="sm" loading>Small loading</Button>
          <Button size="icon" iconOnly aria-label="Icon loading" loading
            ><Fa icon={faPlus} size="xs" /></Button
          >
          <Button size="icon" aria-label="Add item" onclick={() => recordButtonAction('Item added')}
            ><Fa icon={faPlus} size="xs" /></Button
          >
        </div>
        <output
          class="type-caption min-w-full text-muted-foreground"
          aria-label="Button action status"
          aria-live="polite">{buttonAction}</output
        >
        <output class="sr-only" aria-label="Button click count">{buttonClicks}</output>
      </div>
    {:else}
      <div
        class="grid gap-2"
        data-catalog-rendered-state="long-label light dark compact reduced-motion action-feedback"
      >
        <Button
          class="w-full min-w-0 max-w-full"
          variant="outline"
          onclick={() => (longButtonAction = 'Long-label action completed')}
          >A long button label that remains readable in compact layouts</Button
        >
        <output
          class="type-caption text-muted-foreground"
          aria-label="Long button action status"
          aria-live="polite">{longButtonAction}</output
        >
      </div>
    {/if}
  {:else if componentId === 'button-group'}
    <div data-catalog-rendered-state="horizontal vertical focus disabled compact">
      <ButtonGroup aria-label="Editor actions">
        <Button variant="outline">Edit</Button>
        <Button variant="outline">Preview</Button>
        <Button variant="outline" disabled>Publish</Button>
      </ButtonGroup>
    </div>
  {:else if componentId === 'checkbox'}
    <div
      class="grid gap-3"
      data-catalog-rendered-state="unchecked checked mixed disabled required-invalid"
    >
      <label class="flex items-center gap-2"
        ><Checkbox bind:checked={checkboxChecked} ariaLabel="Catalog checkbox" />Interactive</label
      >
      <label class="flex items-center gap-2"
        ><Checkbox checked ariaLabel="Checked checkbox" />Checked</label
      >
      <label class="flex items-center gap-2"
        ><Checkbox indeterminate ariaLabel="Mixed checkbox" />Mixed</label
      >
      <label class="flex items-center gap-2"
        ><Checkbox disabled ariaLabel="Disabled checkbox" />Disabled</label
      >
      <div>
        <Checkbox required ariaLabel="Required checkbox" ariaDescribedby="checkbox-error" />
        <p id="checkbox-error" class="type-caption text-danger">Selection required</p>
      </div>
    </div>
  {:else if componentId === 'switch'}
    <div class="grid gap-3" data-catalog-rendered-state="off on disabled required-invalid">
      <label class="flex items-center gap-2"
        ><Switch bind:checked={switchChecked} ariaLabel="Catalog switch" />Interactive</label
      >
      <label class="flex items-center gap-2"><Switch checked ariaLabel="Enabled switch" />On</label>
      <label class="flex items-center gap-2"
        ><Switch disabled ariaLabel="Disabled switch" />Disabled</label
      >
      <div>
        <Switch required ariaLabel="Required switch" ariaDescribedby="switch-error" />
        <p id="switch-error" class="type-caption text-danger">Setting required</p>
      </div>
    </div>
  {:else if componentId === 'toggle'}
    <div class="flex flex-wrap gap-2" data-catalog-rendered-state="off on disabled focus-visible">
      <Toggle bind:pressed={togglePressed} ariaLabel="Bold">Bold</Toggle>
      <Toggle pressed ariaLabel="Pinned">Pinned</Toggle>
      <Toggle disabled ariaLabel="Disabled toggle">Disabled</Toggle>
    </div>
  {:else if componentId === 'toggle-group'}
    <div data-catalog-rendered-state="single multiple selected unselected disabled keyboard-focus">
      <ToggleGroup.Root type="single" bind:value={groupValue} aria-label="Display mode">
        <ToggleGroup.Item value="list" aria-label="List view">List</ToggleGroup.Item>
        <ToggleGroup.Item value="tree" aria-label="Tree view">Tree</ToggleGroup.Item>
        <ToggleGroup.Item value="grid" aria-label="Grid view" disabled>Grid</ToggleGroup.Item>
      </ToggleGroup.Root>
      <output class="sr-only" aria-label="Display mode value">{groupValue}</output>
    </div>
  {/if}
</div>
