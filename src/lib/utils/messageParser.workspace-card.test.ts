import { describe, expect, it } from 'vitest';
import {
  filterWorkspaceCardsCoveredByIds,
  groupParsedBlocks,
  parseAgentMessage,
} from './messageParser';

describe('workspace card @@@workspace sentinel blocks', () => {
  it('parses a single workspace ID', () => {
    const result = parseAgentMessage('@@@workspace\nworkspace-1\n@@@');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('workspace_card');
    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual(['workspace-1']);
  });

  it('parses multiple workspace IDs', () => {
    const result = parseAgentMessage('@@@workspace\nworkspace-1\nworkspace-2\nworkspace-3\n@@@');

    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'workspace-1',
      'workspace-2',
      'workspace-3',
    ]);
  });

  it('strips bullet prefixes', () => {
    const result = parseAgentMessage('@@@workspace\n- workspace-1\n* workspace-2\n@@@');

    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'workspace-1',
      'workspace-2',
    ]);
  });

  it('strips surrounding backticks', () => {
    const result = parseAgentMessage('@@@workspace\n`workspace-1`\n@@@');

    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual(['workspace-1']);
  });

  it('strips intent workspace link prefixes', () => {
    const result = parseAgentMessage('@@@workspace\nintent://local/workspace/workspace-1\n@@@');

    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual(['workspace-1']);
  });

  it('falls back to text for empty workspace blocks', () => {
    const input = '@@@workspace\n\n@@@';
    const result = parseAgentMessage(input);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toBe(input);
  });

  it('preserves mixed content order', () => {
    const result = parseAgentMessage('Before\n\n@@@workspace\nworkspace-1\n@@@\n\nAfter');

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toBe('Before');
    expect(result[1].type).toBe('workspace_card');
    expect(result[1].metadata?.workspaceCardData?.workspaceIds).toEqual(['workspace-1']);
    expect(result[2].type).toBe('text');
    expect(result[2].content).toBe('After');
  });
});

describe('workspace card regressions - bare IDs and legacy fences render as text/code', () => {
  it('does NOT promote bare workspace ID lines - renders as plain text', () => {
    const result = parseAgentMessage('amber-forest\nsilver-leaf');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toBe('amber-forest\nsilver-leaf');
  });

  it('does NOT promote bulleted list of workspace IDs - renders as plain text', () => {
    const result = parseAgentMessage('- amber-forest\n- silver-leaf');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
  });

  it('does NOT promote single workspace ID on its own line - renders as plain text', () => {
    const result = parseAgentMessage('amber-forest');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toBe('amber-forest');
  });

  it('does NOT promote inline-code list items like `pr-title` - renders as plain markdown', () => {
    const result = parseAgentMessage('- `pr-title`\n- `coverage-all`');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toBe('- `pr-title`\n- `coverage-all`');
  });

  it('does NOT promote bare slug lines like `merge-queue` - renders as plain text', () => {
    const result = parseAgentMessage('- merge-queue');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toBe('- merge-queue');
  });

  it('legacy ```workspace fence produces NO workspace_card - renders as code block', () => {
    const result = parseAgentMessage('```workspace\nworkspace-1\n```');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('code');
    expect(result[0].metadata?.language).toBe('workspace');
  });

  it('legacy ~~~workspace fence produces NO workspace_card - renders as code block', () => {
    const result = parseAgentMessage('~~~workspace\nworkspace-1\n~~~');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('code');
    expect(result[0].metadata?.language).toBe('workspace');
  });
});

describe('workspace card proposal dedupe', () => {
  it('removes workspace cards already represented by a proposal card', () => {
    const blocks = groupParsedBlocks(parseAgentMessage('@@@workspace\npr-review-5\n@@@'));

    const result = filterWorkspaceCardsCoveredByIds(blocks, new Set(['pr-review-5']));

    expect(result).toEqual([]);
  });

  it('keeps workspace cards that include non-proposal workspaces', () => {
    const blocks = groupParsedBlocks(parseAgentMessage('@@@workspace\npr-review-5\nother-space\n@@@'));

    const result = filterWorkspaceCardsCoveredByIds(blocks, new Set(['pr-review-5']));

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('workspace_card');
  });
});
