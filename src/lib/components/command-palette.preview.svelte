<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { ContentType, NoteVisibility, WorkspaceStatus, type Note } from '$shared/types';
  import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
  import { ChangeStage } from '$features/file-tracking/types';
  import { store as appStore } from '$store/renderer/store';
  import {
    clearWorkspaceNotesForWorkspaces,
    loadWorkspaceNotesSucceeded,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import { clearWorkspace, setChangesData } from '$store/renderer/slices/changes/changes-slice';
  import {
    removeWorkspaceEntity,
    setWorkspaceEntity,
  } from '$store/renderer/slices/workspace/workspace-slice';
  import { PREVIEW_FIXTURE_TIMESTAMPS } from '$lib/component-catalog/preview-fixtures';
  import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
  import { setupPaletteNoteSearch } from '../../test/fixtures/command-palette-note-search-fixture';
  import { trackKnownRepoLoads } from '../../test/fixtures/command-palette-repos-fixture';
  import type { MockBackendMethodHandler } from '../../test/ct-mock-electron-bridge';
  import { setLabsCloudMachinesEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import {
    setWorkspaceInitializerRecentRepos,
    workspaceInitializerRecentReposRefreshFinished,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import type { WorkspaceInitializerRecentRepo } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';

  const workspaceId = WorkspaceId('preview-command-palette');
  const timestamp = '2026-09-15T12:00:00.000Z';
  function setup(longNames = false, methods: Record<string, MockBackendMethodHandler> = {}) {
    const notes: Note[] = Array.from({ length: 16 }, (_, index) => ({
      id: NoteId(`preview-palette-note-${index}`),
      workspaceId,
      title: longNames
        ? 'Command palette accessibility and keyboard navigation across every workspace and repository — implementation notes'
        : index === 0
          ? 'Project context'
          : `Context ${index}: accessible keyboard navigation`,
      content: '',
      contentType: ContentType.Markdown,
      tags: ['Design review', 'Keyboard and pointer interactions'],
      isPinned: false,
      isArchived: false,
      visibility: NoteVisibility.Workspace,
      parentId: index > 0 ? NoteId('preview-palette-note-0') : undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    const stopSearch = setupPaletteNoteSearch(notes, methods);
    appStore.dispatch(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: notes }));
    appStore.dispatch(
      setChangesData(
        workspaceId,
        ['src/components/navigation/CommandSearch.svelte', 'src/styles/interaction-tokens.css'].map(
          (path, index) => ({
            id: `preview-palette-change-${index}`,
            file: path,
            relativePath: path,
            stage: ChangeStage.Unstaged,
            stats: { additions: 12, deletions: 3 },
            attribution: { timestamp: Date.parse(timestamp) },
          }),
        ),
        false,
        2,
      ),
    );
    return () => {
      stopSearch();
      appStore.dispatch(clearWorkspaceNotesForWorkspaces([workspaceId]));
      appStore.dispatch(clearWorkspace(workspaceId));
    };
  }

  /** The workspace owner sees every filter, including Terminals and Browser. */
  function setupOwner() {
    const stop = setup();
    admitLegacyPrincipal('owner');
    appStore.dispatch(
      setWorkspaceEntity({
        id: workspaceId,
        title: 'Command palette preview',
        repositoryName: 'intent',
        branch: 'preview/command-palette',
        status: WorkspaceStatus.Active,
        myRole: 'owner',
        changesets: [],
        timeline: [],
        conversationInfo: [],
        ...PREVIEW_FIXTURE_TIMESTAMPS,
      }),
    );
    return () => {
      stop();
      appStore.dispatch(removeWorkspaceEntity(workspaceId));
    };
  }

  /** Search lists a retired workspace (PROTOCOL §5.1) with a Retired badge. */
  function setupRetired() {
    const stop = setupOwner();
    const base = {
      repositoryName: 'intent',
      myRole: 'owner' as const,
      changesets: [],
      timeline: [],
      conversationInfo: [],
      ...PREVIEW_FIXTURE_TIMESTAMPS,
    };
    const live = WorkspaceId('preview-palette-importer-live');
    const retired = WorkspaceId('preview-palette-importer-retired');
    appStore.dispatch(
      setWorkspaceEntity({
        ...base,
        id: live,
        title: 'Importer rewrite',
        branch: 'feat/importer-rewrite',
        status: WorkspaceStatus.Active,
      }),
    );
    appStore.dispatch(
      setWorkspaceEntity({
        ...base,
        id: retired,
        title: 'Prototype the old importer',
        branch: 'feat/old-importer',
        status: WorkspaceStatus.Retired,
        archived: true,
        archivedAt: '2026-09-10T00:00:00.000Z',
        retiredAt: '2026-09-20T00:00:00.000Z',
      }),
    );
    return () => {
      stop();
      appStore.dispatch(removeWorkspaceEntity(live));
      appStore.dispatch(removeWorkspaceEntity(retired));
    };
  }

  /** Labs: the E2B cloud machines command, from off or on. */
  function setupCloudLab(enabled: boolean) {
    const previous = appStore.state.userPreferences?.labsCloudMachinesEnabled === true;
    appStore.dispatch(setLabsCloudMachinesEnabled(enabled));
    const stop = setupPaletteNoteSearch();
    return () => {
      stop();
      appStore.dispatch(setLabsCloudMachinesEnabled(previous));
    };
  }

  const cloudlandsUrl = 'https://github.com/intent-hq/cloudlands-fe';
  /** Saved repos: a local clone and the GitHub entry of one repo, a GitLab repo, another clone. */
  const savedRepos: WorkspaceInitializerRecentRepo[] = [
    {
      path: '/Users/dev/code/cloudlands-fe',
      type: 'local',
      name: 'cloudlands-fe',
      owner: 'intent-hq',
      githubUrl: cloudlandsUrl,
      lastUsedAt: '2026-09-15T10:00:00.000Z',
    },
    {
      path: 'intent-hq/cloudlands-fe',
      type: 'github',
      name: 'cloudlands-fe',
      owner: 'intent-hq',
      githubUrl: cloudlandsUrl,
      lastUsedAt: '2026-09-12T10:00:00.000Z',
    },
    {
      path: 'https://gitlab.com/acme/platform/billing',
      type: 'github',
      name: 'billing',
      owner: 'acme/platform',
      githubUrl: 'https://gitlab.com/acme/platform/billing',
      repositoryIdentity: {
        provider: 'gitlab',
        instanceBaseUrl: 'https://gitlab.com',
        projectPath: 'acme/platform/billing',
      },
      lastUsedAt: '2026-09-14T10:00:00.000Z',
    },
    {
      path: '/Users/dev/code/intentd',
      type: 'local',
      name: 'intentd',
      owner: 'intent-hq',
      githubUrl: 'https://github.com/intent-hq/intentd',
      lastUsedAt: '2026-09-10T10:00:00.000Z',
    },
  ];
  /** Only the full load knows this older repo, whose name is exactly "cloud". */
  const loadedRepo: WorkspaceInitializerRecentRepo = {
    path: '/Users/dev/code/cloud',
    type: 'local',
    name: 'cloud',
    lastUsedAt: '2026-08-01T10:00:00.000Z',
  };

  /** Test hooks for the repo and late-result scenes (CT specs only). */
  export interface CommandPaletteFixture {
    /** Full repo loads started (the palette asks once per open). */
    repoLoads: () => number;
    /** Finish the running full repo load. */
    landRepos: () => void;
    /** Answer the held file-name searches with a file named exactly like the query. */
    releaseFiles: () => void;
  }

  /** Workspace owner with known repos; files wait for `releaseFiles` and the repo load for `landRepos`. */
  function setupRepos(role: 'owner' | 'guest' = 'owner') {
    const heldFiles: Array<(value: unknown) => void> = [];
    const stopSearch = setup(false, {
      // Five body hits from another workspace (never local rows) for "roadmap".
      'search.notes': (raw) => {
        const { query } = raw as { query: string };
        return {
          requestId: 'preview-palette-search',
          indexed: true,
          matches: query.toLowerCase().includes('roadmap')
            ? Array.from({ length: 5 }, (_, index) => ({
                noteId: `preview-roadmap-note-${index}`,
                workspaceId: 'preview-other-workspace',
                title: `Planning ${index + 1}`,
                preview: 'Quarterly roadmap',
                score: 1 - index / 10,
                updatedAt: timestamp,
                isArchived: false,
                workspaceArchived: false,
              }))
            : [],
        };
      },
      // Only a chat message matches "zebra".
      'search.messages': (raw) => {
        const { query } = raw as { query: string };
        return {
          matches: query.toLowerCase().includes('zebra')
            ? [
                {
                  agentId: 'preview-zebra-agent',
                  messageId: 'preview-zebra-message',
                  workspaceId,
                  agentName: 'Release agent',
                  snippet: 'The zebra build is green',
                },
              ]
            : [],
        };
      },
      // A file named exactly like the query, held until `releaseFiles`.
      'search.fileNames': (raw) =>
        new Promise((resolve) => {
          const { pattern } = raw as { pattern: string };
          heldFiles.push(() => resolve({ files: pattern ? [pattern] : [] }));
        }),
    });
    admitLegacyPrincipal(role);
    appStore.dispatch(
      setWorkspaceEntity({
        id: workspaceId,
        title: 'Command palette preview',
        repositoryName: 'intent',
        branch: 'preview/command-palette',
        status: WorkspaceStatus.Active,
        myRole: 'owner',
        changesets: [],
        timeline: [],
        conversationInfo: [],
        ...PREVIEW_FIXTURE_TIMESTAMPS,
      }),
    );
    appStore.dispatch(setWorkspaceInitializerRecentRepos(savedRepos));
    const { loads, stop: stopLoads } = trackKnownRepoLoads();
    const fixture: CommandPaletteFixture = {
      repoLoads: () => loads.length,
      landRepos: () => {
        const load = loads.at(-1);
        if (!load) throw new Error('no repo load is running');
        appStore.dispatch(
          workspaceInitializerRecentReposRefreshFinished(
            load.id,
            load.requestId,
            'ready',
            [...savedRepos, loadedRepo],
            [],
            [],
          ),
        );
      },
      releaseFiles: () => heldFiles.splice(0).forEach((release) => release(undefined)),
    };
    (
      window as unknown as { __commandPaletteFixture?: CommandPaletteFixture }
    ).__commandPaletteFixture = fixture;
    return () => {
      stopLoads();
      stopSearch();
      appStore.dispatch(setWorkspaceInitializerRecentRepos([]));
      appStore.dispatch(removeWorkspaceEntity(workspaceId));
    };
  }

  export const preview = definePreview<{ initialQuery: string; withoutWorkspace?: boolean }>({
    id: 'command-palette',
    title: 'Command palette',
    defaultState: 'grouped',
    states: {
      grouped: { props: { initialQuery: '' }, setup },
      owner: { props: { initialQuery: '' }, setup: setupOwner },
      'retired-workspaces': { props: { initialQuery: 'importer' }, setup: setupRetired },
      context: { props: { initialQuery: '#' }, setup },
      search: { props: { initialQuery: 'context' }, setup },
      empty: { props: { initialQuery: 'no-matching-context-xyz' }, setup },
      'empty-category': { props: { initialQuery: '@' }, setup },
      'long-names': { props: { initialQuery: '#' }, setup: () => setup(true) },
      'go-to-line': { props: { initialQuery: ':42' }, setup },
      'invalid-line': { props: { initialQuery: ':0' }, setup },
      'no-workspace': {
        props: { initialQuery: '', withoutWorkspace: true },
        setup: setupPaletteNoteSearch,
      },
      multiplayer: { props: { initialQuery: 'multiplayer' }, setup },
      'labs-e2b-off': {
        props: { initialQuery: 'E2B', withoutWorkspace: true },
        setup: () => setupCloudLab(false),
      },
      'labs-e2b-on': {
        props: { initialQuery: 'E2B', withoutWorkspace: true },
        setup: () => setupCloudLab(true),
      },
      blended: { props: { initialQuery: 'in' }, setup: () => setupRepos() },
      repos: { props: { initialQuery: 'cloudl' }, setup: () => setupRepos() },
      'repo-filter': { props: { initialQuery: '+' }, setup: () => setupRepos() },
      'repos-hidden': { props: { initialQuery: 'cloudl' }, setup: () => setupRepos('guest') },
      'provider-profiles': {
        props: { initialQuery: 'provider profiles', withoutWorkspace: true },
        setup: setupPaletteNoteSearch,
      },
    },
  });
</script>

<script lang="ts">
  import CommandPalette from './CommandPalette.svelte';
  import { Button } from '$lib/components/ui/button';
  import { selectShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  let {
    initialQuery = '',
    withoutWorkspace = false,
  }: { initialQuery?: string; withoutWorkspace?: boolean } = $props();
  let isOpen = $state(true);
  const showCreateModal$ = selectShowCreateModal();
</script>

<div
  class="min-h-[700px]"
  data-command-palette-preview
  data-new-workspace-open={$showCreateModal$ ? 'true' : 'false'}
>
  <Button onclick={() => (isOpen = true)}>Open palette</Button>
  <CommandPalette
    bind:isOpen
    workspaceId={withoutWorkspace ? undefined : workspaceId}
    {initialQuery}
    onClose={() => (isOpen = false)}
  />
</div>
