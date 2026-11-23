/**
 * Conversation goal wire helpers (PROTOCOL `methods/agents.md` "Conversation
 * goal"). The daemon owns `/goal` parsing; the client only detects a leading
 * `/goal` token so a command send skips the optimistic bubble, launch
 * animation and thinking state, then reconciles from the `command` result.
 */

/** Daemon-enforced goal length cap (`-32602` above it). */
export const GOAL_MAX_LENGTH = 1000;

/** The built-in slash command name. */
export const GOAL_COMMAND_NAME = 'goal';

// "Whitespace" is the Unicode `White_Space` property (Rust `char::is_whitespace`),
// not JS `\s` / `trim()`, which add U+FEFF and omit U+0085.
const GOAL_COMMAND_PATTERN = /^\p{White_Space}*\/goal(?:\p{White_Space}|$)/u;

/**
 * True when the daemon would treat `content` as a `/goal` command: after
 * trimming, it is exactly `/goal` or starts with `/goal` plus whitespace.
 * Case-sensitive, like the daemon (`/Goal`, `/goals`, `/goal:` are text).
 * Only a guess to skip the optimistic bubble: the result's `command` decides.
 */
export function isGoalCommandText(content: string): boolean {
  return GOAL_COMMAND_PATTERN.test(content);
}

type GoalCommandAction = 'set' | 'updated' | 'unchanged' | 'shown';
type SetGoalAction = 'set' | 'updated' | 'unchanged' | 'cleared';
type GoalNoticeAction = GoalCommandAction | 'cleared';

export interface GoalCommandResult {
  action: GoalCommandAction;
  goal: string | null;
  /** Absent when the goal write landed but its notice row could not be written. */
  noticeMessageId?: string;
}

export interface SetGoalResult {
  action: SetGoalAction;
  goal: string | null;
  noticeMessageId?: string;
}

const COMMAND_ACTIONS = new Set<string>(['set', 'updated', 'unchanged', 'shown']);
const SET_GOAL_ACTIONS = new Set<string>(['set', 'updated', 'unchanged', 'cleared']);
const NOTICE_ACTIONS = new Set<string>(['set', 'updated', 'unchanged', 'shown', 'cleared']);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function goalValue(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Read the `command` object of an `agent.sendMessage` / `agent.queueMessage`
 * command result (`{ success: true, queued: false, command }`), or null when
 * the response is an ordinary send.
 */
export function parseGoalCommandResult(response: unknown): GoalCommandResult | null {
  if (!record(response) || !record(response.command)) return null;
  const { name, action, goal, noticeMessageId } = response.command;
  const parsedGoal = goalValue(goal);
  if (
    name !== GOAL_COMMAND_NAME ||
    typeof action !== 'string' ||
    !COMMAND_ACTIONS.has(action) ||
    parsedGoal === undefined
  )
    return null;
  return {
    action: action as GoalCommandAction,
    goal: parsedGoal,
    ...(typeof noticeMessageId === 'string' ? { noticeMessageId } : {}),
  };
}

/** Read an `agent.setGoal` result, or null when it does not match the contract. */
export function parseSetGoalResult(response: unknown): SetGoalResult | null {
  if (!record(response)) return null;
  const { action, goal, noticeMessageId } = response;
  const parsedGoal = goalValue(goal);
  if (typeof action !== 'string' || !SET_GOAL_ACTIONS.has(action) || parsedGoal === undefined)
    return null;
  return {
    action: action as SetGoalAction,
    goal: parsedGoal,
    ...(typeof noticeMessageId === 'string' ? { noticeMessageId } : {}),
  };
}

export interface GoalNoticeInfo {
  action: GoalNoticeAction;
  goal: string | null;
  fromPrincipalId?: string;
}

interface MessageLike {
  metadata?: Record<string, unknown> | null;
}

/**
 * The goal notice info of a daemon-persisted `goal_command` row
 * (`metadata = { type: "goal_command", action, goal, fromPrincipalId? }`),
 * or null for every other message.
 */
export function getGoalNotice(message: MessageLike | null | undefined): GoalNoticeInfo | null {
  const metadata = message?.metadata;
  if (!metadata || metadata['type'] !== 'goal_command') return null;
  const action = metadata['action'];
  if (typeof action !== 'string' || !NOTICE_ACTIONS.has(action)) return null;
  const goal = goalValue(metadata['goal']) ?? null;
  const from = metadata['fromPrincipalId'];
  return {
    action: action as GoalNoticeAction,
    goal: goal && goal.length > 0 ? goal : null,
    ...(typeof from === 'string' && from.length > 0 ? { fromPrincipalId: from } : {}),
  };
}

/** The `agent:updated` goal projection: a string sets, `null` removes, absent is no change. */
export function goalFromAgentUpdated(
  data: Record<string, unknown>,
): { present: true; goal: string | undefined } | { present: false } {
  if (!Object.prototype.hasOwnProperty.call(data, 'goal')) return { present: false };
  const goal = data.goal;
  if (goal === null) return { present: true, goal: undefined };
  if (typeof goal === 'string') return { present: true, goal: goal.length > 0 ? goal : undefined };
  return { present: false };
}

/**
 * Why a goal request failed: `tooLong` / `attachments` are the documented
 * `-32602` refusals, `invalid` another daemon refusal (its message kept),
 * `failed` a transport failure or an unexpected response.
 */
export type GoalRequestError =
  | { kind: 'tooLong' }
  | { kind: 'attachments' }
  | { kind: 'retired' }
  | { kind: 'workspaceRetired' }
  | { kind: 'invalid'; message: string }
  | { kind: 'failed'; message?: string };

export type GoalCommandOutcome =
  | { ok: true; command: GoalCommandResult }
  | { ok: true; command: null }
  | { ok: false; error: GoalRequestError };

export type SetGoalOutcome =
  { ok: true; result: SetGoalResult } | { ok: false; error: GoalRequestError };

/** Classify a thrown goal request error by its `-32602` `data.code` (never the message). */
export function classifyGoalRequestError(error: unknown): GoalRequestError {
  const message =
    error &&
    typeof error === 'object' &&
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : undefined;
  const rpcCode =
    error && typeof error === 'object' ? (error as { rpcCode?: unknown }).rpcCode : undefined;
  if (rpcCode !== -32602) return { kind: 'failed', ...(message ? { message } : {}) };
  const data = (error as { data?: unknown }).data;
  const code = record(data) ? data['code'] : undefined;
  if (code === 'goal-too-long') return { kind: 'tooLong' };
  if (code === 'goal-attachments-not-allowed') return { kind: 'attachments' };
  if (code === 'agent-retired') return { kind: 'retired' };
  if (code === 'workspace-retired') return { kind: 'workspaceRetired' };
  return { kind: 'invalid', message: message ?? '' };
}
