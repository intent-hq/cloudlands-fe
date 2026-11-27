<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    target?: 'service' | 'command';
    truncated?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'script-output',
    title: 'Script output',
    defaultState: 'joined',
    states: {
      joined: { props: {} },
      'idle-retained': { props: { target: 'command' } },
      truncated: { props: { truncated: true } },
    },
  });
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import ScriptOutputViewer from './ScriptOutputViewer.svelte';
  import { store } from '$store/renderer/store';
  import { selectScriptOutputViewerWorkspaceIds } from '$store/renderer/slices/scripts/scripts-selectors';
  import {
    appendScriptOutput,
    scriptOutputSnapshotReceived,
  } from '$store/renderer/slices/scripts/scripts-slice';
  import {
    managerShellWorkspace as workspaceId,
    managerShellScripts,
    seedManagerShellAccess,
    setManagerShellRole,
  } from './manager-shell-access.preview-fixtures';

  let { target = 'service', truncated = false }: Props = $props();
  const scriptId = $derived(managerShellScripts[target]);

  const ESC = '\x1b';
  const logLines = Array.from({ length: 40 }, (_, i) =>
    i % 9 === 4
      ? `${ESC}[33mwarn${ESC}[0m  src/routes/page-${i}.svelte: unused export 'data'`
      : `${ESC}[2m${String(i).padStart(2, '0')}:14:0${i % 10}${ESC}[22m ${ESC}[32m✓${ESC}[0m compiled module ${i}`,
  );
  const coveredChunk = `${ESC}[36mVITE${ESC}[0m ready in ${ESC}[1m248 ms${ESC}[22m\r\n`;
  const liveChunk = `${ESC}[2m14:15:02${ESC}[22m ${ESC}[34m[hmr]${ESC}[0m update /src/app.css\r\n`;

  seedManagerShellAccess();
  setManagerShellRole('manager');
  store.dispatch(
    appendScriptOutput(workspaceId, managerShellScripts.service, {
      text: coveredChunk,
      timestamp: '2026-10-21T12:00:01Z',
    }),
  );

  function snapshotText(): string {
    const header = truncated
      ? '[showing last 41 of 18204 lines; older output omitted to fit the reply size limit]'
      : '[41 lines]';
    const tail = target === 'service' ? coveredChunk : `${ESC}[31m✗ 2 type errors${ESC}[0m\r\n`;
    return `${header}\n${logLines.join('\r\n')}\r\n${tail}`;
  }

  // Answers the viewer's snapshot read the way the output saga would.
  const viewerWorkspaces = selectScriptOutputViewerWorkspaceIds();
  let answered = false;
  $effect(() => {
    if (!$viewerWorkspaces.includes(workspaceId) || untrack(() => answered)) return;
    const scripts = store.state.scripts.byWorkspaceId[workspaceId];
    for (const [viewerId, output] of Object.entries(scripts?.retainedOutputs ?? {})) {
      if (output.status !== 'loading') continue;
      answered = true;
      const buffer = scripts?.outputBuffers[output.scriptId];
      const liveOffset = (buffer?.dropped ?? 0) + (buffer?.chunks.length ?? 0);
      store.dispatch(
        scriptOutputSnapshotReceived(
          workspaceId,
          output.scriptId,
          viewerId,
          snapshotText(),
          liveOffset,
        ),
      );
      if (target === 'service') {
        store.dispatch(
          appendScriptOutput(workspaceId, output.scriptId, {
            text: liveChunk,
            timestamp: '2026-10-21T12:00:02Z',
          }),
        );
      }
    }
  });
</script>

<div class="h-96 w-full bg-background text-foreground" data-testid="script-output-preview">
  <ScriptOutputViewer {workspaceId} {scriptId} />
</div>
