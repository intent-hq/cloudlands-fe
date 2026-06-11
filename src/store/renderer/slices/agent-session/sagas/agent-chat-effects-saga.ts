import {
  call,
  delay,
  put,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import { sendMessage as sendAgentMessage } from '$features/agent/agent-stream-lifecycle';
import { resizeImageForAgent } from '$lib/utils/image-resize';
import { createLogger } from '$lib/utils/client-logger';
import type { AgentMessage, AgentSession, Workspace, WorkspaceId } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { CHIEF_WORKSPACE_ID, WorkspaceId as createWorkspaceId } from '$shared/types/branded-ids';
import { createChiefVirtualWorkspace } from '../../workspace-agents/chief-virtual-workspace';
import { cleanErrorMessage } from '$shared/errors/messages';
import { parseCompoundModelId } from '$shared/config/provider-config';
import { unifiedIdService } from '$shared/services/unified-id.service';
import {
  activateAgentRequested,
  createAgentFromConfigRequested,
  forkAgentRequested,
  saveAgentSessionRequested,
  stopAgentSessionRequested,
} from '../../workspace-agents/workspace-agents-slice';
import { selectWorkspaceDefaultModel } from '../../model/model-selectors';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import {
  chatErrorCleared,
  chatInterrupted,
  chatModelUnavailableCleared,
  chatSendFailed,
  chatSendStarted,
  chatStopCompleted,
  chatStopInitiated,
} from '../../chat-state/chat-state-slice';
import {
  selectChatIsInterrupting,
  selectChatLastAttemptedMessage,
} from '../../chat-state/chat-state-selectors';
import {
  selectAgentActivationWaitComplete,
  selectAgentIsResponding,
  selectAgentMessages,
  selectAgentSession,
  selectAgentSessionExists,
  selectAgentSessionIsProcessing,
  selectAgentSessionIsStreaming,
  selectAgentSessionWorkspaceId,
} from '../agent-session-selectors';
import {
  agentSessionEditAndRegenerateRequested,
  agentSessionForkSessionRequested,
  agentSessionLaunchAgentRequested,
  agentSessionRegenerateFromMessageRequested,
  agentSessionRetryLastMessageRequested,
  agentSessionRetryWithModelRequested,
  agentSessionSendMessageRequested,
  agentSessionStopChatRequested,
  replaceMessages,
  updateMessage,
} from '../agent-session-slice';
import type {
  AgentSessionContextReference,
  AgentSessionForkOptions,
  AgentSessionLaunchConfig,
  AgentSessionSendContextItem,
  AgentSessionSendMessageOptions,
} from '../agent-session-types';
import { waitFor } from 'ag-redux-toolkit/saga';
import type { StoreSelector as PackageStoreSelector } from 'ag-redux-toolkit/types';

const logger = createLogger('AgentChatEffectsSaga');
type WaitForSelector<R, ARGS extends any[]> = PackageStoreSelector<R, ARGS, unknown>;
const MAX_MESSAGE_LENGTH = 500000;
const INTERRUPT_MAX_WAIT_MS = 500;
const STOP_CLEANUP_WAIT_MS = 300;
const ACTIVATION_WAIT_TIMEOUT_MS = 60_000;

type ImageBlock = { type: 'image'; data: string; mimeType: string };
type FileBlock = { type: 'file'; data: string; mimeType: string; fileName: string };

type MessageContentBlock = NonNullable<AgentMessage['contentBlocks']>[number];
type RetryRequestAction =
  | ReturnType<typeof agentSessionRetryLastMessageRequested>
  | ReturnType<typeof agentSessionRetryWithModelRequested>;

interface RetryRequestConfig {
  failureMessage: string;
  clearModelUnavailable?: boolean;
  historyOptions?: AgentSessionSendMessageOptions;
  buildLastAttemptOptions?: (
    options: AgentSessionSendMessageOptions | undefined,
  ) => AgentSessionSendMessageOptions | undefined;
  logLastAttempt: (agentId: string, text: string) => void;
}

function getErrorMessage(error: unknown, fallback = 'Failed to send message'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
}

function isMessageGuardError(error: unknown): boolean {
  return error instanceof Error && error.name === 'MessageGuardError';
}

function showErrorToast(message: string): void {
  import('svelte-sonner').then(({ toast }) => {
    toast.error(message);
  });
}

function getBlockText(block: MessageContentBlock): string {
  if (block.type !== 'text') return '';
  const text = (block as { text?: unknown }).text;
  return typeof text === 'string' ? text : '';
}

function extractUserMessageText(message: AgentMessage): string {
  return (message.contentBlocks ?? []).map(getBlockText).join('');
}

function extractMediaContextItems(message: AgentMessage, prefix: string): AgentSessionSendContextItem[] {
  const mediaContextItems: AgentSessionSendContextItem[] = [];
  for (const block of message.contentBlocks ?? []) {
    if (block.type === 'image') {
      const imageBlock = block as { data?: unknown; mimeType?: unknown };
      if (typeof imageBlock.data === 'string' && typeof imageBlock.mimeType === 'string') {
        mediaContextItems.push({
          id: `${prefix}-image-${mediaContextItems.length}`,
          type: 'file',
          label: `Image ${mediaContextItems.length + 1}`,
          imageData: imageBlock.data,
          imageMimeType: imageBlock.mimeType,
        });
      }
    } else if (block.type === 'file') {
      const fileBlock = block as { data?: unknown; mimeType?: unknown; fileName?: unknown };
      if (typeof fileBlock.data === 'string' && typeof fileBlock.mimeType === 'string') {
        mediaContextItems.push({
          id: `${prefix}-file-${mediaContextItems.length}`,
          type: 'file',
          label: typeof fileBlock.fileName === 'string' ? fileBlock.fileName : 'file',
          fileData: fileBlock.data,
          fileMimeType: fileBlock.mimeType,
        });
      }
    }
  }
  return mediaContextItems;
}

function attachPromiseRejectionLogger(
  promise: Promise<unknown>,
  message: string,
  meta: Record<string, unknown>,
): void {
  promise.catch((err: unknown) => {
    logger.warn(message, {
      ...meta,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

function makeForkName(sourceSession: AgentSession, options: AgentSessionForkOptions | undefined): string {
  if (options?.name) return options.name;
  const baseName = sourceSession.name || 'Chat';
  return `${baseName} (Fork ${new Date().toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })})`;
}

function fileToBase64(file: File): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve({ data: result.split(',')[1] || result, mimeType: file.type || 'image/png' });
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

function hasMediaAttachment(options: AgentSessionSendMessageOptions | undefined): boolean {
  return options?.contextItems?.some(
    (item) =>
      (item.imageData && item.imageMimeType) || (item.fileData && item.fileMimeType) || item.file,
  ) === true;
}

function isTaskBreakdownLaunchConfig(config: AgentSessionLaunchConfig): boolean {
  return config.agentType === 'task-breakdown' || config.metadata?.agentType === 'task-breakdown';
}

function toContextReference(item: AgentSessionSendContextItem): AgentSessionContextReference {
  return {
    type: item.type,
    path: item.path,
    content: item.content,
  };
}

function* waitForInterruptToFinish(agentId: string): SagaGenerator<void> {
  yield* waitFor(
    selectChatIsInterrupting as unknown as WaitForSelector<boolean, [string]>,
    [agentId] as [string],
    (val: boolean) => val === false,
    INTERRUPT_MAX_WAIT_MS,
  );
}

export function* resolveSendWorkspace(wsId: string, sessionWorkspaceId: string): SagaGenerator<Workspace> {
  if (wsId === CHIEF_WORKSPACE_ID || sessionWorkspaceId === CHIEF_WORKSPACE_ID) {
    return createChiefVirtualWorkspace();
  }

  const requestedWorkspace = yield* selectWorkspaceById.effect(wsId);
  if (sessionWorkspaceId === wsId && requestedWorkspace) return requestedWorkspace;

  const sessionWorkspace = yield* selectWorkspaceById.effect(sessionWorkspaceId);
  if (sessionWorkspace) return sessionWorkspace;
  if (requestedWorkspace) return { ...requestedWorkspace, id: sessionWorkspaceId as WorkspaceId };
  throw new Error('Workspace not found. Please try again.');
}

function sessionNeedsActivation(session: AgentSession): boolean {
  return session.status === AgentStatus.Pending || !session.backendSessionId;
}

function* activateIfNeeded(agentId: string, wsId: string): SagaGenerator<void> {
  const session = yield* selectAgentSession.effect(agentId);
  if (!session) throw new Error('No active chat session');
  const sessionWorkspaceId = (session.workspaceId ?? wsId) as string;

  if (!sessionNeedsActivation(session)) return;

  logger.info('Agent is pending, activating on first message', { agentId, status: session.status });
  yield* put(activateAgentRequested(sessionWorkspaceId, agentId));

  const activated = yield* waitFor(
    selectAgentActivationWaitComplete as WaitForSelector<boolean, [string]>,
    [agentId],
    (complete: boolean) => complete,
    ACTIVATION_WAIT_TIMEOUT_MS,
  );
  if (!activated) throw new Error('Timed out waiting for agent activation');

  const activatedSession = yield* selectAgentSession.effect(agentId);
  if (!activatedSession || sessionNeedsActivation(activatedSession)) {
    throw new Error(activatedSession?.lastActivationError || 'Failed to activate agent');
  }
}

function* buildBackendBlocks(
  contextItems: AgentSessionSendContextItem[] = [],
): SagaGenerator<{ imageBlocks: ImageBlock[]; fileBlocks: FileBlock[] }> {
  const imageBlocks: ImageBlock[] = [];
  const fileBlocks: FileBlock[] = [];

  for (const item of contextItems) {
    if (item.file && isImageFile(item.file)) {
      try {
        const { data, mimeType } = yield* call(fileToBase64, item.file);
        const resized = yield* call(resizeImageForAgent, data, mimeType);
        imageBlocks.push({ type: 'image', data: resized.base64, mimeType: resized.mimeType });
      } catch (error) {
        logger.error('Failed to convert image to base64', error, { fileName: item.label });
      }
    } else if (item.file) {
      try {
        const { data, mimeType } = yield* call(fileToBase64, item.file);
        fileBlocks.push({ type: 'file', data, mimeType, fileName: item.label || item.file.name });
      } catch (error) {
        logger.error('Failed to convert file to base64', error, { fileName: item.label });
      }
    } else if (item.imageData && item.imageMimeType) {
      try {
        const resized = yield* call(resizeImageForAgent, item.imageData, item.imageMimeType);
        imageBlocks.push({ type: 'image', data: resized.base64, mimeType: resized.mimeType });
      } catch (error) {
        logger.warn('Failed to resize base64 image, using original', { fileName: item.label, error });
        imageBlocks.push({ type: 'image', data: item.imageData, mimeType: item.imageMimeType });
      }
    } else if (item.fileData && item.fileMimeType) {
      fileBlocks.push({
        type: 'file',
        data: item.fileData,
        mimeType: item.fileMimeType,
        fileName: item.label || 'file',
      });
    }
  }

  return { imageBlocks, fileBlocks };
}

function* persistTruncatedMessages(
  wsId: string,
  agentId: string,
  warningMessage: string,
): SagaGenerator<void> {
  const saveAction = saveAgentSessionRequested(wsId, agentId, false, { allowTruncation: true });
  yield* put(saveAction);
  yield* call(attachPromiseRejectionLogger, saveAction.promise, warningMessage, { agentId });
}

function* stopIfResponding(agentId: string): SagaGenerator<void> {
  const isStreaming = yield* selectAgentSessionIsStreaming.effect(agentId);
  const isProcessing = yield* selectAgentSessionIsProcessing.effect(agentId);
  if (!isStreaming && !isProcessing) return;

  logger.info('Stopping current stream before chat session workflow', {
    agentId,
    isStreaming,
    isProcessing,
  });
  const stopAction = agentSessionStopChatRequested(agentId);
  yield* put(stopAction);
  yield* call(() => stopAction.promise);
}

function* sendMessageAndWaitForResponse(
  agentId: string,
  wsId: string,
  text: string,
  options?: AgentSessionSendMessageOptions,
): SagaGenerator<void> {
  const sendAction = agentSessionSendMessageRequested(agentId, wsId, text, options);
  yield* put(sendAction);
  yield* waitFor(
    selectAgentIsResponding as unknown as WaitForSelector<boolean, [string]>,
    [agentId] as [string],
    (responding: boolean) => responding,
  );
}

export function* handleAgentSessionLaunchAgentRequested(
  action: ReturnType<typeof agentSessionLaunchAgentRequested>,
): SagaGenerator<void> {
  const [wsId, config, options] = action.payload;
  try {
    const agentId =
      config.id ?? (yield* call([unifiedIdService, unifiedIdService.generateAgentId]));
    const model = config.model ?? (yield* selectWorkspaceDefaultModel.effect(wsId));
    const activeProvider = yield* selectActiveProviderId.effect();
    const provider =
      config.provider ??
      (model.includes(':') ? parseCompoundModelId(model).providerId : activeProvider);
    const createAction = createAgentFromConfigRequested(
      wsId,
      {
        ...config,
        id: agentId,
        workspaceId: createWorkspaceId(wsId),
        model,
        provider,
      },
      options,
    );

    yield* put(createAction);
    const session = yield* call(() => createAction.promise);
    yield* put(action.success(session));
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to launch agent');
    if (isTaskBreakdownLaunchConfig(config)) {
      logger.error('Failed to launch task-breakdown agent:', error);
    }
    yield* put(action.failure(cleanErrorMessage(errorMessage)));
  }
}

function* retryFromConversationHistory(
  agentId: string,
  wsId: string,
  options?: AgentSessionSendMessageOptions,
): SagaGenerator<void> {
  const hasSession = yield* selectAgentSessionExists.effect(agentId);
  const sessionWorkspaceId = yield* selectAgentSessionWorkspaceId.effect(agentId);
  const messages = yield* selectAgentMessages.effect(agentId);

  let lastUserMessageIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserMessageIndex = i;
      break;
    }
  }
  if (lastUserMessageIndex === -1) {
    logger.warn('No user message found in conversation history to retry', { agentId });
    return;
  }

  const lastUserMessage = messages[lastUserMessageIndex];
  const userText = extractUserMessageText(lastUserMessage);
  const mediaContextItems = extractMediaContextItems(lastUserMessage, 'retry');
  const hasAttachments = mediaContextItems.length > 0;
  if (!userText.trim() && !hasAttachments) {
    logger.warn('Could not extract content from last user message to retry', { agentId });
    return;
  }

  const messagesBeforeRetry = messages.slice(0, lastUserMessageIndex);
  logger.info('Retrying from conversation history (fallback)', {
    agentId,
    messageLength: userText.length,
    removedMessages: messages.length - lastUserMessageIndex,
    hasAttachments,
  });

  yield* put(replaceMessages(agentId, messagesBeforeRetry));
  yield* put(chatErrorCleared(agentId));
  yield* put(chatModelUnavailableCleared(agentId));

  if (hasSession) {
    yield* call(
      persistTruncatedMessages,
      (sessionWorkspaceId ?? wsId) as string,
      agentId,
      'Failed to persist truncated messages after retry fallback',
    );
  }

  const retryOptions: AgentSessionSendMessageOptions = { ...options, resetHistory: true };
  if (mediaContextItems.length > 0) {
    retryOptions.contextItems = [...(retryOptions.contextItems ?? []), ...mediaContextItems];
  }
  yield* call(sendMessageAndWaitForResponse, agentId, wsId, userText, retryOptions);
}

export function* handleAgentSessionEditAndRegenerateRequested(
  action: ReturnType<typeof agentSessionEditAndRegenerateRequested>,
): SagaGenerator<void> {
  const [agentId, wsId, messageId, newText, options] = action.payload;
  try {
    const hasSession = yield* selectAgentSessionExists.effect(agentId);
    if (!hasSession) throw new Error('No active chat session');

    let messages = yield* selectAgentMessages.effect(agentId);
    let messageIndex = messages.findIndex((message) => message.id === messageId);
    if (messageIndex === -1) throw new Error('Message not found');
    if (messages[messageIndex].role !== 'user') throw new Error('Can only edit user messages');

    yield* call(stopIfResponding, agentId);
    messages = yield* selectAgentMessages.effect(agentId);
    messageIndex = messages.findIndex((message) => message.id === messageId);
    if (messageIndex === -1) throw new Error('Message not found after stopping stream');

    yield* put(chatSendStarted(agentId, wsId));
    yield* put(replaceMessages(agentId, messages.slice(0, messageIndex)));
    yield* call(
      persistTruncatedMessages,
      wsId,
      agentId,
      'Failed to persist truncated messages after edit',
    );
    yield* call(sendMessageAndWaitForResponse, agentId, wsId, newText, {
      ...options,
      resetHistory: true,
    });
    yield* put(action.success(undefined as void));
  } catch (error) {
    yield* put(action.failure(cleanErrorMessage(getErrorMessage(error, 'Failed to edit message'))));
  }
}

export function* handleAgentSessionRegenerateFromMessageRequested(
  action: ReturnType<typeof agentSessionRegenerateFromMessageRequested>,
): SagaGenerator<void> {
  const [agentId, wsId, assistantMessageId, options] = action.payload;
  try {
    const hasSession = yield* selectAgentSessionExists.effect(agentId);
    if (!hasSession) throw new Error('No active chat session');

    yield* call(stopIfResponding, agentId);
    const messages = yield* selectAgentMessages.effect(agentId);
    const assistantMessageIndex = messages.findIndex((message) => message.id === assistantMessageId);
    if (assistantMessageIndex === -1) throw new Error('Assistant message not found');

    let userMessageIndex = -1;
    for (let i = assistantMessageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMessageIndex = i;
        break;
      }
    }
    if (userMessageIndex === -1) throw new Error('No user message found before the assistant message');

    const userMessage = messages[userMessageIndex];
    const userText = extractUserMessageText(userMessage);
    const mediaContextItems = extractMediaContextItems(userMessage, 'regen');
    const hasAttachments = mediaContextItems.length > 0;
    if (!userText.trim() && !hasAttachments) throw new Error('Could not extract text from user message');

    yield* put(chatSendStarted(agentId, wsId));
    logger.info('Regenerating from specific message', {
      agentId,
      assistantMessageId,
      userMessageIndex,
      totalMessages: messages.length,
      messagesAfterTruncation: userMessageIndex,
      hasMediaBlocks: hasAttachments,
    });
    yield* put(replaceMessages(agentId, messages.slice(0, userMessageIndex)));
    yield* call(
      persistTruncatedMessages,
      wsId,
      agentId,
      'Failed to persist truncated messages after regenerate from message',
    );

    const regenerateOptions: AgentSessionSendMessageOptions = { ...options, resetHistory: true };
    if (mediaContextItems.length > 0) {
      regenerateOptions.contextItems = [
        ...(regenerateOptions.contextItems ?? []),
        ...mediaContextItems,
      ];
    }
    yield* call(sendMessageAndWaitForResponse, agentId, wsId, userText, regenerateOptions);
    yield* put(action.success(undefined as void));
  } catch (error) {
    yield* put(action.failure(cleanErrorMessage(getErrorMessage(error, 'Failed to regenerate message'))));
  }
}

function* handleAgentSessionRetryRequested(
  action: RetryRequestAction,
  config: RetryRequestConfig,
): SagaGenerator<void> {
  const [agentId, wsId] = action.payload;
  try {
    const hasSession = yield* selectAgentSessionExists.effect(agentId);
    if (!hasSession) throw new Error('No active chat session');
    const isStreaming = yield* selectAgentSessionIsStreaming.effect(agentId);
    const isProcessing = yield* selectAgentSessionIsProcessing.effect(agentId);
    if (isStreaming || isProcessing) {
      logger.warn('Cannot retry while streaming/processing', { agentId });
      yield* put(action.success(undefined as void));
      return;
    }

    const lastAttemptedMessage = yield* selectChatLastAttemptedMessage.effect(agentId);
    if (lastAttemptedMessage) {
      const { text, options } = lastAttemptedMessage;
      const retryOptions = config.buildLastAttemptOptions
        ? config.buildLastAttemptOptions(options as AgentSessionSendMessageOptions | undefined)
        : (options as AgentSessionSendMessageOptions | undefined);
      yield* put(chatErrorCleared(agentId));
      if (config.clearModelUnavailable) {
        yield* put(chatModelUnavailableCleared(agentId));
      }
      config.logLastAttempt(agentId, text);
      yield* call(
        sendMessageAndWaitForResponse,
        agentId,
        wsId,
        text,
        retryOptions,
      );
    } else {
      yield* call(retryFromConversationHistory, agentId, wsId, config.historyOptions);
    }
    yield* put(action.success(undefined as void));
  } catch (error) {
    yield* put(action.failure(cleanErrorMessage(getErrorMessage(error, config.failureMessage))));
  }
}

export function* handleAgentSessionRetryLastMessageRequested(
  action: ReturnType<typeof agentSessionRetryLastMessageRequested>,
): SagaGenerator<void> {
  yield* call(handleAgentSessionRetryRequested, action, {
    failureMessage: 'Failed to retry message',
    logLastAttempt: (agentId: string, text: string) => {
      logger.info('Retrying last message', { agentId, messageLength: text.length });
    },
  });
}

export function* handleAgentSessionRetryWithModelRequested(
  action: ReturnType<typeof agentSessionRetryWithModelRequested>,
): SagaGenerator<void> {
  const [, , model] = action.payload;
  yield* call(handleAgentSessionRetryRequested, action, {
    failureMessage: 'Failed to retry with model',
    clearModelUnavailable: true,
    historyOptions: { model },
    buildLastAttemptOptions: (options: AgentSessionSendMessageOptions | undefined) => ({
      ...options,
      model,
    }),
    logLastAttempt: (agentId: string, text: string) => {
      logger.info('Retrying last message with different model', {
        agentId,
        messageLength: text.length,
        newModel: model,
      });
    },
  });
}

export function* handleAgentSessionForkSessionRequested(
  action: ReturnType<typeof agentSessionForkSessionRequested>,
): SagaGenerator<void> {
  const [agentId, wsId, options] = action.payload;
  try {
    const sourceSession = yield* selectAgentSession.effect(agentId);
    const sourceMessages = yield* selectAgentMessages.effect(agentId);
    if (!sourceSession) throw new Error('No active chat session to fork');

    yield* call(stopIfResponding, agentId);

    let messagesToFork: AgentMessage[];
    let forkPoint: number;
    if (options?.forkFromMessageId) {
      const messageIndex = sourceMessages.findIndex((message) => message.id === options.forkFromMessageId);
      if (messageIndex === -1) throw new Error('Fork point message not found');
      messagesToFork = sourceMessages.slice(0, messageIndex + 1);
      forkPoint = messageIndex + 1;
    } else {
      messagesToFork = [...sourceMessages];
      forkPoint = sourceMessages.length;
    }

    let clonedMessages: AgentMessage[];
    try {
      clonedMessages = JSON.parse(JSON.stringify(messagesToFork));
    } catch (cloneError) {
      logger.warn('Failed to clone messages for fork, attempting truncation:', {
        agentId,
        messageCount: messagesToFork.length,
        error: cloneError instanceof Error ? cloneError.message : String(cloneError),
      });
      try {
        clonedMessages = JSON.parse(JSON.stringify(messagesToFork.slice(-50)));
      } catch {
        logger.error('Cannot clone messages even with truncation, starting fresh fork', { agentId });
        clonedMessages = [];
      }
    }

    const forkName = makeForkName(sourceSession, options);
    const forkedId = yield* call([unifiedIdService, unifiedIdService.generateAgentId]);
    logger.info('Forking session', {
      sourceSessionId: sourceSession.id,
      forkedId,
      messageCount: clonedMessages.length,
      forkPoint,
      forkName,
    });
    yield* put(forkAgentRequested(wsId, {
      forkedAgentId: forkedId,
      sourceAgentId: sourceSession.id,
      name: forkName,
      model: options?.model || sourceSession.model,
      messages: clonedMessages,
      forkPoint,
      selectedText: options?.selectedText,
      switchToForked: options?.switchToForked,
    }));
    yield* put(action.success(forkedId));
  } catch (error) {
    yield* put(action.failure(cleanErrorMessage(getErrorMessage(error, 'Failed to fork conversation'))));
  }
}

export function* handleAgentSessionSendMessageRequested(
  action: ReturnType<typeof agentSessionSendMessageRequested>,
): SagaGenerator<void> {
  const [agentId, wsId, rawMessage, options] = action.payload;
  try {
    const message = rawMessage?.trim() ?? '';
    if (!message && !hasMediaAttachment(options)) throw new Error('Message cannot be empty');
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message too long. Maximum length is ${MAX_MESSAGE_LENGTH} characters`);
    }

    yield* call(waitForInterruptToFinish, agentId);
    yield* call(activateIfNeeded, agentId, wsId);
    const sessionWorkspaceId = ((yield* selectAgentSessionWorkspaceId.effect(agentId)) ?? wsId) as string;
    const sendWorkspace = yield* call(resolveSendWorkspace, wsId, sessionWorkspaceId);
    const { imageBlocks, fileBlocks } = yield* call(buildBackendBlocks, options?.contextItems);
    const contextItemRefs = options?.contextItems
      ?.filter((item) => !item.imageData && !item.fileData && !item.file)
      .map(toContextReference) ?? [];
    const allContextReferences = [...contextItemRefs, ...(options?.contextReferences ?? [])];

    yield* call(sendAgentMessage, agentId, message, sendWorkspace, {
      contextReferences: allContextReferences,
      imageBlocks: imageBlocks.length > 0 ? imageBlocks : undefined,
      fileBlocks: fileBlocks.length > 0 ? fileBlocks : undefined,
      noteIds: options?.noteIds,
      personality: options?.personality,
      resetHistory: options?.resetHistory,
      model: options?.model,
      userAppMessageId: options?.userAppMessageId,
    });
    yield* put(action.success(undefined as void));
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const cleanMessage = cleanErrorMessage(errorMessage);
    // Keep the optimistic user message visible and mark it with an error
    // state. No-ops if the canonical message already replaced it.
    if (options?.optimisticMessageId) {
      yield* put(
        updateMessage(agentId, options.optimisticMessageId, {
          error: cleanMessage || 'Failed to send message',
        }),
      );
    }
    if (isMessageGuardError(error)) {
      logger.info('Message blocked by guard, clearing send state', { agentId, reason: errorMessage });
      yield* put(chatSendFailed(agentId, ''));
      yield* put(action.failure(cleanMessage));
      return;
    }
    if (errorMessage.includes('Agent interrupted')) {
      yield* put(chatInterrupted(agentId));
      yield* put(action.failure(cleanMessage));
      return;
    }

    logger.error('Failed to send message', error, { agentId });
    yield* put(chatSendFailed(agentId, cleanMessage));
    yield* call(showErrorToast, cleanMessage);
    yield* put(action.failure(cleanMessage));
  }
}

export function* handleAgentSessionStopChatRequested(
  action: ReturnType<typeof agentSessionStopChatRequested>,
): SagaGenerator<void> {
  const [agentId] = action.payload;
  try {
    const hasSession = yield* selectAgentSessionExists.effect(agentId);
    if (!hasSession) {
      yield* put(action.success(undefined as void));
      return;
    }

    yield* put(chatStopInitiated(agentId));
    const workspaceId = yield* selectAgentSessionWorkspaceId.effect(agentId);
    try {
      if (!workspaceId) throw new Error('Cannot stop session without workspaceId');
      const stopAction = stopAgentSessionRequested(workspaceId as string, agentId);
      yield* put(stopAction);
      yield* call(() => stopAction.promise);
    } catch (error) {
      logger.warn('Could not stop session', { agentId, error });
    }

    yield* delay(STOP_CLEANUP_WAIT_MS);
    yield* put(chatStopCompleted(agentId));
    yield* put(action.success(undefined as void));
  } catch (error) {
    yield* put(action.failure(getErrorMessage(error, 'Failed to stop chat')));
  }
}

export function* agentChatEffectsSaga(): SagaGenerator<void> {
  yield* takeEvery(agentSessionLaunchAgentRequested, handleAgentSessionLaunchAgentRequested);
  yield* takeEvery(agentSessionSendMessageRequested, handleAgentSessionSendMessageRequested);
  yield* takeEvery(agentSessionStopChatRequested, handleAgentSessionStopChatRequested);
  yield* takeEvery(
    agentSessionEditAndRegenerateRequested,
    handleAgentSessionEditAndRegenerateRequested,
  );
  yield* takeEvery(
    agentSessionRegenerateFromMessageRequested,
    handleAgentSessionRegenerateFromMessageRequested,
  );
  yield* takeEvery(agentSessionRetryLastMessageRequested, handleAgentSessionRetryLastMessageRequested);
  yield* takeEvery(agentSessionRetryWithModelRequested, handleAgentSessionRetryWithModelRequested);
  yield* takeEvery(agentSessionForkSessionRequested, handleAgentSessionForkSessionRequested);
}