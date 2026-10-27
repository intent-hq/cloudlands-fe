import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { AnnotationDeliveryError, formatAnnotationTime } from './annotation-types';
import type { AnnotationDestination } from '$shared/annotation';
import { appClient } from '$lib/client';
import { isDaemonErrorResponse } from '$lib/client/live/backend-transport-types';
import { backendRequest } from '$lib/client/live/backend-transport';
import { agentFactory } from '$features/agent/services/agent-factory';
import {
  toImageReferenceBlocks,
  imageRetryBlocks,
  type WireImageBlock,
} from '$lib/components/chat/input/image-attachment-placement';
import { resolveCanonicalInitialAgent } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
import { classifyAgentScope } from '$shared/utils/agent-scope';
import { WorkspaceStatus } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { createAgentTypeId } from '$shared/types/agent.types';
import {
  buildChiefBehaviorPrompt,
  CHIEF_PROMPT_VERSION,
  CHIEF_SPECIALIST_ID,
} from '$shared/chief-agent-config';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';
import { createChiefVirtualWorkspace } from '$store/renderer/slices/workspace-agents/chief-virtual-workspace';
import { selectContextSelectedModel } from '$store/renderer/slices/provider-catalog/workspace-catalog-selectors';
import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { selectEffectiveBehaviorPrompt } from '$store/renderer/slices/specialists/specialists-selectors';
import {
  annotationCreatedRecipient,
  annotationDeliveryPrepared,
  annotationDeliveryUncertain,
  annotationSubmissionRemembered,
} from '$store/renderer/slices/annotation/annotation-slice';
import {
  NEW_ASSISTANT_RECIPIENT,
  type AnnotationRecipient,
  type AnnotationSubmission,
  type AnnotationWorkspace,
} from './annotation-types';

export async function loadAnnotationWorkspaces(): Promise<AnnotationWorkspace[]> {
  const workspaces = await appClient.workspaces.list();
  return [
    { id: CHIEF_WORKSPACE_ID, title: m.annotation_assistantThreads_label() },
    ...workspaces
      .filter(
        (workspace) =>
          workspace.id !== CHIEF_WORKSPACE_ID &&
          workspace.status !== WorkspaceStatus.Archived &&
          workspace.status !== WorkspaceStatus.Deleted &&
          !workspace.archived &&
          !workspace.archivedAt &&
          !workspace.pendingDeleteAt,
      )
      .map((workspace) => ({
        id: String(workspace.id),
        title: workspace.title || workspace.name || String(workspace.id),
      }))
      .sort((left, right) => left.title.localeCompare(right.title)),
  ];
}

export async function loadAnnotationRecipients(
  workspaceId: string,
): Promise<AnnotationRecipient[]> {
  const scopes =
    workspaceId === CHIEF_WORKSPACE_ID
      ? (['topLevel'] as const)
      : (['topLevel', 'delegated', 'background'] as const);
  const rows = (
    await Promise.all(scopes.map((scope) => appClient.agents.list(workspaceId, { scope })))
  ).flat();
  // Older daemons can ignore scope; deduplicate before presenting overrides.
  const agents = [
    ...new Map(
      rows
        .filter(
          (agent) =>
            String(agent.workspaceId) === workspaceId &&
            !agent.retiredAt &&
            agent.status !== 'deleted' &&
            !agent.pendingDeleteAt,
        )
        .map((agent) => [agent.id, agent]),
    ).values(),
  ];
  // The shared resolver's legacy fallbacks are useful for opening a workspace,
  // but sending feedback requires an authoritative marker, never an arbitrary row.
  const mainAgent = resolveCanonicalInitialAgent(
    agents.filter(
      (agent) =>
        classifyAgentScope(agent) === 'topLevel' &&
        !agent.parentSessionId &&
        (agent.isInitialAgent === true ||
          agent.metadata?.isInitialAgent === true ||
          agent.agentMetadata?.isInitialAgent === true),
    ),
  );
  const recipients = agents.map((agent): AnnotationRecipient => ({
    id: `${workspaceId}:${agent.id}`,
    agentId: agent.id,
    workspaceId,
    name: agent.name || agent.id,
    kind: workspaceId === CHIEF_WORKSPACE_ID ? 'assistant' : 'workspace',
    isDefault: workspaceId !== CHIEF_WORKSPACE_ID && agent.id === mainAgent?.id,
  }));
  return workspaceId === CHIEF_WORKSPACE_ID
    ? [
        {
          id: NEW_ASSISTANT_RECIPIENT,
          agentId: null,
          workspaceId: CHIEF_WORKSPACE_ID,
          name: m.annotation_newAssistant_label(),
          kind: 'assistant',
          isDefault: true,
        },
        ...recipients,
      ]
    : recipients;
}

export async function resolveAnnotationRecipient(
  destination: AnnotationDestination,
  requestId?: string,
): Promise<AnnotationRecipient> {
  const previous = appStore.state.annotation.submission;
  if (requestId && previous?.messageId === requestId) return previous.recipient;
  if (destination.agentId === null) {
    const recipients = await loadAnnotationRecipients(destination.workspaceId);
    const main = recipients.find((recipient) => recipient.isDefault);
    if (!main) throw new AnnotationDeliveryError(false, 'annotation-no-agent');
    return main;
  }
  const agent = await appClient.agents.get(destination.agentId, destination.workspaceId);
  if (
    !agent ||
    agent.retiredAt ||
    agent.pendingDeleteAt ||
    agent.status === 'deleted' ||
    String(agent.workspaceId) !== destination.workspaceId
  )
    throw new AnnotationDeliveryError(false, 'annotation-no-agent');
  return {
    id: `${destination.workspaceId}:${agent.id}`,
    agentId: agent.id,
    workspaceId: destination.workspaceId,
    name: agent.name || agent.id,
    kind: destination.workspaceId === CHIEF_WORKSPACE_ID ? 'assistant' : 'workspace',
  };
}

export async function submitAnnotation(submission: AnnotationSubmission): Promise<void> {
  const deliveryState = appStore.state.annotation;
  const saved = deliveryState.submission;
  if (saved?.messageId === submission.messageId) {
    if (deliveryState.deliverySucceeded) return;
    submission = { ...saved, frames: getItems(saved.frames) };
  } else {
    if (deliveryState.uncertainMessageId)
      throw new AnnotationDeliveryError(true, 'annotation-delivery-unconfirmed');
    appStore.dispatch(annotationSubmissionRemembered(submission));
  }
  let recipient = submission.recipient;
  if (recipient.id === NEW_ASSISTANT_RECIPIENT) {
    const remembered = appStore.state.annotation.createdRecipient;
    if (remembered) recipient = remembered;
    else {
      const state = appStore.state;
      const behaviorPrompt = buildChiefBehaviorPrompt(
        selectEffectiveBehaviorPrompt.select(state, CHIEF_SPECIALIST_ID),
      );
      const created = await agentFactory.createAgent(
        createChiefVirtualWorkspace(),
        {
          workspaceId: CHIEF_WORKSPACE_ID,
          name: m.annotation_feedback_heading(),
          nameExplicitlySet: false,
          provider: selectEffectiveDefaultProviderId.select(state, CHIEF_WORKSPACE_ID),
          model: selectContextSelectedModel.select(state, CHIEF_WORKSPACE_ID),
          agentType: createAgentTypeId('workspace'),
          source: 'annotation',
          behaviorPrompt,
          metadata: {
            source: 'annotation',
            chiefWorkspace: true,
            chiefPromptVersion: CHIEF_PROMPT_VERSION,
            specialist: CHIEF_SPECIALIST_ID,
            behaviorPrompt,
          },
        },
        submission.messageId,
      );
      const agentId = created.agent?.id ?? created.agentId;
      if (!created.success || !agentId)
        throw new AnnotationDeliveryError(
          !!created.cause && !isDaemonErrorResponse(created.cause),
          created.error ?? 'annotation-no-agent',
        );
      recipient = { ...recipient, id: `${CHIEF_WORKSPACE_ID}:${agentId}`, agentId };
      appStore.dispatch(annotationCreatedRecipient(recipient));
      appStore.dispatch(annotationSubmissionRemembered({ ...submission, recipient }));
    }
  }
  if (!recipient.agentId) throw new AnnotationDeliveryError(false, 'annotation-no-agent');
  const target = await appClient.agents.get(recipient.agentId, recipient.workspaceId);
  if (
    !target ||
    target.retiredAt ||
    target.pendingDeleteAt ||
    target.status === 'deleted' ||
    target.workspaceId !== recipient.workspaceId
  )
    throw new AnnotationDeliveryError(false, 'annotation-no-agent');
  if (appStore.state.annotation.uncertainMessageId === submission.messageId) {
    try {
      const [queue, history] = await Promise.all([
        appClient.agents.getQueue(recipient.agentId, recipient.workspaceId),
        appClient.agents.getConversation(
          recipient.agentId,
          200,
          undefined,
          undefined,
          undefined,
          recipient.workspaceId,
        ),
      ]);
      if (
        queue.some(
          (row) =>
            row.id === submission.messageId || row.submissionIds?.includes(submission.messageId),
        ) ||
        history.messages.some(
          (row) =>
            row.id === submission.messageId ||
            row.metadata?.submissionIds?.includes(submission.messageId),
        )
      )
        return;
    } catch {
      throw new AnnotationDeliveryError(true, 'annotation-delivery-unconfirmed');
    }
  }
  if (recipient.workspaceId !== CHIEF_WORKSPACE_ID) {
    const workspace = await appClient.workspaces.get(recipient.workspaceId);
    if (
      !workspace ||
      workspace.status === WorkspaceStatus.Archived ||
      workspace.status === WorkspaceStatus.Deleted ||
      workspace.archived ||
      workspace.archivedAt ||
      workspace.pendingDeleteAt
    )
      throw new AnnotationDeliveryError(false, 'annotation-no-agent');
  }
  const previous = appStore.state.annotation.preparedDelivery;
  let blocks: WireImageBlock[] =
    previous?.messageId === submission.messageId && previous.workspaceId === recipient.workspaceId
      ? getItems(previous.blocks).map(({ block }) => block)
      : submission.frames.map((frame) => ({
          type: 'image',
          mimeType: 'image/png',
          data: frame.imageDataUrl.replace(/^data:image\/png;base64,/, ''),
        }));
  if (
    blocks.reduce((bytes, block) => bytes + ('data' in block ? block.data.length * 0.75 : 0), 0) >
    30 * 1024 * 1024
  )
    throw new AnnotationDeliveryError(false, 'annotation-images-too-large');
  if (recipient.workspaceId !== CHIEF_WORKSPACE_ID) {
    try {
      blocks = await toImageReferenceBlocks(recipient.workspaceId, blocks);
    } catch (error) {
      appStore.dispatch(
        annotationDeliveryPrepared(
          submission.messageId,
          imageRetryBlocks(error, blocks),
          recipient.workspaceId,
        ),
      );
      throw new AnnotationDeliveryError(false, 'annotation-upload-failed');
    }
  }
  appStore.dispatch(
    annotationDeliveryPrepared(submission.messageId, blocks, recipient.workspaceId),
  );
  const timeline = submission.frames
    .map((frame, index) => {
      const pins = frame.pins
        .map(
          (pin) =>
            `${m.annotation_pin_label()} ${pin.number} · ${formatAnnotationTime(pin.elapsedMs)}`,
        )
        .join(', ');
      return `${m.annotation_capture_label({ number: String(index + 1), time: formatAnnotationTime(frame.elapsedMs) })}${pins ? ` (${pins})` : ''}`;
    })
    .join('\n');
  const content = `${m.annotation_feedback_heading()} — ${submission.sourceWorkspaceTitle}\nintent://local/workspace/${encodeURIComponent(submission.sourceWorkspaceId)}\n\n${submission.message.trim()}\n\n${timeline}`;
  let result: { success: boolean; error?: string };
  try {
    result = await backendRequest('agent.sendMessage', {
      agentId: recipient.agentId,
      workspaceId: recipient.workspaceId,
      messageId: submission.messageId,
      content,
      imageBlocks: blocks,
      messageMetadata: {
        type: 'screen_feedback',
        sourceWorkspaceId: submission.sourceWorkspaceId,
        captures: submission.frames.map(({ id, elapsedMs, pins }) => ({ id, elapsedMs, pins })),
      },
    });
  } catch (error) {
    const uncertain = !isDaemonErrorResponse(error);
    if (uncertain) appStore.dispatch(annotationDeliveryUncertain(submission.messageId));
    throw new AnnotationDeliveryError(uncertain, 'annotation-send-failed');
  }
  if (result?.success !== true)
    throw new AnnotationDeliveryError(false, result?.error ?? 'annotation-send-failed');
}
