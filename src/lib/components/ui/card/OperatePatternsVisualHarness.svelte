<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { ListContainer, ListEmpty, ListItem, ListSection } from '$lib/components/ui/list';
  import * as Menu from '$lib/components/ui/menu';
  import { SettingsFieldRow } from '$lib/components/ui/settings-field-row';
  import { SettingsPageShell } from '$lib/components/ui/settings-page-shell';
  import { SettingsSection } from '$lib/components/ui/settings-section';
  import * as Sheet from '$lib/components/ui/sheet';
  import * as Card from './index';

  let { view = 'patterns' }: { view?: 'patterns' | 'menu' | 'dialog' | 'sheet' } = $props();
  let menuOpen = $state(true);
  let dialogOpen = $state(true);
  let sheetOpen = $state(true);
</script>

<main class="min-h-screen min-w-0 bg-background p-4 text-foreground sm:p-8" data-visual-view={view}>
  <header class="mx-auto mb-8 max-w-5xl space-y-2">
    <p class="text-sm font-medium text-info">Operate patterns</p>
    <h1 class="text-2xl font-medium tracking-tight">Editorial overlays and reusable surfaces</h1>
    <p class="max-w-2xl text-sm leading-6 text-muted-foreground">
      Thin boundaries, compact rows, semantic focus, generous composition, and dark-mode parity.
    </p>
  </header>

  {#if view === 'patterns'}
    <div class="mx-auto grid max-w-5xl min-w-0 gap-6 lg:grid-cols-2">
      <section class="min-w-0 space-y-3" aria-label="Cards">
        <Card.Root>
          <Card.Header>
            <Card.Title>Workspace notifications</Card.Title>
            <Card.Description>Structured metadata remains quiet and readable.</Card.Description>
            <Card.Action><Button size="sm" variant="outline">Manage</Button></Card.Action>
          </Card.Header>
          <Card.Content>
            A canonical raised surface with one-pixel structure and restrained elevation.
          </Card.Content>
          <Card.Footer><span class="text-muted-foreground">Updated moments ago</span></Card.Footer>
        </Card.Root>
        <Card.Root inert>
          <Card.Content>Intentionally inert content uses the shared semantic hatch.</Card.Content>
        </Card.Root>
      </section>

      <section class="min-w-0 space-y-3" aria-label="Lists">
        <ListSection title="Recent work" collapsible collapsed={false}>
          <ListContainer>
            <ListItem title="Selected editorial row" subtitle="Secondary metadata" selected />
            <ListItem title="Active row" subtitle="Focus boundary" active badge="Live" />
            <ListItem title="Disabled row" disabled />
          </ListContainer>
        </ListSection>
        <ListEmpty message="No archived items" />
      </section>

      <section class="min-w-0 lg:col-span-2" aria-label="Settings composition">
        <SettingsPageShell
          title="Application settings"
          description="A stable header, independently scrolling content, and fixed footer remain readable with long localized copy."
          class="h-128 rounded-lg border border-border"
        >
          <SettingsSection
            id="visual-general"
            title="General"
            description="Compact fields stay dense while labels and descriptions wrap naturally."
          >
            <SettingsFieldRow
              id="visual-updates"
              label="Automatic updates"
              description="Download and install updates when the application is idle."
              status="Up to date"
            >
              <Button size="sm" variant="outline">Check now</Button>
            </SettingsFieldRow>
            <SettingsFieldRow
              id="visual-long"
              label="A deliberately long preference label that demonstrates mobile stacking"
              description="Supporting copy continues onto multiple lines without forcing horizontal overflow at compact widths or increased zoom."
            >
              <Button size="sm">Configure</Button>
            </SettingsFieldRow>
          </SettingsSection>
          {#snippet footer()}Changes save according to each field's existing behavior.{/snippet}
        </SettingsPageShell>
      </section>
    </div>
  {:else if view === 'menu'}
    <div class="mx-auto max-w-5xl rounded-lg border border-border bg-card p-8">
      <Menu.Root bind:open={menuOpen}>
        <Menu.Trigger><Button variant="outline">Open editorial menu</Button></Menu.Trigger>
        <Menu.Content portal={false}>
          <Menu.Item>Open workspace</Menu.Item>
          <Menu.Item>Duplicate</Menu.Item>
          <Menu.Separator />
          <Menu.CheckboxItem checked closeOnSelect={false}>Show metadata</Menu.CheckboxItem>
          <Menu.Item destructive>Delete workspace</Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </div>
  {:else if view === 'dialog'}
    <Dialog.Root bind:open={dialogOpen}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Delete workspace?</Dialog.Title>
          <Dialog.Description>
            This destructive confirmation preserves focus trapping, explicit dismissal, and compact
            action hierarchy.
          </Dialog.Description>
        </Dialog.Header>
        <div class="rounded-md border border-border bg-muted p-3 text-sm">
          Morning penguin workspace and its local session history
        </div>
        <Dialog.Footer>
          <Dialog.Close><Button variant="outline">Cancel</Button></Dialog.Close>
          <Button variant="destructive">Delete workspace</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  {:else}
    <Sheet.Root bind:open={sheetOpen}>
      <Sheet.Content>
        <Sheet.Header>
          <Sheet.Title>Workspace details</Sheet.Title>
          <Sheet.Description>
            A contained side panel with stable dividers, semantic surface hierarchy, and scrolling.
          </Sheet.Description>
        </Sheet.Header>
        <div class="min-w-0 space-y-4 px-5 py-4 text-sm">
          <Card.Root>
            <Card.Header><Card.Title>Connection</Card.Title></Card.Header>
            <Card.Content>Connected to the local development daemon.</Card.Content>
          </Card.Root>
          <p class="break-words text-muted-foreground">
            Long content wraps within the panel at compact widths and remains readable at increased
            zoom without creating page-level overflow.
          </p>
        </div>
        <Sheet.Footer><Button variant="outline">Done</Button></Sheet.Footer>
      </Sheet.Content>
    </Sheet.Root>
  {/if}
</main>
