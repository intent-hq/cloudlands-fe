/**
 * Stream Lifecycle Regression Tests (Bugs 8 & 9)
 *
 * Bug 8: Stale 'complete' from interrupted stream processed by new handler.
 *   When a user sends a new message during streaming, the old stream's
 *   interruption 'complete' (data: null, no message, no finishReason) arrives
 *   at the NEW handler before any chunks. Without the guard, this prematurely
 *   cleans up the new handler → all subsequent chunks are dropped.
 *   NOTE: `sendMessage()` no longer registers a per-agent stream listener —
 *   it calls `backendRequest("agent.sendMessage")` directly and streaming
 *   arrives via the daemon events bridge — so the guard's structural checks
 *   apply only to the behavioral contract below; the send path is verified
 *   to own NO stream handler at all.
 *
 * Registry retirement: the stream-handler-registry (per-agent Electron IPC
 *   listeners for restored sessions, ping/pong heartbeat bookkeeping) is fully
 *   removed — restored-session streaming flows through the daemon events
 *   bridge exactly like live sends.
 *
 * These tests use structural source-code analysis to verify the production
 * code contains the correct guard conditions and dispatch patterns, rather
 * than reimplementing the logic locally.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read the production source once for all structural tests
const SOURCE_PATH = resolve(__dirname, '../agent-stream-lifecycle.ts');
const source = readFileSync(SOURCE_PATH, 'utf-8');

describe('Bug 8: Stale complete from interrupted stream', () => {
  // -----------------------------------------------------------------------
  // Structural verification: sendMessage owns NO stream handler at all.
  // The stale-complete race existed because sendMessage registered a fresh
  // `agent:stream:${id}` listener per send; the fix at the architecture
  // level is that sendMessage no longer registers any listener — streaming
  // arrives via the daemon events bridge (events.subscribe → Redux).
  // -----------------------------------------------------------------------
  it('sendMessage registers no per-agent stream listener or ping handler', () => {
    const sendMessageIdx = source.indexOf('export async function sendMessage');
    expect(sendMessageIdx).toBeGreaterThanOrEqual(0);
    const sendMessageBody = source.slice(sendMessageIdx);

    expect(sendMessageBody).not.toContain('window.electronAPI.on(');
    expect(sendMessageBody).not.toContain('registerPingHandler(');
    expect(sendMessageBody).not.toContain('setStreamHandler(');
    expect(sendMessageBody).not.toContain('const streamHandler =');
    expect(sendMessageBody).not.toContain('markSendMessageStreamSetup(');
  });

  it('sendMessage sends via backendRequest("agent.sendMessage") with no legacy fields', () => {
    const sendMessageIdx = source.indexOf('export async function sendMessage');
    const sendMessageBody = source.slice(sendMessageIdx);

    expect(sendMessageBody).toContain("backendRequest<Record<string, unknown>>(");
    expect(sendMessageBody).toContain("'agent.sendMessage'");
    expect(sendMessageBody).not.toContain('AGENT_BACKEND_CHANNELS.STREAM_MESSAGE');
    // Legacy-only fields the daemon ignores must not be sent
    expect(sendMessageBody).not.toContain('resetHistory: options.resetHistory');
    expect(sendMessageBody).not.toContain('behaviorPrompt: session.metadata');
    expect(sendMessageBody).not.toContain('specialist: session.metadata');
    expect(sendMessageBody).not.toContain('personality: options.personality');
    expect(sendMessageBody).not.toContain('messages: messagesToSend');
  });

  it('the retired stale-complete guard is fully gone with the handler', () => {
    // The guard only made sense inside sendMessage's per-send stream handler.
    // With that handler removed, no orphaned guard fragments should remain.
    expect(source).not.toContain('hasReceivedFirstChunk');
    expect(source).not.toContain('chunkCount <= 1');
  });
});

describe('Stream lifecycle is a thin stream adapter', () => {
  it('does not read Redux state or own stale refresh helpers', () => {
    expect(source).not.toContain('selector.select(appStore.state');
    expect(source).not.toContain('getAgentSession(');
    expect(source).not.toContain('selectActiveWorkspaceId');
    expect(source).not.toContain('requestRefreshThenMaybeFallback');
    expect(source).not.toContain('requestRestoredRefreshThenMaybeFallback');
    expect(source).not.toContain('persistenceService.loadSession');
    expect(source).not.toContain('STALE_STREAM_SESSION_REFRESH_COOLDOWN_MS');
  });

  it('sendMessage owns no stream event branches (daemon events bridge owns streaming)', () => {
    const sendMessageIdx = source.indexOf('export async function sendMessage');
    expect(sendMessageIdx).toBeGreaterThanOrEqual(0);
    const sendMessageBody = source.slice(sendMessageIdx);

    // No stream-event dispatch loop inside sendMessage — only the optimistic
    // 'started' placeholder and the terminal setup-error dispatch remain.
    expect(sendMessageBody).not.toContain("data.type === 'chunk'");
    expect(sendMessageBody).not.toContain("data.type === 'content-blocks'");
    expect(sendMessageBody).not.toContain("data.type === 'complete'");
    expect(sendMessageBody).toContain("eventType: 'started'");
    expect(sendMessageBody).not.toContain('dispatchAgentStream(');
  });

  it('the restored-session stream handler path and registry are fully retired', () => {
    // Restored-session streaming flows through the daemon events bridge like
    // live sends — no per-agent Electron IPC listener registration remains.
    expect(source).not.toContain('stream-handler-registry');
    expect(source).not.toContain('registerStreamHandlerForSession');
    expect(source).not.toContain('ensureStreamHandler');
    expect(source).not.toContain('registerPingHandler');
    expect(source).not.toContain('window.electronAPI.on(');
    expect(source).not.toContain("source: 'restored'");
  });
});
