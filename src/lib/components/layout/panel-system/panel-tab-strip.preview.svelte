<script lang="ts" module>
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    PREVIEW_FIXTURE_IDS,
    definePreviewFixture,
  } from '$lib/component-catalog/preview-fixtures';

  export interface PanelTabStripPreviewProps {
    activeTabId: string | null;
    tabs: PanelTab[];
    width: number;
  }

  const tabFixture = definePreviewFixture<PanelTab>({
    id: PREVIEW_FIXTURE_IDS.note,
    type: 'note',
    title: 'Preview implementation plan',
    closable: true,
    workspaceId: PREVIEW_FIXTURE_IDS.workspace,
    noteId: PREVIEW_FIXTURE_IDS.note,
  });
  const noteTab = tabFixture();
  const agentTab = tabFixture({
    id: PREVIEW_FIXTURE_IDS.agent,
    type: 'agent',
    title: 'Workspace preview implementor',
    noteId: undefined,
    agentId: PREVIEW_FIXTURE_IDS.agent,
  });
  const fileTab = tabFixture({
    id: PREVIEW_FIXTURE_IDS.message,
    type: 'file',
    title: 'workspace-sidebar.preview.svelte',
    noteId: undefined,
    filePath: '/repos/cloudlands-fe/src/lib/components/workspace/workspace-sidebar.preview.svelte',
    hasUnsavedChanges: true,
  });
  const browserTab = tabFixture({
    id: PREVIEW_FIXTURE_IDS.thread,
    type: 'browser',
    title: 'Workspace sidebar preview',
    noteId: undefined,
    browserUrl: 'http://127.0.0.1:5491/sandbox/workspace-sidebar',
  });
  const terminalTab = tabFixture({
    id: PREVIEW_FIXTURE_IDS.task,
    type: 'terminal',
    title: 'Focused component tests',
    noteId: undefined,
    terminalId: PREVIEW_FIXTURE_IDS.task,
  });
  const longTab = tabFixture({
    id: PREVIEW_FIXTURE_IDS.panel,
    type: 'file',
    title: 'A very long panel title that must truncate before the actions',
    noteId: undefined,
    filePath:
      '/repos/cloudlands-fe/src/lib/components/layout/panel-system/a-very-deep-folder/panel-tab-strip.preview.svelte',
  });
  const manyTabs = [noteTab, agentTab, fileTab, browserTab, terminalTab];

  export const preview = definePreview<PanelTabStripPreviewProps>({
    id: 'panel-tab-strip',
    title: 'Panel tab strip',
    defaultState: 'single',
    states: {
      empty: { props: { activeTabId: null, tabs: [], width: 560 } },
      single: { props: { activeTabId: noteTab.id, tabs: [noteTab], width: 560 } },
      'agent-stack': {
        props: { activeTabId: agentTab.id, tabs: [noteTab, agentTab, fileTab], width: 560 },
      },
      'many-tabs': { props: { activeTabId: fileTab.id, tabs: manyTabs, width: 760 } },
      'long-content': { props: { activeTabId: longTab.id, tabs: [longTab], width: 560 } },
      narrow: { props: { activeTabId: fileTab.id, tabs: manyTabs, width: 260 } },
    },
  });
</script>

<script lang="ts">
  import PanelTabBar from './PanelTabBar.svelte';

  let { activeTabId, tabs, width }: PanelTabStripPreviewProps = $props();
</script>

<section
  class="overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
  style:width={`${width}px`}
  data-panel-tab-strip-preview
  data-preview-width={width}
>
  <PanelTabBar
    {tabs}
    {activeTabId}
    panelId={PREVIEW_FIXTURE_IDS.panel}
    workspaceId={PREVIEW_FIXTURE_IDS.workspace}
    availableCanvasWidth={width}
    isFocused
    showTabStrip
    onTabClick={() => {}}
    onTabClose={() => {}}
    onClosePanel={() => {}}
  />
</section>
