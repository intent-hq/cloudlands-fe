import { appClient } from '$lib/client';
import { deserializeDraftAttachments } from '$lib/components/chat/chat-draft-attachments';
import type { ControllerState, DraftInput } from '../controller';
import { createInitialControllerState } from '../controller';
import { createDraftTransactionRunner, type DraftTransactionRunner } from '../effects';
import { resolveStart, type ResolveStartInput } from '../resolver';

const SENTINEL_WORKSPACE_ID = '__new-workspace__';
const SENTINEL_AGENT_ID = '__initializer__';

export interface NewWorkspaceRouteController {
  start(listener: (state: ControllerState) => void): Promise<void>;
  edit(patch: Partial<DraftInput>): void;
  dispatch: DraftTransactionRunner['dispatch'];
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
      runner = createDraftTransactionRunner({ client: appClient, requestedDraftId });
      runner.subscribe((state) => {
        listener(state);
      });
      runner.start(createInitialControllerState(1, initialInput(options.startInput)));
    },
    edit(patch) {
      runner?.dispatch({ type: 'user.edited', patch });
    },
    dispatch(event) {
      runner?.dispatch(event);
    },
    stop() {
      runner?.stop();
      runner = null;
    },
  };
}
