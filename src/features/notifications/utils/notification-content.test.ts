/**
 * Tests for the pure notification-content builder — the port of the
 * main-process `NotificationService.buildNotificationContent`. Formats and
 * truncation limits must stay byte-identical to the Electron builder so web
 * notifications match Electron's title/body exactly.
 */
import { describe, expect, it } from 'vitest';
import { buildNotificationContent, getSpecialistDisplayName } from './notification-content';

describe('getSpecialistDisplayName', () => {
  it('maps known specialists and falls back to Agent', () => {
    expect(getSpecialistDisplayName('spec-writer')).toBe('Coordinator');
    expect(getSpecialistDisplayName('implementor')).toBe('Implementor');
    expect(getSpecialistDisplayName('verifier')).toBe('Verifier');
    expect(getSpecialistDisplayName('unknown')).toBe('Agent');
    expect(getSpecialistDisplayName(undefined)).toBe('Agent');
  });
});

describe('buildNotificationContent', () => {
  it('builds "<Specialist>: <Task>" / "Task completed" with a task title', () => {
    expect(
      buildNotificationContent({ isChief: false, specialist: 'implementor', taskTitle: 'Fix it' }),
    ).toEqual({ title: 'Implementor: Fix it', body: 'Task completed' });
  });

  it('builds "<Specialist>" / "Finished" without a task title', () => {
    expect(buildNotificationContent({ isChief: false, specialist: 'spec-writer' })).toEqual({
      title: 'Coordinator',
      body: 'Finished',
    });
  });

  it('prepends the workspace title when available', () => {
    expect(
      buildNotificationContent({ isChief: false, specialist: 'verifier' }, 'My Workspace'),
    ).toEqual({ title: 'My Workspace - Verifier', body: 'Finished' });
  });

  it('truncates long task titles at 40 chars (37 + ellipsis)', () => {
    const taskTitle = 'a'.repeat(50);
    const { title } = buildNotificationContent({ isChief: false, taskTitle });
    expect(title).toBe(`Agent: ${'a'.repeat(37)}...`);
  });

  it('truncates long workspace titles at 30 chars (27 + ellipsis)', () => {
    const workspaceTitle = 'w'.repeat(40);
    const { title } = buildNotificationContent({ isChief: false }, workspaceTitle);
    expect(title).toBe(`${'w'.repeat(27)}... - Agent`);
  });

  it('titles chief completions with the chat thread name', () => {
    expect(buildNotificationContent({ isChief: true, agentName: 'Morning chat' })).toEqual({
      title: 'Assistant — Morning chat',
      body: 'Finished',
    });
  });

  it('truncates long chief chat names at 40 chars and falls back to bare Assistant', () => {
    const agentName = 'c'.repeat(50);
    expect(buildNotificationContent({ isChief: true, agentName }).title).toBe(
      `Assistant — ${'c'.repeat(37)}...`,
    );
    expect(buildNotificationContent({ isChief: true }).title).toBe('Assistant');
  });

  it('chief body honors taskTitle', () => {
    expect(buildNotificationContent({ isChief: true, taskTitle: 'T' }).body).toBe(
      'Task completed',
    );
  });
});
