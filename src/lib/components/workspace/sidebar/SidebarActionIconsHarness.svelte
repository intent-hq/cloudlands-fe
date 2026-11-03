<script lang="ts">
  import { onDestroy } from 'svelte';
  import SidebarHeaderAction from './SidebarHeaderAction.svelte';
  import SidebarActionIcon from './SidebarActionIcon.svelte';
  import SidebarExpandableSearch from './SidebarExpandableSearch.svelte';
  import ChangesRefreshAction from './ChangesRefreshAction.svelte';
  import SidebarPrDropdown from './SidebarPrDropdown.svelte';
  import CreateAgentSection from '../CreateAgentSection.svelte';
  import AddContextSection from './AddContextSection.svelte';
  import OpenComboButton from '$features/external-editors/components/OpenComboButton.svelte';
  import { buildWorkspacePRPresentationModel } from './workspace-pr-presentation';
  import { PullRequestStatus } from '$shared/types';
  import {
    FILES_MENU_PATH,
    FILES_MENU_WORKSPACE,
    setupFilesMenuFixture,
  } from '../__tests__/files-open-menu.fixture';
  import { m } from '$shared/paraglide/messages.js';

  let {
    refreshDisabled = false,
    filterSelected = false,
  }: {
    refreshDisabled?: boolean;
    filterSelected?: boolean;
  } = $props();
  let filterPressed = $state(false);
  let foldersExpanded = $state(false);
  let agentQuery = $state('');
  let contextQuery = $state('');
  let fileQuery = $state('');
  let lastAction = $state('');
  $effect(() => {
    filterPressed = filterSelected;
  });
  onDestroy(
    setupFilesMenuFixture(
      (request) => {
        lastAction = JSON.stringify(request);
      },
      'local',
      16,
      false,
    ),
  );
  const timestamp = '2026-10-01T12:00:00Z';
  const prs = buildWorkspacePRPresentationModel({
    workspacePRs: [42, 43].map((number) => ({
      id: `header-preview-${number}`,
      number,
      title: `Preview change ${number}`,
      status: PullRequestStatus.Open,
      url: `https://example.test/pull/${number}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
    activePR: null,
    monitors: [],
    workspaceRepo: undefined,
    buildPrUrl: (number) => `https://example.test/pull/${number}`,
    getDisplayTitle: (pr) => pr.title,
  });
</script>

<div class="grid w-full max-w-sm gap-3" data-header-icons-preview>
  {#each ['People', 'Agents', 'Context', 'Changes', 'Files', 'Browsers', 'Shells'] as title}
    <!-- i18n-ignore (catalog fixture headings) -->
    <div
      class="min-w-0 rounded-(--radius-large) bg-selected px-5 pt-3 pb-2 text-foreground dark:bg-surface-4"
      data-header-panel={title}
    >
      <h6 class="flex min-h-7 items-center gap-2 text-sm font-medium">
        <span class="min-w-0 truncate">{title}</span>
        <span class="ml-auto flex min-w-0 items-center gap-0.5">
          {#if title === 'People'}
            <SidebarHeaderAction
              icon="plus"
              label={m.workspace_discussion_new_title()}
              onclick={() => {
                lastAction = 'discussion';
              }}
            />
          {:else if title === 'Agents'}
            <SidebarExpandableSearch
              bind:query={agentQuery}
              scope="agents"
              placeholder={m.workspace_multiSelectSidebar_searchAgents_placeholder()}
            />
            <CreateAgentSection
              compact
              onCreate={() => {
                lastAction = 'agent';
              }}
            />
          {:else if title === 'Context'}
            <SidebarExpandableSearch
              bind:query={contextQuery}
              scope="context"
              placeholder={m.workspace_multiSelectSidebar_searchContext_placeholder()}
            />
            <AddContextSection
              compact
              onAddNote={() => {
                lastAction = 'note';
              }}
            />
          {:else if title === 'Changes'}
            <ChangesRefreshAction
              disabled={refreshDisabled}
              onclick={() => {
                lastAction = 'refresh';
              }}
            />
            <SidebarPrDropdown rows={prs} workspaceId={FILES_MENU_WORKSPACE} side="bottom" />
          {:else if title === 'Files'}
            <SidebarExpandableSearch
              bind:query={fileQuery}
              scope="files"
              placeholder={m.workspace_multiSelectSidebar_searchFiles_placeholder()}
            />
            <SidebarHeaderAction
              icon="plus"
              label={m.workspace_multiSelectSidebar_newFile_tooltip()}
              onclick={() => {
                lastAction = 'file';
              }}
            />
            <SidebarHeaderAction
              icon="filter"
              pressed={filterPressed}
              label={filterPressed
                ? m.workspace_multiSelectSidebar_showAllFiles_tooltip()
                : m.workspace_multiSelectSidebar_showOnlyChangedFiles_tooltip()}
              onclick={() => {
                filterPressed = !filterPressed;
                lastAction = 'filter';
              }}
            />
            <SidebarHeaderAction
              icon={foldersExpanded ? 'collapse' : 'expand'}
              label={foldersExpanded
                ? m.workspace_multiSelectSidebar_collapseAll_tooltip()
                : m.workspace_multiSelectSidebar_expandAll_tooltip()}
              onclick={() => {
                foldersExpanded = !foldersExpanded;
                lastAction = 'folders';
              }}
            />
            <OpenComboButton
              filePath={FILES_MENU_PATH}
              workspaceId={FILES_MENU_WORKSPACE}
              isDirectory
              variant="sidebar"
              iconOnly
            >
              <SidebarActionIcon icon="open" />
              <span class="sr-only">{m.ui_openCombo_openInApp_tooltip()}</span>
            </OpenComboButton>
          {:else}
            <SidebarHeaderAction
              icon="plus"
              label={title === 'Browsers' ? m.menu_new_browser() : m.menu_new_terminal()}
              onclick={() => {
                lastAction = title;
              }}
            />
          {/if}
        </span>
      </h6>
    </div>
  {/each}
  <output class="sr-only" data-header-last-action>{lastAction}</output>
</div>
