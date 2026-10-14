import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '$shared/types';
import { mergeHydratedContent } from '../block-hydration';
import { hydratedBlockKey } from '../../../../store/renderer/slices/chat-state/chat-state-types';
import { dedupeToolUseBlocks, getToolCallState } from '../tool-call-presentation';
import {
  getWorkspaceConfirmationPresentation,
  prepareWorkspaceConfirmationContent,
} from '../workspace-confirmation-presentation';

const call = (id = 'message:1', toolCallId = 'provider-call'): ContentBlock => ({
  type: 'tool_use',
  id,
  toolCallId,
  name: 'workspace_api',
  input: { code: 'return ws.workspace.details()', summary: 'Inspect workspace' },
});
const result = (
  tool_use_id = 'provider-call',
  output: unknown = 'Workspace details',
): ContentBlock => ({
  type: 'tool_result',
  id: 'message:2',
  tool_use_id,
  output,
});

describe('bounded workspace confirmation presentation', () => {
  it('preserves the source no-tool array identity', () => {
    const blocks: ContentBlock[] = [{ type: 'text', text: 'Message' }];
    expect(dedupeToolUseBlocks(blocks)).toBe(blocks);
  });
  it('pairs exact protocol identities across canonical response groups, without consuming other families', () => {
    const tool = call();
    const paired = result();
    const unmatched = result('other');
    const unsupported = {
      ...call('message:4', 'note-call'),
      input: { code: 'return ws.note.read("spec")', summary: 'Read spec' },
    };
    const noteResult = { ...result('note-call'), id: 'message:5' };
    const prepared = prepareWorkspaceConfirmationContent([
      { type: 'text', text: '<group:Inspect>' },
      tool,
      { type: 'text', text: '</group>' },
      paired,
      unmatched,
      unsupported,
      noteResult,
    ]);
    expect(prepared.groups.some((block) => block.type === 'content_group')).toBe(true);
    expect(prepared.pairs.get(tool)).toBe(paired);
    expect(prepared.pairs.has(unsupported)).toBe(false);
    expect([...prepared.consumedResults]).toEqual([paired]);
  });

  it('keeps the last streaming skeleton, honors addressable ID precedence and never guesses by proximity', () => {
    const skeleton = call();
    const replacement = {
      ...call(),
      input: { code: 'return ws.workspace.details()', summary: 'Updated summary' },
    };
    const byProvider = result();
    const byAddress = { ...result(replacement.id, 'Addressed output'), id: 'message:3' };
    const prepared = prepareWorkspaceConfirmationContent([
      skeleton,
      byProvider,
      replacement,
      byAddress,
    ]);
    expect(prepared.pairs.has(skeleton)).toBe(false);
    expect(prepared.pairs.get(replacement)).toBe(byAddress);
    expect(prepared.consumedResults.has(byProvider)).toBe(false);
    const isolated = call('different', 'unmatched');
    expect(
      prepareWorkspaceConfirmationContent([isolated, byProvider]).pairs.get(isolated),
    ).toBeUndefined();
    expect(prepareWorkspaceConfirmationContent([isolated, byProvider]).consumedResults.size).toBe(
      0,
    );
  });

  it('uses source admission, result-owned error status and ok-only disclosure rules', () => {
    const hidden = { ...call(), input: { code: 'return ws.workspace.details()' } };
    expect(getWorkspaceConfirmationPresentation(hidden, result())?.admitted).toBe(false);
    const tool = { ...call(), metadata: { status: 'error' } };
    expect(getWorkspaceConfirmationPresentation(tool, result())?.state).toBe('completed');
    expect(getToolCallState({ ...result(), is_error: true })).toBe('error');
    expect(getToolCallState({ ...result(), isError: true })).toBe('error');
    expect(getToolCallState(result('provider-call', 'Tool Error: failed'))).toBe('error');
    expect(getToolCallState(undefined, true)).toBe('running');
    expect(getToolCallState(undefined, false)).toBe('completed');
    const mutation = {
      ...call(),
      input: { code: 'return ws.workspace.setTitle("new")', summary: 'Set title' },
    };
    const model = getWorkspaceConfirmationPresentation(
      mutation,
      result('provider-call', { ok: true }),
    );
    expect(model?.admitted).toBe(true);
    expect(model?.model.hasDetails).toBe(false);
    expect(model?.model.status).toBe('success');
  });

  it('preserves unsupported result shapes and returns the source parsed confirmation text', () => {
    const payload = {
      result: { content: [{ type: 'text', text: 'Nested transport envelope' }] },
      error: null,
    };
    const model = getWorkspaceConfirmationPresentation(call(), result('provider-call', payload));
    expect(model?.result).toBe(payload);
    expect(model?.parsed.content).toBeUndefined();
    expect(
      getWorkspaceConfirmationPresentation(
        call(),
        result('provider-call', [{ type: 'text', text: 'Actual text' }]),
      )?.parsed.content,
    ).toBe('Actual text');
    expect(
      getWorkspaceConfirmationPresentation(
        { ...call(), name: 'bash', input: { command: 'pwd' } },
        result(),
      ),
    ).toBeNull();
  });

  it('reclassifies hydrated input while newer complete blocks supersede cached content', () => {
    const slim = { ...call(), inputTruncated: true };
    const full = {
      ...call(),
      input: { code: 'return ws.note.read("spec")', summary: 'Read spec' },
    };
    const cache = {
      [hydratedBlockKey('message', slim.id!)]: { status: 'loaded' as const, block: full },
    };
    const hydrated = mergeHydratedContent([slim, result()], 'message', cache);
    expect(prepareWorkspaceConfirmationContent(hydrated).pairs.size).toBe(0);
    const complete = call();
    const updated = mergeHydratedContent([complete, result()], 'message', cache);
    expect(updated[0]).toBe(complete);
    expect(prepareWorkspaceConfirmationContent(updated).pairs.size).toBe(1);
  });
});
