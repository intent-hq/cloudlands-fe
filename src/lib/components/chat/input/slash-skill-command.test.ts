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
  it('finds a slash token at any token boundary', () => {
    expect(findSlashCommandContext('  /review')).toEqual({
      query: 'review',
      from: 2,
      to: 9,
    });
    expect(findSlashCommandContext('\n\t/')).toEqual({ query: '', from: 2, to: 3 });
    expect(findSlashCommandContext('explain this /review')).toEqual({
      query: 'review',
      from: 13,
      to: 20,
    });
    expect(findSlashCommandContext('first line\n/review')).toEqual({
      query: 'review',
      from: 11,
      to: 18,
    });
  });

  it('uses the cursor position to find and filter the active token', () => {
    expect(findSlashCommandContext('before /review after', 11)).toEqual({
      query: 'rev',
      from: 7,
      to: 14,
    });

    const prompt = '/audit then /review later';
    expect(findSlashCommandContext(prompt, prompt.indexOf('/review') + 4)).toEqual({
      query: 'rev',
      from: 12,
      to: 19,
    });
  });

  it('rejects embedded slashes and slashes outside the active cursor token', () => {
    expect(findSlashCommandContext('path/to/file')).toBeNull();
    expect(findSlashCommandContext('https://example.com/docs')).toBeNull();
    expect(findSlashCommandContext('word/review')).toBeNull();
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
  it('replaces only the active token, preserves surrounding content, and positions the cursor', () => {
    const prompt = 'draft /rev existing request';
    const context = findSlashCommandContext(prompt, 10);
    expect(context).not.toBeNull();

    expect(applySlashSkillSelection(prompt, context!, { name: 'review' })).toEqual({
      text: 'draft /review existing request',
      cursorOffset: 14,
    });
  });

  it('replaces the selected command among multiple slash tokens across lines', () => {
    const prompt = '/audit first\nthen /rev final request';
    const cursorOffset = prompt.indexOf('/rev') + 4;
    const context = findSlashCommandContext(prompt, cursorOffset);
    expect(context).not.toBeNull();

    expect(applySlashSkillSelection(prompt, context!, { name: 'review' })).toEqual({
      text: '/audit first\nthen /review final request',
      cursorOffset: prompt.indexOf('/rev') + '/review '.length,
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
