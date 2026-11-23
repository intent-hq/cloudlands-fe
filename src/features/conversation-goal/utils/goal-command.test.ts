import { describe, expect, it } from 'vitest';
import {
  classifyGoalRequestError,
  getGoalNotice,
  goalFromAgentUpdated,
  isGoalCommandText,
  parseGoalCommandResult,
  parseGoalSetBy,
  parseSetGoalResult,
} from './goal-command';

const alice = { principalId: 'p-alice', displayName: 'Alice', login: 'alice' };

describe('isGoalCommandText (mirrors the daemon recognition rule)', () => {
  it.each([
    ['/goal x', true],
    ['  /goal\nx', true],
    ['/goal', true],
    ['  /goal  ', true],
    ['/goal\tship it', true],
    ['/Goal x', false],
    ['/goals x', false],
    ['/goal: x', false],
    ['please /goal x', false],
    ['', false],
    // Unicode White_Space (Rust char::is_whitespace), not JS \s
    ['/goal\u0085x', true],
    ['\u0085/goal x', true],
    ['/goal\u3000x', true],
    ['/goal\uFEFFx', false],
    ['\uFEFF/goal x', false],
  ])('%j → %s', (content, expected) => {
    expect(isGoalCommandText(content)).toBe(expected);
  });
});

describe('parseGoalCommandResult', () => {
  it('reads the documented command object', () => {
    expect(
      parseGoalCommandResult({
        success: true,
        queued: false,
        command: { name: 'goal', action: 'set', goal: 'Ship it', noticeMessageId: 'msg-1' },
      }),
    ).toEqual({ action: 'set', goal: 'Ship it', noticeMessageId: 'msg-1' });
    expect(
      parseGoalCommandResult({
        success: true,
        queued: false,
        command: { name: 'goal', action: 'shown', goal: null, noticeMessageId: 'msg-2' },
      }),
    ).toEqual({ action: 'shown', goal: null, noticeMessageId: 'msg-2' });
  });

  it('reads a successful command whose notice row was not written (no noticeMessageId)', () => {
    expect(
      parseGoalCommandResult({
        success: true,
        queued: false,
        command: { name: 'goal', action: 'updated', goal: 'Ship it' },
      }),
    ).toEqual({ action: 'updated', goal: 'Ship it' });
  });

  it('returns null for an ordinary send or an unknown command shape', () => {
    expect(parseGoalCommandResult({ success: true, queued: false, messageId: 'm' })).toBeNull();
    expect(
      parseGoalCommandResult({
        command: { name: 'other', action: 'set', goal: 'x', noticeMessageId: 'm' },
      }),
    ).toBeNull();
    expect(
      parseGoalCommandResult({
        command: { name: 'goal', action: 'cleared', goal: null, noticeMessageId: 'm' },
      }),
    ).toBeNull();
    expect(parseGoalCommandResult(undefined)).toBeNull();
  });
});

describe('parseSetGoalResult', () => {
  it('reads every agent.setGoal action, with an optional notice id', () => {
    expect(parseSetGoalResult({ action: 'updated', goal: 'B', noticeMessageId: 'n' })).toEqual({
      action: 'updated',
      goal: 'B',
      noticeMessageId: 'n',
    });
    expect(parseSetGoalResult({ action: 'unchanged', goal: null })).toEqual({
      action: 'unchanged',
      goal: null,
    });
    expect(parseSetGoalResult({ action: 'cleared', goal: null, noticeMessageId: 'n' })).toEqual({
      action: 'cleared',
      goal: null,
      noticeMessageId: 'n',
    });
  });

  it('rejects a response outside the contract', () => {
    expect(parseSetGoalResult({ action: 'shown', goal: 'x' })).toBeNull();
    expect(parseSetGoalResult({ action: 'set' })).toBeNull();
    expect(parseSetGoalResult(null)).toBeNull();
  });
});

describe('getGoalNotice', () => {
  it('reads goal_command rows', () => {
    expect(
      getGoalNotice({
        metadata: { type: 'goal_command', action: 'set', goal: 'Ship', fromPrincipalId: 'p1' },
      }),
    ).toEqual({ action: 'set', goal: 'Ship', fromPrincipalId: 'p1' });
    expect(
      getGoalNotice({ metadata: { type: 'goal_command', action: 'cleared', goal: null } }),
    ).toEqual({ action: 'cleared', goal: null });
  });

  it('ignores other rows and unknown actions', () => {
    expect(getGoalNotice({ metadata: { type: 'model_changed' } })).toBeNull();
    expect(getGoalNotice({ metadata: { type: 'goal_command', action: 'exploded' } })).toBeNull();
    expect(getGoalNotice({ metadata: null })).toBeNull();
  });
});

describe('goalFromAgentUpdated', () => {
  it('treats a string as set, null as removed and absence as no change', () => {
    expect(goalFromAgentUpdated({ agentId: 'a', goal: 'Ship' })).toEqual({
      present: true,
      goal: 'Ship',
    });
    expect(goalFromAgentUpdated({ agentId: 'a', goal: null })).toEqual({
      present: true,
      goal: undefined,
    });
    expect(goalFromAgentUpdated({ agentId: 'a' })).toEqual({ present: false });
    expect(goalFromAgentUpdated({ agentId: 'a', goal: 3 })).toEqual({ present: false });
  });
});

describe('classifyGoalRequestError', () => {
  it('maps the documented -32602 refusals by data.code', () => {
    expect(
      classifyGoalRequestError({
        rpcCode: -32602,
        message: 'goal is too long (max 1000 characters)',
        data: { code: 'goal-too-long', maxLength: 1000 },
      }),
    ).toEqual({ kind: 'tooLong' });
    expect(
      classifyGoalRequestError({
        rpcCode: -32602,
        message: '/goal does not take attachments',
        data: { code: 'goal-attachments-not-allowed' },
      }),
    ).toEqual({ kind: 'attachments' });
    expect(
      classifyGoalRequestError({
        rpcCode: -32602,
        message: 'agent is retired',
        data: { code: 'agent-retired' },
      }),
    ).toEqual({ kind: 'retired' });
    expect(
      classifyGoalRequestError({
        rpcCode: -32602,
        message: 'workspace is retired',
        data: { code: 'workspace-retired' },
      }),
    ).toEqual({ kind: 'workspaceRetired' });
    expect(classifyGoalRequestError({ rpcCode: -32602, message: 'agent not found' })).toEqual({
      kind: 'invalid',
      message: 'agent not found',
    });
  });

  it('never branches on the message text', () => {
    expect(
      classifyGoalRequestError({
        rpcCode: -32602,
        message: 'goal is too long (max 1000 characters)',
      }),
    ).toEqual({ kind: 'invalid', message: 'goal is too long (max 1000 characters)' });
  });

  it('treats everything else as a failure', () => {
    expect(classifyGoalRequestError(new Error('socket closed'))).toEqual({
      kind: 'failed',
      message: 'socket closed',
    });
    expect(classifyGoalRequestError({ rpcCode: -32003, message: 'forbidden' })).toEqual({
      kind: 'failed',
      message: 'forbidden',
    });
  });
});

describe('goalSetBy attribution', () => {
  it('reads a principal with nullable profile fields and rejects malformed values', () => {
    expect(parseGoalSetBy(alice)).toEqual(alice);
    expect(parseGoalSetBy({ principalId: 'p-1' })).toEqual({
      principalId: 'p-1',
      displayName: null,
      login: null,
    });
    expect(parseGoalSetBy({ principalId: 'p-1', displayName: 3, login: null })).toEqual({
      principalId: 'p-1',
      displayName: null,
      login: null,
    });
    expect(parseGoalSetBy({ principalId: ' ' })).toBeUndefined();
    expect(parseGoalSetBy({ displayName: 'x' })).toBeUndefined();
    expect(parseGoalSetBy(null)).toBeUndefined();
    expect(parseGoalSetBy('p-1')).toBeUndefined();
  });

  it('keeps goalSetBy on command and setGoal results only while a goal is set', () => {
    expect(
      parseGoalCommandResult({
        success: true,
        queued: false,
        command: { name: 'goal', action: 'set', goal: 'Ship', goalSetBy: alice },
      }),
    ).toStrictEqual({ action: 'set', goal: 'Ship', goalSetBy: alice });
    expect(parseSetGoalResult({ action: 'cleared', goal: null, goalSetBy: alice })).toStrictEqual({
      action: 'cleared',
      goal: null,
    });
    expect(parseSetGoalResult({ action: 'updated', goal: 'B', goalSetBy: alice })).toStrictEqual({
      action: 'updated',
      goal: 'B',
      goalSetBy: alice,
    });
    expect(parseSetGoalResult({ action: 'updated', goal: 'B' })).toStrictEqual({
      action: 'updated',
      goal: 'B',
    });
  });

  it('replaces the attribution with every agent:updated goal write', () => {
    expect(goalFromAgentUpdated({ agentId: 'a', goal: 'Ship', goalSetBy: alice })).toStrictEqual({
      present: true,
      goal: 'Ship',
      goalSetBy: alice,
    });
    // Unknown writer (null) and an older daemon (absent) both clear it.
    expect(goalFromAgentUpdated({ agentId: 'a', goal: 'Ship', goalSetBy: null })).toStrictEqual({
      present: true,
      goal: 'Ship',
      goalSetBy: undefined,
    });
    expect(goalFromAgentUpdated({ agentId: 'a', goal: 'Ship' })).toStrictEqual({
      present: true,
      goal: 'Ship',
      goalSetBy: undefined,
    });
    expect(goalFromAgentUpdated({ agentId: 'a', goal: null, goalSetBy: null })).toStrictEqual({
      present: true,
      goal: undefined,
      goalSetBy: undefined,
    });
  });
});
