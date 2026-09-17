<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'specialist-detail',
    title: 'Specialist detail controls',
    defaultState: 'modified',
    states: { modified: { props: {} } },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    setBundledSpecialists,
    setFileSpecialists,
  } from '$store/renderer/slices/specialists/specialists-slice';
  import {
    selectBundledSpecialists,
    selectFileSpecialists,
  } from '$store/renderer/slices/specialists/specialists-selectors';
  import {
    fetchEditorsSuccess,
    setEditorOrder,
    setOpenAction,
  } from '$store/renderer/slices/external-editors/external-editors-slice';
  import { selectInstalledEditors } from '$store/renderer/slices/external-editors/external-editors-selectors';
  import AIBehaviorEditor from './AIBehaviorEditor.svelte';
  import { interceptSpecialistEditorLaunches } from './__tests__/specialist-detail.fixture';

  let launches = $state<Array<{ channel: string; args: unknown[] }>>([]);
  const disposeLaunchHandlers = interceptSpecialistEditorLaunches((launch) => {
    launches = [...launches, launch];
  });
  const previous = {
    bundled: selectBundledSpecialists.select(appStore.state),
    files: selectFileSpecialists.select(appStore.state),
    editors: selectInstalledEditors.select(appStore.state),
    editorState: appStore.state.externalEditors,
    bridge: Object.getOwnPropertyDescriptor(window, 'electronAPI'),
  };
  // This isolated fixture replaces the entire IPC seam: it never delegates to
  // a real preload, opens an application, or loads production specialist text.
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      versions: { electron: 'preview-native-controls' },
      invoke: async (channel: string, ...args: unknown[]) => {
        launches = [...launches, { channel, args }];
        return { success: true };
      },
    },
  });
  const specialist = {
    id: 'preview-detail',
    name: 'Review helper',
    description: 'Reviews sample changes and explains useful next steps.',
    defaultBehaviorPrompt: 'Review the sample change.',
  };
  appStore.dispatch(setBundledSpecialists([specialist]));
  appStore.dispatch(
    setFileSpecialists([
      {
        ...specialist,
        model: '',
        behaviorPrompt: 'Review the sample change. Summarize the result clearly.',
        filePath: '/tmp/intent-demo/specialists/review-helper.md',
        source: 'user',
      },
    ]),
  );
  appStore.dispatch(
    fetchEditorsSuccess(
      [
        {
          id: 'vscode',
          name: 'Visual Studio Code',
          shortLabel: 'VS Code',
          appName: 'Visual Studio Code',
          category: 'ide',
          handlerType: 'vscode',
          priority: 100,
          installed: true,
        },
      ],
      0,
    ),
  );
  appStore.dispatch(setOpenAction('vscode'));
  onDestroy(() => {
    disposeLaunchHandlers();
    appStore.dispatch(setBundledSpecialists(previous.bundled));
    appStore.dispatch(setFileSpecialists(previous.files));
    appStore.dispatch(fetchEditorsSuccess(previous.editors, previous.editorState.lastFetched));
    appStore.dispatch(setEditorOrder(previous.editorState.editorOrder));
    appStore.dispatch(setOpenAction(previous.editorState.selectedAction));
    if (previous.bridge) Object.defineProperty(window, 'electronAPI', previous.bridge);
    else Reflect.deleteProperty(window, 'electronAPI');
  });
</script>

<div class="w-full min-w-0 bg-background p-6 text-foreground" data-specialist-detail-preview>
  <AIBehaviorEditor activeView={{ type: 'specialist', id: 'preview-detail' }} workspaceId={null} />
  <output class="sr-only" data-testid="editor-launches">{JSON.stringify(launches)}</output>
</div>
