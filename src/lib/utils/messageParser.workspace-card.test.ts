import { describe, expect, it } from 'vitest';
import {
  filterWorkspaceCardsCoveredByIds,
  groupParsedBlocks,
  parseAgentMessage,
} from './messageParser';

describe('workspace card blocks', () => {
  it('parses a single workspace ID', () => {
    const result = parseAgentMessage('```workspace\nworkspace-1\n```');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('workspace_card');
    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual(['workspace-1']);
  });

  it('parses multiple workspace IDs', () => {
    const result = parseAgentMessage('```workspace\nworkspace-1\nworkspace-2\nworkspace-3\n```');

    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'workspace-1',
      'workspace-2',
      'workspace-3',
    ]);
  });

  it('strips bullet prefixes', () => {
    const result = parseAgentMessage('```workspace\n- workspace-1\n* workspace-2\n```');

    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'workspace-1',
      'workspace-2',
    ]);
  });

  it('strips surrounding backticks', () => {
    const result = parseAgentMessage('```workspace\n`workspace-1`\n```');

    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual(['workspace-1']);
  });

  it('strips intent workspace link prefixes', () => {
    const result = parseAgentMessage('```workspace\nintent://local/workspace/workspace-1\n```');

    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual(['workspace-1']);
  });

  it('falls back to text for empty workspace blocks', () => {
    const input = '```workspace\n\n```';
    const result = parseAgentMessage(input);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toBe(input);
  });

  it('parses tilde-fenced workspace blocks', () => {
    const result = parseAgentMessage('~~~workspace\nworkspace-1\n~~~');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('workspace_card');
    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual(['workspace-1']);
  });

  it('preserves mixed content order', () => {
    const result = parseAgentMessage('Before\n\n```workspace\nworkspace-1\n```\n\nAfter');

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toBe('Before');
    expect(result[1].type).toBe('workspace_card');
    expect(result[1].metadata?.workspaceCardData?.workspaceIds).toEqual(['workspace-1']);
    expect(result[2].type).toBe('text');
    expect(result[2].content).toBe('After');
  });
});

describe('workspace card auto-promotion (no fence)', () => {
  it('promotes a paragraph of bare workspace ID lines', () => {
    const result = parseAgentMessage('amber-forest\nsilver-leaf');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('workspace_card');
    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'amber-forest',
      'silver-leaf',
    ]);
  });

  it('promotes a bulleted list of bare workspace IDs', () => {
    const result = parseAgentMessage('- amber-forest\n- silver-leaf');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('workspace_card');
    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'amber-forest',
      'silver-leaf',
    ]);
  });

  it('promotes a numbered list of bare workspace IDs', () => {
    const result = parseAgentMessage('1. amber-forest\n2. silver-leaf\n3. agent-cool');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('workspace_card');
    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'amber-forest',
      'silver-leaf',
      'agent-cool',
    ]);
  });

  it('promotes single workspace ID on its own line', () => {
    const result = parseAgentMessage('amber-forest');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('workspace_card');
    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual(['amber-forest']);
  });

  it('promotes IDs wrapped in backticks', () => {
    const result = parseAgentMessage('`amber-forest`\n`silver-leaf`');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('workspace_card');
    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'amber-forest',
      'silver-leaf',
    ]);
  });

  it('preserves intro prose and promotes the trailing list paragraph', () => {
    const result = parseAgentMessage('Here are your workspaces:\n\namber-forest\nsilver-leaf');

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toBe('Here are your workspaces:');
    expect(result[1].type).toBe('workspace_card');
    expect(result[1].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'amber-forest',
      'silver-leaf',
    ]);
  });

  it('preserves outro prose after a promoted list', () => {
    const result = parseAgentMessage(
      'amber-forest\nsilver-leaf\n\nLet me know which one you want to open.',
    );

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('workspace_card');
    expect(result[1].type).toBe('text');
    expect(result[1].content).toBe('Let me know which one you want to open.');
  });

  it('handles intro, list, and outro paragraphs', () => {
    const result = parseAgentMessage(
      'Here are your workspaces:\n\n- amber-forest\n- silver-leaf\n\nReady when you are.',
    );

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('text');
    expect(result[1].type).toBe('workspace_card');
    expect(result[1].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'amber-forest',
      'silver-leaf',
    ]);
    expect(result[2].type).toBe('text');
  });

  it('does not promote a paragraph that mixes prose with IDs', () => {
    const result = parseAgentMessage('The oldest workspace is amber-forest.');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
  });

  it('does not promote lines that are not valid workspace IDs', () => {
    const result = parseAgentMessage('- todo: refactor\n- todo: test\n- todo: ship');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
  });

  it('promotes runs of valid IDs and keeps interleaved prose as text', () => {
    const result = parseAgentMessage('- amber-forest\n- not a workspace id\n- silver-leaf');

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('workspace_card');
    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual(['amber-forest']);
    expect(result[1].type).toBe('text');
    expect(result[2].type).toBe('workspace_card');
    expect(result[2].metadata?.workspaceCardData?.workspaceIds).toEqual(['silver-leaf']);
  });

  it('accepts intent:// link-style entries on their own line', () => {
    const result = parseAgentMessage(
      'intent://local/workspace/amber-forest\nintent://local/workspace/silver-leaf',
    );

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('workspace_card');
    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'amber-forest',
      'silver-leaf',
    ]);
  });

  it('strips trailing punctuation from id lines', () => {
    const result = parseAgentMessage('- amber-forest,\n- silver-leaf.');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('workspace_card');
    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'amber-forest',
      'silver-leaf',
    ]);
  });

  it('does not double-process a fenced workspace block (fence takes precedence)', () => {
    const result = parseAgentMessage('Intro\n\n\`\`\`workspace\namber-forest\n\`\`\`');

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toBe('Intro');
    expect(result[1].type).toBe('workspace_card');
    expect(result[1].metadata?.workspaceCardData?.workspaceIds).toEqual(['amber-forest']);
  });

  it('handles UUID-format workspace IDs', () => {
    const uuid = '12345678-1234-1234-1234-123456789abc';
    const result = parseAgentMessage(uuid);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('workspace_card');
    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual([uuid]);
  });

  it('handles legacy slug format workspace IDs', () => {
    const result = parseAgentMessage('amber-forest-a7x2');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('workspace_card');
    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual(['amber-forest-a7x2']);
  });
});

describe('workspace card promotion across line-level runs', () => {
  it('splits a paragraph with mixed prose + trailing IDs on consecutive lines', () => {
    const input =
      'You have 65 active workspaces, sorted by most recent activity:primitive-add\nuser-bug-2\npr-review-2';
    const result = parseAgentMessage(input);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain('You have 65 active workspaces');
    expect(result[1].type).toBe('workspace_card');
    expect(result[1].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'user-bug-2',
      'pr-review-2',
    ]);
  });

  it('promotes IDs with no blank line between intro prose and the list', () => {
    const input = 'Your workspaces:\namber-forest\nsilver-leaf';
    const result = parseAgentMessage(input);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toBe('Your workspaces:');
    expect(result[1].type).toBe('workspace_card');
    expect(result[1].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'amber-forest',
      'silver-leaf',
    ]);
  });

  it('splits prose between two ID runs in the same paragraph', () => {
    const input = 'Active:\namber-forest\nsilver-leaf\n\nArchived:\nold-fork\nstale-branch';
    const result = parseAgentMessage(input);

    expect(result).toHaveLength(4);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toBe('Active:');
    expect(result[1].type).toBe('workspace_card');
    expect(result[1].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'amber-forest',
      'silver-leaf',
    ]);
    expect(result[2].type).toBe('text');
    expect(result[2].content).toBe('Archived:');
    expect(result[3].type).toBe('workspace_card');
    expect(result[3].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'old-fork',
      'stale-branch',
    ]);
  });

  it('treats blank lines inside an ID run as part of the same card', () => {
    const input = 'amber-forest\n\nsilver-leaf\n\nagent-cool';
    const result = parseAgentMessage(input);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('workspace_card');
    expect(result[0].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'amber-forest',
      'silver-leaf',
      'agent-cool',
    ]);
  });

  it('keeps trailing prose paragraph after the card', () => {
    const input = 'Here are the workspaces:\namber-forest\nsilver-leaf\nReady when you are.';
    const result = parseAgentMessage(input);

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toBe('Here are the workspaces:');
    expect(result[1].type).toBe('workspace_card');
    expect(result[1].metadata?.workspaceCardData?.workspaceIds).toEqual([
      'amber-forest',
      'silver-leaf',
    ]);
    expect(result[2].type).toBe('text');
    expect(result[2].content).toBe('Ready when you are.');
  });

  it('does not promote when single ID is sandwiched mid-prose-list', () => {
    const input = '- Item one\n- amber-forest\n- Item three';
    const result = parseAgentMessage(input);

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('text');
    expect(result[1].type).toBe('workspace_card');
    expect(result[1].metadata?.workspaceCardData?.workspaceIds).toEqual(['amber-forest']);
    expect(result[2].type).toBe('text');
  });
});

describe('workspace card proposal dedupe', () => {
  it('removes workspace cards already represented by a proposal card', () => {
    const blocks = groupParsedBlocks(parseAgentMessage('```workspace\npr-review-5\n```'));

    const result = filterWorkspaceCardsCoveredByIds(blocks, new Set(['pr-review-5']));

    expect(result).toEqual([]);
  });

  it('keeps workspace cards that include non-proposal workspaces', () => {
    const blocks = groupParsedBlocks(parseAgentMessage('```workspace\npr-review-5\nother-space\n```'));

    const result = filterWorkspaceCardsCoveredByIds(blocks, new Set(['pr-review-5']));

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('workspace_card');
  });
});
