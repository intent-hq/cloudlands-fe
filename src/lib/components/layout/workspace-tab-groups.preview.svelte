<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { WorkspaceTabGroup } from '$store/renderer/slices/tab-state/tab-groups';

  interface WorkspaceTabGroupsPreviewProps {
    openWorkspaceIds: string[];
    activeWorkspaceId: string;
    tabGroups: WorkspaceTabGroup[];
  }

  // i18n-ignore (preview fixture titles)
  const workspaces = [
    { id: 'tg-site', title: 'Intent Site' },
    { id: 'tg-app', title: 'Intent App' },
    { id: 'tg-api', title: 'Intent API' },
    { id: 'tg-docs', title: 'Intent Docs' },
    { id: 'tg-cli', title: 'Intent CLI' },
    { id: 'tg-lukew', title: 'Ask LukeW/ Layout' },
    { id: 'tg-trace', title: 'Trace Web' },
    { id: 'tg-trace-api', title: 'Trace API' },
    { id: 'tg-trace-docs', title: 'Trace Docs' },
    { id: 'tg-paper', title: 'Research paper' },
    { id: 'tg-notes', title: 'Interview notes' },
    { id: 'tg-survey', title: 'Survey results' },
    { id: 'tg-figma', title: 'Figma tokens' },
    { id: 'tg-icons', title: 'Icon set' },
    { id: 'tg-motion', title: 'Motion spec' },
    { id: 'tg-release', title: 'Release notes' },
    { id: 'tg-bug-1', title: 'Crash on resume' },
    { id: 'tg-bug-2', title: 'Slow tab switch' },
    { id: 'tg-bug-3', title: 'Menu clipping' },
    { id: 'tg-bug-4', title: 'Theme flicker' },
    { id: 'tg-bug-5', title: 'Login loop' },
  ];

  const group = (
    id: string,
    name: string,
    color: WorkspaceTabGroup['color'],
    workspaceIds: string[],
  ): WorkspaceTabGroup => ({ id, name, color, workspaceIds });

  export const preview = definePreview<WorkspaceTabGroupsPreviewProps>({
    id: 'workspace-tab-groups',
    title: 'Workspace tab groups',
    defaultState: 'open-group',
    states: {
      'open-group': {
        props: {
          openWorkspaceIds: ['tg-site', 'tg-app', 'tg-api', 'tg-docs', 'tg-trace'],
          activeWorkspaceId: 'tg-app',
          tabGroups: [group('intent', 'Intent', 'blue', ['tg-app', 'tg-api', 'tg-docs'])],
        },
      },
      'collapsed-group': {
        props: {
          openWorkspaceIds: [
            'tg-site',
            'tg-paper',
            'tg-notes',
            'tg-survey',
            'tg-lukew',
            'tg-trace',
          ],
          activeWorkspaceId: 'tg-site',
          tabGroups: [
            group('research', 'Research', 'purple', ['tg-paper', 'tg-notes', 'tg-survey']),
          ],
        },
      },
      'several-collapsed': {
        props: {
          openWorkspaceIds: [
            'tg-site',
            'tg-app',
            'tg-api',
            'tg-docs',
            'tg-cli',
            'tg-lukew',
            'tg-trace-api',
            'tg-trace-docs',
            'tg-trace',
            'tg-figma',
            'tg-icons',
            'tg-motion',
            'tg-bug-1',
            'tg-bug-2',
            'tg-bug-3',
            'tg-bug-4',
            'tg-bug-5',
            'tg-release',
          ],
          activeWorkspaceId: 'tg-lukew',
          tabGroups: [
            group('intent', 'Intent', 'blue', ['tg-app', 'tg-api', 'tg-docs', 'tg-cli']),
            group('trace', '', 'green', ['tg-trace-api', 'tg-trace-docs']),
            group('design', 'Design', 'orange', ['tg-figma', 'tg-icons', 'tg-motion']),
            group('bugs', '', 'pink', ['tg-bug-1', 'tg-bug-2', 'tg-bug-3', 'tg-bug-4', 'tg-bug-5']),
          ],
        },
      },
      'open-unnamed': {
        props: {
          openWorkspaceIds: ['tg-site', 'tg-trace', 'tg-trace-api', 'tg-trace-docs', 'tg-app'],
          activeWorkspaceId: 'tg-trace',
          tabGroups: [group('trace', '', 'green', ['tg-trace', 'tg-trace-api', 'tg-trace-docs'])],
        },
      },
    },
  });
</script>

<script lang="ts">
  import { store } from '$store/renderer/configured-store';
  import { setLabsTabGroupsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import WorkspaceTabStripGeometryPreview from './workspace-tab-strip-geometry.preview.svelte';

  store.dispatch(setLabsTabGroupsEnabled(true));

  let { openWorkspaceIds, activeWorkspaceId, tabGroups }: WorkspaceTabGroupsPreviewProps = $props();
</script>

<WorkspaceTabStripGeometryPreview
  extraWorkspaces={workspaces}
  initialOpenWorkspaceIds={openWorkspaceIds}
  {activeWorkspaceId}
  {tabGroups}
  widthPx={1200}
/>
