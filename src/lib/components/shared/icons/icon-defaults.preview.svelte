<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    layout?: 'list' | 'submenu';
  }

  export const preview = definePreview<Props>({
    id: 'icon-defaults',
    title: 'Shared icon defaults',
    defaultState: 'workspace',
    states: {
      workspace: { props: { layout: 'list' } },
      submenu: { props: { layout: 'submenu' } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { initializeIconPreview } from './icon-defaults.fixture';
  import WorkspaceActionsMenu from '$features/workspace/components/WorkspaceActionsMenu.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { Button } from '$lib/components/ui/button';
  import { faArrowRightArrowLeft, faCopy, faGithub } from '$lib/icons/phosphor-icons';
  import KebabIcon from '$lib/components/icons/KebabIcon.svelte';
  import Fa from 'svelte-fa';

  let { layout = 'list' }: Props = $props();
  let open = $state(false);
  let lastAction = $state('');

  onMount(initializeIconPreview);
</script>

<section
  class="w-full bg-card p-4 text-card-foreground"
  data-testid="icon-defaults-preview"
  data-last-action={lastAction}
>
  <div class="mb-3 flex items-center gap-3" data-icon-default-samples>
    <Fa icon={faCopy} size={16} title="Default action" />
    <Fa icon={faGithub} size={16} title="Preserved brand" />
    <Fa icon={faCopy} size={16} secondaryOpacity={0.5} title="Preserved duotone" />
  </div>
  <Menu.Root bind:open>
    <Menu.Trigger>
      {#snippet child({ props })}
        <Button {...props} variant="ghost" size="icon-sm" aria-label="Workspace actions">
          <KebabIcon />
        </Button>
      {/snippet}
    </Menu.Trigger>
    <Menu.Content class="w-72" portal={false}>
      <WorkspaceActionsMenu
        {layout}
        filePath="/tmp/icon-preview/project"
        showArchiveOption
        showDeleteOption
        onArchive={() => (lastAction = 'archive')}
        onDelete={() => (lastAction = 'delete')}
        onClose={() => (open = false)}
        additionalActions={[
          {
            id: 'transfer-to-host',
            label: 'Transfer to host',
            icon: faArrowRightArrowLeft,
            onClick: () => (lastAction = 'transfer'),
          },
        ]}
      />
    </Menu.Content>
  </Menu.Root>
</section>
