<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'specialist-detail',
    title: 'Specialist detail controls',
    defaultState: 'modified',
    states: {
      modified: { props: {} },
      guest: { props: { role: 'guest' } },
      'guest-rules': { props: { role: 'guest', rules: true } },
      member: { props: { role: 'member' } },
      'guest-create': { props: { role: 'guest', create: true } },
      create: { props: { create: true } },
      'create-flow': { props: { create: true, creationFlow: true } },
      imported: { props: { imported: true } },
      'imported-missing-skills': { props: { imported: true, missingSkills: true } },
      'import-diagnostics': { props: { diagnosticCode: 'invalid', emptyCatalog: true } },
      'import-diagnostics-remote': {
        props: { diagnosticCode: 'invalid', emptyCatalog: true, diagnosticWorkspace: 'remote' },
      },
      'import-scan-limit': {
        props: { diagnosticCode: 'scan-limit', diagnosticIsDirectory: true, emptyCatalog: true },
      },
      'imported-unsupported': { props: { imported: true, unsupported: true, source: 'project' } },
    },
  });
</script>

<script lang="ts">
  import { admitLegacyPrincipal, withHostPrincipal } from '../../../test/fixtures/principal-state';
  import { principalReceived } from '$store/renderer/slices/principal/principal-slice';
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import type {
    SpecialistCatalog,
    SpecialistImportDiagnostic,
    SpecialistDef,
  } from '$lib/client/app-client';
  import SpecialistImportDiagnostics from './SpecialistImportDiagnostics.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    setSpecialistImportDiagnostics,
    setBundledSpecialists,
    setFileSpecialists,
  } from '$store/renderer/slices/specialists/specialists-slice';
  import {
    selectSpecialists,
    selectSpecialistImportDiagnostics,
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
  import type { AIBehaviorView } from './AIBehaviorSidebar.svelte';
  import {
    startSpecialistCatalogPreview,
    startRulesPreview,
    interceptSpecialistEditorLaunches,
    diagnosticWorkspaceId,
    installDiagnosticWorkspace,
  } from './__tests__/specialist-detail.fixture';

  let {
    rules = false,
    role = 'owner',
    create = false,
    imported = false,
    unsupported = false,
    source = 'user',
    missingSkills = false,
    diagnosticCode,
    diagnosticIsDirectory = false,
    diagnosticWorkspace,
    emptyCatalog = false,
    catalogFlow = false,
    creationFlow = false,
  }: {
    rules?: boolean;
    role?: 'owner' | 'member' | 'guest';
    create?: boolean;
    imported?: boolean;
    unsupported?: boolean;
    source?: 'user' | 'project';
    missingSkills?: boolean;
    diagnosticCode?: SpecialistImportDiagnostic['code'];
    diagnosticIsDirectory?: boolean;
    diagnosticWorkspace?: 'local' | 'remote';
    emptyCatalog?: boolean;
    catalogFlow?: boolean;
    creationFlow?: boolean;
  } = $props();

  admitLegacyPrincipal();
  const admitted = withHostPrincipal(appStore.state, role);
  appStore.dispatch(
    principalReceived(
      { context: admitted.principal.context!, invalidation: 0, presentationVersion: 0 },
      admitted.principal.snapshot!,
    ),
  );
  const resolvedSpecialists = selectSpecialists();
  let catalogRequests = $state(0);
  let showEditor = $state(true);
  let createdView = $state<AIBehaviorView | undefined>();
  let releaseWrite = $state<(() => void) | undefined>();
  let releaseCatalog = $state<(() => void) | undefined>();
  let writes = $state(0);
  let holdCatalog = false;

  let catalogFailure = false;
  let liveCatalog: SpecialistCatalog = { specialists: [] };
  const notificationListeners = new Map<
    string,
    { channel: string; handler: (payload: unknown) => void }
  >();
  let listenerSequence = 0;
  let stopCatalog: (() => void) | undefined;

  function refreshCatalog(empty = false, fail = false) {
    catalogFailure = fail;
    if (empty)
      liveCatalog = {
        specialists: [],
        importDiagnostics: [
          {
            path: '/tmp/intent-demo/.claude/agents/skipped-agent.md',
            source: 'project',
            code: 'invalid',
            message: 'Repair invalid frontmatter in the original agent file.',
          },
        ],
      };
    for (const { channel, handler } of notificationListeners.values()) {
      if (channel === 'backend:notification')
        handler({ method: 'specialists:changed', params: {} });
    }
  }

  let launches = $state<Array<{ channel: string; args: unknown[] }>>([]);
  const disposeLaunchHandlers = interceptSpecialistEditorLaunches((launch) => {
    launches = [...launches, launch];
  });
  const previous = {
    diagnostics: selectSpecialistImportDiagnostics.select(appStore.state),
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
      on: (channel: string, handler: (payload: unknown) => void) => {
        const id = String(++listenerSequence);
        notificationListeners.set(id, { channel, handler });
        return id;
      },
      offById: (_channel: string, id: string) => notificationListeners.delete(id),
      invoke: async (channel: string, ...args: unknown[]) => {
        if ((catalogFlow || creationFlow) && channel === 'backend:request') {
          const request = args[0] as { method: string; params?: { spec: SpecialistDef } };
          if (creationFlow && request.method === 'specialist.create') {
            writes += 1;
            const definition = request.params!.spec;
            await new Promise<void>((resolve) => {
              releaseWrite = resolve;
            });
            releaseWrite = undefined;
            liveCatalog = { specialists: [...liveCatalog.specialists, definition] };
            holdCatalog = true;
            return { ok: true, result: { specialist: definition } };
          }
          if (request.method === 'specialist.list') {
            catalogRequests += 1;
            if (creationFlow && holdCatalog) {
              await new Promise<void>((resolve) => {
                releaseCatalog = resolve;
              });
              releaseCatalog = undefined;
              holdCatalog = false;
            }
            return catalogFailure
              ? {
                  ok: false,
                  error: { code: 'TRANSPORT_ERROR', message: 'Preview catalog unavailable' },
                }
              : { ok: true, result: liveCatalog };
          }
          return { ok: true, result: {} };
        }
        if ((catalogFlow || creationFlow) && channel === 'backend:subscribe')
          return { ok: true, result: { subscriptionId: 'preview-catalog' } };
        if ((catalogFlow || creationFlow) && channel === 'backend:unsubscribe')
          return { ok: true, result: {} };
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
  appStore.dispatch(setBundledSpecialists(imported || emptyCatalog ? [] : [specialist]));
  appStore.dispatch(
    setFileSpecialists(
      emptyCatalog
        ? []
        : [
            {
              ...specialist,
              model: '',
              behaviorPrompt: 'Review the sample change. Summarize the result clearly.',
              filePath: imported
                ? source === 'project'
                  ? '/tmp/intent-demo/.claude/agents/review-helper.md'
                  : '/tmp/intent-demo/home/.claude/agents/review-helper.md'
                : '/tmp/intent-demo/specialists/review-helper.md',
              source,
              importedFrom: imported ? 'claude-code' : undefined,
              unsupportedFields: imported && unsupported ? ['tools', 'permissionMode'] : undefined,
              requiredSkills: missingSkills ? ['code-review'] : undefined,
              missingSkills: missingSkills ? ['code-review'] : undefined,
            },
          ],
    ),
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
  appStore.dispatch(
    setSpecialistImportDiagnostics(
      diagnosticCode
        ? [
            {
              path: diagnosticIsDirectory
                ? '/tmp/intent-demo/.claude/agents'
                : '/tmp/intent-demo/.claude/agents/skipped-agent.md',
              isDirectory: diagnosticIsDirectory,
              source: 'project',
              code: diagnosticCode,
              message: 'Preview import diagnostic.',
            },
          ]
        : [],
    ),
  );

  function restoreRequiredSkill() {
    if (catalogFlow) {
      liveCatalog = {
        ...liveCatalog,
        specialists: liveCatalog.specialists.map((specialist) => ({
          ...specialist,
          missingSkills: undefined,
        })),
      };
      for (const { channel, handler } of notificationListeners.values()) {
        if (channel === 'backend:notification') handler({ method: 'skills:changed', params: {} });
      }
      return;
    }
    appStore.dispatch(
      setFileSpecialists(
        selectFileSpecialists
          .select(appStore.state)
          .map((file) => ({ ...file, missingSkills: undefined })),
      ),
    );
  }

  $effect(() => {
    if (!diagnosticWorkspace) return;
    return installDiagnosticWorkspace(
      diagnosticWorkspace,
      selectSpecialistImportDiagnostics.select(appStore.state),
    );
  });

  appStore.dispatch(setOpenAction('vscode'));
  if (catalogFlow) {
    liveCatalog = {
      specialists: [
        {
          ...specialist,
          source: 'user',
          importedFrom: 'claude-code',
          behaviorPrompt: specialist.defaultBehaviorPrompt,
          path: '/tmp/intent-demo/home/.claude/agents/review-helper.md',
          requiredSkills: missingSkills ? ['code-review'] : undefined,
          missingSkills: missingSkills ? ['code-review'] : undefined,
        },
      ],
    };
    stopCatalog = startSpecialistCatalogPreview();
  }
  const stopRules = rules ? startRulesPreview() : undefined;
  if (creationFlow) stopCatalog = startSpecialistCatalogPreview();
  onDestroy(() => {
    stopRules?.();
    stopCatalog?.();
    releaseWrite?.();
    releaseCatalog?.();
    disposeLaunchHandlers();
    appStore.dispatch(setSpecialistImportDiagnostics(previous.diagnostics));
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
  <SpecialistImportDiagnostics
    workspaceId={diagnosticWorkspace ? diagnosticWorkspaceId : undefined}
  />
  {#if catalogFlow}
    <!-- i18n-ignore (preview-only test controls) -->
    <Button data-testid="fail-catalog-refresh" onclick={() => refreshCatalog(false, true)}
      >Fail catalog refresh</Button
    >
    <!-- i18n-ignore (preview-only test controls) -->
    <Button data-testid="empty-catalog-refresh" onclick={() => refreshCatalog(true)}
      >Empty catalog refresh</Button
    >
    <output class="sr-only" data-testid="catalog-ids"
      >{JSON.stringify($resolvedSpecialists.map((specialist) => specialist.id))}</output
    >
    <output class="sr-only" data-testid="catalog-requests">{catalogRequests}</output>
  {/if}
  {#if missingSkills}
    <!-- i18n-ignore (preview-only test control) -->
    <Button data-testid="restore-required-skill" onclick={restoreRequiredSkill}
      >Restore required skill</Button
    >
  {/if}
  {#if creationFlow}
    <!-- i18n-ignore (preview-only controls for deferred transport and editor lifetime) -->
    <div class="mb-4 flex flex-wrap gap-2">
      <Button
        onclick={() => {
          showEditor = !showEditor;
        }}>Toggle editor</Button
      >
      <Button disabled={!releaseWrite} onclick={() => releaseWrite?.()}>Complete write</Button>
      <Button disabled={!releaseCatalog} onclick={() => releaseCatalog?.()}>Complete refresh</Button
      >
      <Button
        disabled={!releaseCatalog}
        onclick={() => {
          catalogFailure = true;
          releaseCatalog?.();
        }}>Fail refresh</Button
      >
      <Button
        onclick={() => {
          catalogFailure = false;
        }}>Restore catalog</Button
      >
      <output data-testid="creation-writes">{writes}</output>
    </div>
  {/if}
  {#if showEditor}
    <AIBehaviorEditor
      activeView={createdView ??
        (rules
          ? { type: 'system-prompt' }
          : create
            ? { type: 'create-specialist' }
            : { type: 'specialist', id: 'preview-detail' })}
      workspaceId={null}
      onSpecialistCreated={(id) => {
        createdView = { type: 'specialist', id };
      }}
    />
  {/if}
  <output class="sr-only" data-testid="editor-launches">{JSON.stringify(launches)}</output>
</div>
