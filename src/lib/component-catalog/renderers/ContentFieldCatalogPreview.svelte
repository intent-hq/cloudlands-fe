<script lang="ts">
  import { faEllipsis } from '@fortawesome/free-solid-svg-icons';
  import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { CopyInput } from '$lib/components/ui/copy-input';
  import { IntentMarkLoader, intentMarkVariants } from '$lib/components/ui/indicators';
  import { Input } from '$lib/components/ui/input';
  import { InputGroup } from '$lib/components/ui/input-group';
  import { InputMessage } from '$lib/components/ui/input-message';
  import { Label } from '$lib/components/ui/label';
  import { ListContainer, ListEmpty, ListItem, ListSection } from '$lib/components/ui/list';
  import { Separator } from '$lib/components/ui/separator';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as Table from '$lib/components/ui/table';
  import { Textarea } from '$lib/components/ui/textarea';

  type ContentFieldComponentId =
    | 'card'
    | 'copy-input'
    | 'input'
    | 'input-group'
    | 'input-message'
    | 'label'
    | 'list'
    | 'separator'
    | 'skeleton'
    | 'loading-indicator'
    | 'table'
    | 'textarea';

  let {
    componentId,
    fixture,
  }: { componentId: ContentFieldComponentId; fixture: UiComponentFixture } = $props();
  let inputValue = $state('');
  let textareaValue = $state('');
  const longText =
    'A deliberately long piece of editorial content that remains readable without overflowing a compact catalog viewport.';
</script>

{#snippet leadingAddon()}<span aria-hidden="true">@</span>{/snippet}
{#snippet trailingAddon()}<Button variant="ghost" size="xs">Apply</Button>{/snippet}

<div
  class="grid w-full min-w-0 max-w-2xl grid-cols-1 gap-4 overflow-hidden"
  data-catalog-renderer-fixture={fixture.id}
>
  {#if componentId === 'card'}
    <div data-catalog-rendered-state="default header light dark compact zoom-200 reduced-motion">
      <Card.Root aria-label="Catalog editorial card">
        <Card.Header>
          <Card.Title>Workspace summary</Card.Title>
        </Card.Header>
        <Card.Content>Canonical raised content surface.</Card.Content>
      </Card.Root>
    </div>
    <div data-catalog-rendered-state="long-content">
      <Card.Root><Card.Content>{longText}</Card.Content></Card.Root>
    </div>
    <div data-catalog-rendered-state="flush-content">
      <Card.Root>
        <Card.Content flush>
          <div class={Card.CARD_CONTENT_INSET_CLASS}>
            Flush nested content keeps the card inset.
          </div>
        </Card.Content>
      </Card.Root>
    </div>
    <div data-catalog-rendered-state="empty inert">
      <Card.Root aria-label="Empty inert card" inert><Card.Content></Card.Content></Card.Root>
    </div>
    <div data-catalog-rendered-state="interactive pressed">
      <Card.Root interactive data-state="pressed">
        <Card.Content>Pressed interactive surface</Card.Content>
      </Card.Root>
    </div>
  {:else if componentId === 'list'}
    <div
      data-catalog-rendered-state="default selected active disabled loading metadata actions keyboard-focus proximity-hover light dark compact zoom-200 reduced-motion"
    >
      <ListContainer spacing="compact" interactive>
        <ListSection title="Recent work">
          <ListItem title="Selected item" subtitle="Supporting metadata" selected />
          <ListItem
            title="Active item"
            active
            actions={[{ icon: faEllipsis, label: 'More actions', onClick: () => undefined }]}
            actionsVisible="always"
          />
          <ListItem title="Loading item" icon={faEllipsis} loading />
          <ListItem title="Disabled item" disabled />
        </ListSection>
      </ListContainer>
    </div>
    <div data-catalog-rendered-state="collapsed">
      <ListContainer><ListSection title="Collapsed section" collapsible collapsed /></ListContainer>
    </div>
    <div data-catalog-rendered-state="empty-message"><ListEmpty message="No catalog items" /></div>
    <div data-catalog-rendered-state="long-content">
      <ListContainer><ListItem title={longText} /></ListContainer>
    </div>
  {:else if componentId === 'input'}
    <div
      class="grid gap-3"
      data-catalog-rendered-state="default rest hover focus empty placeholder described keyboard-focus light dark compact-28 medium-32 large-36 zoom-200 reduced-motion"
    >
      <Label for="catalog-input">Project name</Label>
      <Input
        id="catalog-input"
        bind:value={inputValue}
        placeholder="Enter a project name"
        aria-describedby="catalog-input-help"
      />
      <p id="catalog-input-help" class="text-xs text-muted-foreground">
        A stable host-independent description.
      </p>
      <Input aria-label="Compact input" class="h-(--control-height-small)" />
      <Input aria-label="Large input" class="h-(--control-height-large)" value="Large value" />
      <Input aria-label="Hover input" data-state="hover" value="Hover" />
      <Input aria-label="Focus input" data-state="focus" value="Focus" />
    </div>
    <div class="grid gap-3" data-catalog-rendered-state="disabled read-only invalid error">
      <Input aria-label="Disabled input" disabled value="Disabled" />
      <Input aria-label="Read-only input" readonly value="Read only" />
      <Input aria-label="Invalid input" error="Needs review" value="Invalid" />
    </div>
    <div data-catalog-rendered-state="file">
      <Input type="file" aria-label="Catalog file input" />
    </div>
    <div data-catalog-rendered-state="long-content">
      <Input aria-label="Long input" value={longText} />
    </div>
  {:else if componentId === 'textarea'}
    <div
      class="grid gap-3"
      data-catalog-rendered-state="default rest hover focus empty placeholder described auto-expand keyboard-focus light dark compact zoom-200 reduced-motion"
    >
      <Label for="catalog-textarea">Workspace summary</Label>
      <Textarea
        id="catalog-textarea"
        bind:value={textareaValue}
        placeholder="Describe this workspace"
        doesExpandToFit
        minHeight={80}
        maxHeight={120}
      />
      <Textarea aria-label="Hover textarea" data-state="hover" value="Hover" />
      <Textarea aria-label="Focus textarea" data-state="focus" value="Focus" />
    </div>
    <div class="grid gap-3" data-catalog-rendered-state="disabled read-only invalid error">
      <Textarea aria-label="Disabled textarea" disabled value="Disabled" />
      <Textarea aria-label="Read-only textarea" readonly value="Read only" />
      <Textarea aria-label="Invalid textarea" error="Needs review" value="Invalid" />
    </div>
    <div data-catalog-rendered-state="max-height-scroll long-content">
      <Textarea
        aria-label="Long textarea"
        doesExpandToFit
        minHeight={80}
        maxHeight={96}
        value={`${longText} ${longText}`}
      />
    </div>
  {:else if componentId === 'input-group'}
    <div
      class="grid gap-3"
      data-catalog-rendered-state="rest leading-addon trailing-addon default-size light dark reduced-motion"
    >
      <InputGroup leading={leadingAddon} trailing={trailingAddon}>
        <Input aria-label="Grouped value" placeholder="workspace" noFocusStyle />
      </InputGroup>
    </div>
    <div data-catalog-rendered-state="hover">
      <InputGroup leading={leadingAddon} trailing={trailingAddon} data-state="hover">
        <Input aria-label="Hover group" placeholder="workspace" noFocusStyle />
      </InputGroup>
    </div>
    <div data-catalog-rendered-state="focus">
      <InputGroup leading={leadingAddon} trailing={trailingAddon} data-state="focus">
        <Input aria-label="Focus group" placeholder="workspace" noFocusStyle />
      </InputGroup>
    </div>
    <div data-catalog-rendered-state="error">
      <InputGroup leading={leadingAddon} trailing={trailingAddon} error="Choose a valid value">
        <Input
          aria-label="Invalid group"
          aria-invalid="true"
          placeholder="workspace"
          noFocusStyle
        />
      </InputGroup>
    </div>
    <div data-catalog-rendered-state="disabled">
      <InputGroup leading={leadingAddon} trailing={trailingAddon} disabled>
        <Input aria-label="Disabled group" placeholder="workspace" disabled noFocusStyle />
      </InputGroup>
    </div>
    <div data-catalog-rendered-state="compact">
      <InputGroup leading={leadingAddon} trailing={trailingAddon} size="compact">
        <Input aria-label="Compact group" placeholder="workspace" size="compact" noFocusStyle />
      </InputGroup>
    </div>
  {:else if componentId === 'copy-input'}
    <div
      class="grid gap-3"
      data-catalog-rendered-state="rest default-size light dark reduced-motion copied"
    >
      <CopyInput value="intent://workspace/system-design" label="Workspace link" />
    </div>
    <div data-catalog-rendered-state="hover">
      <CopyInput value="Hover value" />
    </div>
    <div data-catalog-rendered-state="focus">
      <CopyInput value="Focus value" />
    </div>
    <div data-catalog-rendered-state="error-feedback">
      <CopyInput value="Clipboard failure feedback" />
    </div>
    <div data-catalog-rendered-state="disabled">
      <CopyInput value="Disabled value" disabled />
    </div>
    <div data-catalog-rendered-state="button-variant">
      <CopyInput value="Button variant" variant="button" />
    </div>
    <div data-catalog-rendered-state="left-aligned">
      <CopyInput value="Left aligned action" align="left" />
    </div>
    <div data-catalog-rendered-state="compact">
      <CopyInput value="Compact value" size="compact" />
    </div>
  {:else if componentId === 'input-message'}
    <div data-catalog-rendered-state="helper light dark reduced-motion">
      <InputMessage>Helper text for the field.</InputMessage>
    </div>
    <div data-catalog-rendered-state="error">
      <InputMessage tone="error">The field needs attention.</InputMessage>
    </div>
  {:else if componentId === 'label'}
    <div
      class="grid gap-3"
      data-catalog-rendered-state="default rest required optional long-content compact zoom-200 light dark"
    >
      <Label for="required-field">Required project name *</Label>
      <Input id="required-field" required />
      <Label for="optional-field">Optional supporting detail</Label>
      <Input id="optional-field" />
      <Label for="long-label">{longText}</Label>
      <Input id="long-label" />
      <Label for="hover-label" data-state="hover">Hover label</Label>
      <Input id="hover-label" />
      <Label for="focus-label" data-state="focus">Focus label</Label>
      <Input id="focus-label" />
    </div>
    <div
      class="group grid gap-2"
      data-disabled="true"
      data-catalog-rendered-state="disabled hover focus"
    >
      <Label for="disabled-field">Disabled field</Label><Input id="disabled-field" disabled />
    </div>
    <div class="group grid gap-2" data-invalid="true" data-catalog-rendered-state="error">
      <Label for="error-field" invalid>Error field</Label><Input
        id="error-field"
        error="Required"
      />
    </div>
  {:else if componentId === 'table'}
    <div
      data-catalog-rendered-state="default hover selected compact zoom-200 light dark reduced-motion"
    >
      <Table.Root aria-label="Workspace usage">
        <Table.Header>
          <Table.Row><Table.Head>Workspace</Table.Head><Table.Head>Tokens</Table.Head></Table.Row>
        </Table.Header>
        <Table.Body>
          <Table.Row><Table.Cell>Alpha</Table.Cell><Table.Cell>42</Table.Cell></Table.Row>
          <Table.Row data-state="selected"
            ><Table.Cell>Beta</Table.Cell><Table.Cell>84</Table.Cell></Table.Row
          >
        </Table.Body>
      </Table.Root>
    </div>
    <div data-catalog-rendered-state="long-content">
      <Table.Root
        ><Table.Body><Table.Row><Table.Cell>{longText}</Table.Cell></Table.Row></Table.Body
        ></Table.Root
      >
    </div>
  {:else if componentId === 'separator'}
    <div
      class="grid gap-4"
      data-catalog-rendered-state="horizontal decorative compact zoom-200 light dark"
    >
      <Separator decorative />
    </div>
    <div class="flex h-12 items-stretch gap-3" data-catalog-rendered-state="vertical semantic">
      <span>Before</span><Separator orientation="vertical" decorative={false} /><span>After</span>
    </div>
  {:else if componentId === 'skeleton'}
    <div
      class="grid gap-3"
      aria-label="Loading preview"
      data-catalog-rendered-state="default line card shimmer compact zoom-200 light dark reduced-motion"
    >
      <Skeleton class="h-3 w-full" />
      <Skeleton class="h-3 w-3/4" />
      <Skeleton class="h-20 w-full" />
    </div>
    <div data-catalog-rendered-state="avatar"><Skeleton class="size-8 rounded-full" /></div>
  {:else if componentId === 'loading-indicator'}
    <div
      class="grid gap-2"
      data-catalog-rendered-state="bloom pulse twist light dark reduced-motion"
    >
      {#each intentMarkVariants as variant (variant)}
        <div class="flex items-center gap-3" data-loader-variant={variant}>
          <span class="type-caption w-14 capitalize text-muted-foreground">{variant}</span>
          <IntentMarkLoader {variant} size={24} />
        </div>
      {/each}
    </div>
    <div class="grid gap-2" data-catalog-rendered-state="size-16 size-24 size-32">
      <span class="type-caption text-muted-foreground">Bloom sizes</span>
      <div class="flex items-center gap-4">
        {#each [16, 24, 32] as loaderSize (loaderSize)}
          <div class="flex items-center gap-1.5" data-loader-size={loaderSize}>
            <IntentMarkLoader variant="bloom" size={loaderSize} />
            <span class="type-caption text-muted-foreground">{loaderSize}</span>
          </div>
        {/each}
      </div>
    </div>
    <div
      class="flex items-center gap-3"
      data-catalog-rendered-state="paused"
      data-loader-paused
    >
      <IntentMarkLoader variant="bloom" size={16} playing={false} />
      <span class="type-caption text-muted-foreground"
        >Paused and reduced-motion frames keep the full mark at 16 px.</span
      >
    </div>
    <div class="grid gap-3" data-catalog-rendered-state="in-button in-list-row">
      <div class="grid gap-1.5" data-loader-context="button">
        <span class="type-caption text-muted-foreground">Button loading</span>
        <Button loading>Button loading</Button>
      </div>
      <div class="grid gap-1.5" data-loader-context="list-row">
        <span class="type-caption text-muted-foreground">ListItem loading</span>
        <ListContainer>
          <ListItem title="Loading workspace" loading />
        </ListContainer>
      </div>
    </div>
  {/if}
</div>
