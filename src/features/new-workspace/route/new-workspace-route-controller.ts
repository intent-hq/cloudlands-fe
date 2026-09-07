/**
 * Owns the route-scoped draft controller and transaction runner.
 *
 * Startup restores or creates one daemon draft; stopping releases all route-owned effects.
 */
import { appClient } from '$lib/client';
import { deserializeDraftAttachments } from '$lib/components/chat/chat-draft-attachments';
import type { ControllerState, DraftInput } from '../controller';
import { createInitialControllerState } from '../controller';
import { createDraftTransactionRunner, type DraftTransactionRunner } from '../effects';
import { resolveStart, type ResolveStartInput } from '../resolver';

const SENTINEL_WORKSPACE_ID = '__new-workspace__';
const SENTINEL_AGENT_ID = '__initializer__';

interface NewWorkspaceRouteController {
  start(listener: (state: ControllerState) => void): Promise<void>;
  edit(patch: Partial<DraftInput>): void;
  dispatch: DraftTransactionRunner['dispatch'];
  setDaemonConnected(connected: boolean): void;
  flush(): void;
  stop(): void;
}

async function migrateSentinelDraft(): Promise<string | null> {
  const legacy = await appClient.drafts.get(SENTINEL_WORKSPACE_ID, SENTINEL_AGENT_ID);
  if (!legacy) return null;
  const draft = await appClient.workspaceDrafts.create({
    intentText: legacy.text ?? '',
    attachments: legacy.attachments?.length ? deserializeDraftAttachments(legacy.attachments) : [],
  });
  await appClient.drafts.clear(SENTINEL_WORKSPACE_ID, SENTINEL_AGENT_ID);
  return draft.id;
}

function initialInput(start: ResolveStartInput): DraftInput {
  const resolved = resolveStart(start);
  return {
    ...(resolved.title ? { title: resolved.title } : {}),
    intentText: resolved.intentText,
    source: resolved.source ?? null,
    contextLinks: resolved.contextLinks,
    attachments: [],
    config: {},
  };
}

export function createNewWorkspaceRouteController(options: {
  startInput: ResolveStartInput;
  requestedDraftId?: string | null;
}): NewWorkspaceRouteController {
  let runner: DraftTransactionRunner | null = null;
  let stopped = false;
  let daemonConnected: boolean | undefined;
  const applyDaemonConnection = () => {
    if (!runner || daemonConnected === undefined) return;
    runner.dispatch({ type: daemonConnected ? 'reconnect' : 'daemon.offline' });
  };
  return {
    async start(listener) {
      let requestedDraftId = options.requestedDraftId;
      if (requestedDraftId === undefined) {
        try {
          requestedDraftId = (await migrateSentinelDraft()) ?? undefined;
        } catch {
          requestedDraftId = undefined;
        }
      }
      if (stopped) return;
      runner = createDraftTransactionRunner({ client: appClient, requestedDraftId });
      runner.subscribe((state) => {
        listener(state);
      });
      runner.start(createInitialControllerState(1, initialInput(options.startInput)));
      applyDaemonConnection();
    },
    edit(patch) {
      runner?.dispatch({ type: 'user.edited', patch });
    },
    dispatch(event) {
      runner?.dispatch(event);
    },
    setDaemonConnected(connected) {
      if (daemonConnected === connected) return;
      daemonConnected = connected;
      applyDaemonConnection();
    },
    flush() {
      runner?.flush();
    },
    stop() {
      stopped = true;
      runner?.stop();
      runner = null;
    },
  };
}
