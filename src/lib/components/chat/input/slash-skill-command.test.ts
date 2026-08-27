import { describe, expect, it } from 'vitest';

import type { SkillInfo } from '$store/renderer/slices/skills/skills-types';
import {
  applySlashSkillSelection,
  findSlashCommandContext,
  rankSlashSkills,
} from './slash-skill-command';

function skill(name: string, description: string, location = `/skills/${name}`): SkillInfo {
  return { name, description, location };
}

describe('findSlashCommandContext', () => {
  it('finds only a leading slash token and returns its query and replacement range', () => {
    expect(findSlashCommandContext('  /review')).toEqual({
      query: 'review',
      from: 2,
      to: 9,
    });
    expect(findSlashCommandContext('\n\t/')).toEqual({ query: '', from: 2, to: 3 });
  });

  it('uses the cursor position while replacing the complete token', () => {
    expect(findSlashCommandContext('/review later', 4)).toEqual({
      query: 'rev',
      from: 0,
      to: 7,
    });
  });

  it('rejects slashes outside the active leading command token', () => {
    expect(findSlashCommandContext('review /skill')).toBeNull();
    expect(findSlashCommandContext('path/to/file')).toBeNull();
    expect(findSlashCommandContext('/review later')).toBeNull();
    expect(findSlashCommandContext(' /review', 1)).toBeNull();
  });
});

describe('rankSlashSkills', () => {
  const skills = [
    skill('zebra', 'Reviews accessibility'),
    skill('Review', 'Review a change'),
    skill('preview', 'Open a preview'),
    skill('audit', 'REVIEW workspace security'),
    skill('research', 'Research a topic'),
  ];

  it('matches names and descriptions case-insensitively by relevance then name', () => {
    expect(rankSlashSkills(skills, 'REVIEW').map(({ name }) => name)).toEqual([
      'Review',
      'preview',
      'audit',
      'zebra',
    ]);
  });

  it('uses deterministic name ordering for an empty query without mutating input', () => {
    const original = [...skills];
    expect(rankSlashSkills(skills, '').map(({ name }) => name)).toEqual([
      'audit',
      'preview',
      'research',
      'Review',
      'zebra',
    ]);
    expect(skills).toEqual(original);
  });
});

describe('applySlashSkillSelection', () => {
  it('replaces the leading token, preserves surrounding content, and positions the cursor', () => {
    const prompt = '  /rev existing request';
    const context = findSlashCommandContext(prompt, 6);
    expect(context).not.toBeNull();

    expect(applySlashSkillSelection(prompt, context!, { name: 'review' })).toEqual({
      text: '  /review existing request',
      cursorOffset: 10,
    });
  });

  it('adds room for the request when the command is the entire prompt', () => {
    const context = findSlashCommandContext('/rev');
    expect(context).not.toBeNull();

    expect(applySlashSkillSelection('/rev', context!, { name: 'review' })).toEqual({
      text: '/review ',
      cursorOffset: 8,
    });
  });
});
