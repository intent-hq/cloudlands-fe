<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    width?: number;
    fontSize?: number;
    mode?: 'local' | 'remote' | 'web';
    surface?: 'files' | 'collapsed' | 'embedded' | 'inline';
  }
  export const preview = definePreview<Props>({
    id: 'files-open-menu',
    title: 'Files menu and inline paths',
    defaultState: 'normal',
    states: {
      normal: { props: { width: 360 } },
      narrow: { props: { width: 248 } },
      scaled: { props: { width: 300, fontSize: 20 } },
      remote: { props: { mode: 'remote' } },
      web: { props: { mode: 'web' } },
      embedded: { props: { surface: 'embedded' } },
      inline: { props: { surface: 'inline' } },
      collapsed: { props: { surface: 'collapsed' } },
      'collapsed-narrow': { props: { surface: 'collapsed', width: 248 } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import OpenComboButton from '$features/external-editors/components/OpenComboButton.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import MultiSelectTabbedSidebar from './MultiSelectTabbedSidebar.svelte';
  import {
    FILES_MENU_PATH,
    FILES_MENU_WORKSPACE,
    setupFilesMenuFixture,
    type FilesMenuRequest,
  } from './__tests__/files-open-menu.fixture';

  let { width = 360, fontSize = 16, mode = 'local', surface = 'files' }: Props = $props();
  let requests = $state<FilesMenuRequest[]>([]);
  // svelte-ignore state_referenced_locally - fixture configuration applies once per mount
  onDestroy(
    setupFilesMenuFixture(
      (request) => (requests = [...requests, request]),
      mode,
      fontSize,
      surface === 'collapsed',
    ),
  );
</script>

<section
  data-files-menu-preview
  class="relative h-[480px] bg-sidebar text-foreground"
  style:width={`${width}px`}
>
  {#if surface === 'files' || surface === 'collapsed'}
    <MultiSelectTabbedSidebar workspaceId={FILES_MENU_WORKSPACE} />
  {:else if surface === 'embedded'}
    <Menu.Root>
      <!-- i18n-ignore (synthetic fixture control) -->
      <Menu.Trigger>File actions</Menu.Trigger>
      <Menu.Content align="start" collisionPadding={8} preventScroll={false}>
        <OpenComboButton filePath={FILES_MENU_PATH} workspaceId={FILES_MENU_WORKSPACE} embedded />
      </Menu.Content>
    </Menu.Root>
  {:else}
    <!-- i18n-ignore (synthetic onboarding-style inline prose) -->
    <p class="type-body p-4 leading-snug">
      Add instructions in
      <OpenComboButton filePath={FILES_MENU_PATH} workspaceId={FILES_MENU_WORKSPACE} inline>
        <span>/sample-project/AGENTS.md</span>
      </OpenComboButton>.
    </p>
  {/if}
  <output class="sr-only" data-testid="files-menu-requests">{JSON.stringify(requests)}</output>
</section>
