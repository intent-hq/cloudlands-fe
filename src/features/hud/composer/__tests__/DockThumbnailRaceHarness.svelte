<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { store } from '$store/renderer/store';
  import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
  import { getPrincipalActionContext } from '$store/renderer/slices/principal/principal-context';
  import {
    dockConversationContextSet,
    dockConversationLoaded,
    openDockConversationRequested,
  } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
  import { selectDockComposerEvidence } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import { defaultDockMediaEdit, type DockMediaSource } from '$shared/dock-media-edit';
  import type { ContextItem } from '$lib/components/chat/input/context-api';
  import {
    createDockComposerController,
    type DockComposerController,
  } from '../dock-composer-controller';

  let { scenario }: { scenario: string } = $props();
  let status = $state('ready');
  let shown = $state<Record<string, string>>({});
  let receipt = $state<Record<string, unknown>>({});
  let controller: DockComposerController | undefined;
  let unsubscribe: (() => void) | undefined;
  type View = Parameters<DockComposerController['refreshPreviews']>[0];
  type Job = {
    revision: number | null;
    resolve: (url: string) => void;
    reject: (error: Error) => void;
  };
  const jobs: Job[] = [];
  const revoked: string[] = [];
  const labels = new Map<string, string>();
  const steps: { step: string; displayed: Record<string, string>; revoked: string[] }[] = [];
  onDestroy(() => {
    controller?.dispose();
    unsubscribe?.();
  });
  function check(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
  }
  function snapshot(step: string) {
    steps.push({
      step,
      displayed: Object.fromEntries(
        Object.entries(shown).map(([id, url]) => [id, labels.get(url) ?? url]),
      ),
      revoked: revoked.map((url) => labels.get(url) ?? url),
    });
  }
  async function image(label: string): Promise<string> {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 100;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = label.startsWith('raw') ? '#8f302c' : '#235d6c';
    ctx.fillRect(0, 0, 240, 100);
    ctx.fillStyle = '#fff';
    ctx.font = '18px sans-serif';
    ctx.fillText(label, 12, 55);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!)));
    const url = URL.createObjectURL(blob);
    labels.set(url, label);
    return url;
  }
  function pending(revision: number | null): Promise<string> {
    return new Promise((resolve, reject) => jobs.push({ revision, resolve, reject }));
  }
  async function run() {
    status = 'running';
    try {
      admitLegacyPrincipal();
      const workspaceId = 'thumbnail-proof',
        agentId = 'thumbnail-proof-agent';
      store.dispatch(openDockConversationRequested(workspaceId));
      const authority = getPrincipalActionContext(store.state)!;
      store.dispatch(dockConversationContextSet('thumbnail-proof', authority));
      store.dispatch(
        dockConversationLoaded(
          store.state.dockConversation.generation,
          workspaceId,
          'Synthetic thumbnail proof',
          [{ id: agentId, name: 'Fixture', isMain: true }],
          agentId,
        ),
      );
      controller = createDockComposerController(
        { workspaceId, agentId, authority },
        {
          createPreviewUrl: () => pending(null),
          createSavedPreviewUrl: (_workspace, media) => pending(media.saved.revision),
          revokeUrl: (url) => {
            revoked.push(url);
            URL.revokeObjectURL(url);
          },
        },
      );
      unsubscribe = controller.local.subscribe((state) => {
        shown = { ...state.previews };
      });
      const source: DockMediaSource = {
        id: 'source',
        revision: 0,
        kind: 'screenshot',
        attachmentId: 'source-file',
        path: '.intent/attachments/source.png',
        durationMs: 0,
        width: 240,
        height: 100,
        audio: 'none',
        batches: [],
        visuals: 'clean',
      };
      const items: ContextItem[] = [
        {
          id: 'pixels',
          type: 'file',
          label: 'Synthetic pixels',
          imageData: 'fixture',
          imageMimeType: 'image/png',
        },
      ];
      const view = (revision: number | null, id = 'image', sourceRevision = 0): View => {
        const currentSource = { ...source, revision: sourceRevision };
        return {
          ...selectDockComposerEvidence.select(store.state, workspaceId, agentId),
          tiles: [
            {
              image: {
                id,
                contextItemId: 'pixels',
                width: 240,
                height: 100,
                displayScale: 1,
                capturedAt: '2026-01-01T00:00:00Z',
                source: 'capture',
                media: {
                  source: currentSource,
                  saved:
                    revision === null
                      ? null
                      : { ...defaultDockMediaEdit(currentSource, [], null), revision },
                  transcript: null,
                },
              },
              marks: [],
            },
          ],
        };
      };
      const start = (revision: number | null, id = 'image', sourceRevision = 0) => {
        const done = controller!.refreshPreviews(view(revision, id, sourceRevision), items);
        return { done, job: jobs.at(-1)! };
      };
      const succeed = async (request: ReturnType<typeof start>, label: string) => {
        const url = await image(label);
        request.job.resolve(url);
        await request.done;
        snapshot(label);
        return url;
      };
      const fail = async (request: ReturnType<typeof start>, label: string) => {
        request.job.reject(new Error('Synthetic render failure'));
        await request.done;
        snapshot(label);
      };
      if (scenario === 'concurrent failures' || scenario === 'first saved failure') {
        const raw = await succeed(start(null), 'raw');
        const a = start(1);
        if (scenario === 'concurrent failures') {
          const b = start(2);
          await fail(b, 'saved B failed');
          await fail(a, 'saved A failed late');
        } else await fail(a, 'first saved failed');
        check(!shown.image, 'Raw thumbnail survived saved failure');
        check(revoked.includes(raw), 'Raw thumbnail URL was not revoked');
      } else if (scenario === 'retain successful saved') {
        const prior = await succeed(start(1), 'saved 1');
        const a = start(2),
          b = start(3);
        await fail(b, 'saved 3 failed');
        await fail(a, 'saved 2 failed late');
        check(
          shown.image === prior && !revoked.includes(prior),
          'Prior displayed saved preview was lost',
        );
      } else if (scenario === 'superseded success') {
        const a = start(1),
          b = start(2);
        const latest = await succeed(b, 'saved 2');
        const stale = await succeed(a, 'saved 1 late');
        check(shown.image === latest, 'Superseded success replaced current preview');
        check(revoked.includes(stale) && !revoked.includes(latest), 'Stale URL ownership is wrong');
      } else if (scenario === 'stale raw failure') {
        const raw = start(null),
          saved = start(1);
        await fail(raw, 'raw failed late');
        const latest = await succeed(saved, 'saved 1');
        check(shown.image === latest, 'Stale raw failure cleared saved request');
      } else if (scenario === 'cancel ignores unsaved marks') {
        const prior = await succeed(start(1), 'saved 1');
        const count = jobs.length;
        const cancelled = view(1);
        cancelled.tiles[0].marks = [
          {
            n: 1,
            mark: {
              id: 'unsaved',
              imageId: 'image',
              tool: 'box',
              geometry: { kind: 'rect', x: 10, y: 10, w: 20, h: 20 },
              bounds: { x: 10, y: 10, w: 20, h: 20 },
              element: null,
              createdAt: 1,
            },
          },
        ];
        await controller.refreshPreviews(cancelled, items);
        snapshot('cancel unsaved marks');
        check(jobs.length === count && shown.image === prior, 'Cancel rendered unsaved state');
      } else if (scenario === 'removed attachment and newer view') {
        const a = start(1, 'old'),
          b = start(2, 'new');
        const latest = await succeed(b, 'new saved 2');
        const stale = await succeed(a, 'old saved 1 late');
        check(shown.new === latest && !shown.old, 'Old refresh swept or resurrected attachment');
        check(revoked.includes(stale), 'Removed attachment result was not revoked');
      } else if (scenario === 'dispose fences work') {
        const a = start(1);
        controller.dispose();
        const stale = await succeed(a, 'disposed saved');
        check(!shown.image && revoked.includes(stale), 'Disposed controller accepted work');
      } else if (scenario === 'retired authority fences failure') {
        const raw = await succeed(start(null), 'raw');
        const a = start(1);
        store.dispatch(dockConversationContextSet('different-backend', 'retired'));
        await fail(a, 'retired failure');
        check(
          shown.image === raw && !revoked.includes(raw),
          'Retired failure mutated displayed state',
        );
        controller.dispose();
        check(revoked.includes(raw), 'Dispose did not release retired preview');
      } else throw new Error('Unknown scenario');
      receipt = { scenario, result: 'passed', jobs: jobs.map(({ revision }) => revision), steps };
      status = 'passed';
    } catch (error) {
      status = 'failed';
      receipt = { scenario, error: String(error), steps };
    }
  }
</script>

<div data-testid="thumbnail-proof" data-status={status} data-receipt={JSON.stringify(receipt)}>
  <h2>{scenario}</h2>
  <Button onclick={run} disabled={status !== 'ready'}>Run synthetic thumbnail case</Button>
  <p role="status">{status}</p>
  {#each Object.entries(shown) as [id, url] (id)}<img
      src={url}
      alt={`Displayed ${id} thumbnail`}
      width="240"
      height="100"
    />{/each}
  {#if Object.keys(shown).length === 0}<p>No thumbnail displayed.</p>{/if}
  <pre>{JSON.stringify(receipt, null, 2)}</pre>
</div>
