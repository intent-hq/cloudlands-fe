import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { groupContentBlocks } from '$lib/utils/messageParser';
import { getCatalogEntry } from '../catalog';
import { chatPolishCoverage, chatPolishCoverageManifest } from './chat-polish-coverage';
import { chatPolishFixtureAdapter } from './chat-polish-fixture-adapter';
import { nestedGroupAttemptMessage, queuedUserMessage } from './chat-polish-messages';
import { getPresentedUserMessageText } from '$lib/utils/user-message-presentation';
import {
  chatPolishScenarios,
  comprehensiveChatPolishConversation,
  longCompletionReport,
} from './chat-polish-scenarios';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('chat-polish comprehensive conversation', () => {
  it('registers exactly one deterministic conversation', () => {
    const entry = getCatalogEntry('chat-polish');
    expect(entry?.fixtures.map(({ id }) => id)).toEqual(['comprehensive-conversation']);
    expect(chatPolishScenarios).toEqual([comprehensiveChatPolishConversation]);
    expect(comprehensiveChatPolishConversation.items.length).toBeGreaterThan(20);
  });

  it('keeps all required surfaces and states in the coverage manifest', () => {
    expect(chatPolishCoverage).toHaveLength(70);
    expect(chatPolishCoverage).toEqual(
      expect.arrayContaining([
        'queued',
        'optimistic',
        'sticky',
        'delivered',
        'streaming-text',
        'final-text',
        'before-content',
        'between-content',
        'after-content',
        'grouped',
        'ungrouped',
        'pending',
        'running',
        'successful',
        'failed',
        'cancelled',
        'hidden-result',
        'after_all-collapsed',
        'after_all-expanded',
        'immediate-expanded',
        'avatar-overflow',
        'retired-hook',
        'active-hook',
        'newly-unblocked-tasks',
        'successful-completion',
      ]),
    );
    expect(Object.keys(chatPolishCoverageManifest)).toHaveLength(13);
  });

  it('contains the production-shaped data behind the manifest', () => {
    const items = comprehensiveChatPolishConversation.items;
    const messages = items.flatMap((item) => (item.kind === 'message' ? [item] : []));
    const blocks = messages.flatMap(({ message }) => message.contentBlocks ?? []);
    const subscriptions = items.flatMap((item) => (item.kind === 'subscriptions' ? [item] : []));
    expect(messages.some(({ isStreaming }) => isStreaming)).toBe(true);
    expect(messages.some(({ isSticky }) => isSticky)).toBe(true);
    expect(messages.some(({ message }) => message.metadata?.optimistic)).toBe(true);
    expect(messages.some(({ message }) => message.metadata?.queueInfo)).toBe(true);
    expect(blocks.map(({ type }) => type)).toEqual(
      expect.arrayContaining(['text', 'thinking', 'tool_use', 'tool_result', 'image', 'file']),
    );
    expect(blocks.some((block) => block.type === 'tool_result' && block.is_error)).toBe(true);
    expect(subscriptions.map(({ cohort, expanded }) => `${cohort}-${expanded}`)).toEqual([
      'after_all-false',
      'after_all-true',
      'immediate-true',
    ]);
    expect(subscriptions.some(({ agentCount }) => agentCount > 6)).toBe(true);
    expect(items.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        'message',
        'wake',
        'subscriptions',
        'changed-files',
        'suggested-prompts',
      ]),
    );
  });

  it('keeps daemon delivery notes in fixture storage but not presentation output', () => {
    expect(queuedUserMessage.contentBlocks?.[0]).toMatchObject({
      text: expect.stringContaining('[SYSTEM NOTE]'),
    });
    expect(getPresentedUserMessageText(queuedUserMessage)).toBe(
      'Verify the queued handoff after the current response.',
    );
  });

  it('keeps attempted nested groups flat like the production parser', () => {
    const groups = groupContentBlocks(nestedGroupAttemptMessage.contentBlocks ?? []).filter(
      (block) => block.type === 'content_group',
    );
    expect(groups.map((group) => group.name)).toEqual(['Outer review', 'Inner verification']);
  });

  it('preserves long accessible wake content', () => {
    expect(longCompletionReport).toContain('\n\n');
    expect(longCompletionReport).toContain('你好世界');
    expect(longCompletionReport).toMatch(/completion-report-[A-Z0-9]+/);
    const singleCompletion = comprehensiveChatPolishConversation.items.find(
      (item) => item.kind === 'wake' && item.wake.eventCount === 1,
    );
    expect(singleCompletion?.kind === 'wake' && singleCompletion.wake.events[0].data).toMatchObject(
      { completionReport: longCompletionReport },
    );
  });

  it('uses only production chat components through a daemon-free adapter', () => {
    const preview = source('../renderers/ChatPolishCatalogPreview.svelte');
    for (const component of [
      'ChatMessage.svelte',
      'EventWakeupBanner.svelte',
      'ChatFileChangesSummary.svelte',
      'EventSubscriptionsCard.svelte',
      'SuggestedPrompts.svelte',
    ])
      expect(preview).toContain(`$lib/components/chat/${component}`);
    expect(chatPolishFixtureAdapter).toMatchObject({ mode: 'isolated', readOnly: true });
    expect(preview).not.toMatch(/backendRequest|appStore|dispatch|invoke|subscribeRequested/);
    expect(preview).toContain('readOnly={chatPolishFixtureAdapter.readOnly}');
    expect(source('../ChatPolishGeometryControls.svelte')).not.toContain('Named scenario');
  });
});
