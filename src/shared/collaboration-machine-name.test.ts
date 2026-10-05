import { expect, it } from 'vitest';
import {
  collaborationMachineName,
  validCollaborationMachineName,
} from './collaboration-machine-name';

it('preserves FEFF and counts it as a character, matching daemon Unicode whitespace rules', () => {
  expect(collaborationMachineName({ collaborationName: '\uFEFFTeam\uFEFF' })).toBe(
    '\uFEFFTeam\uFEFF',
  );
  expect(validCollaborationMachineName('\uFEFF' + 'a'.repeat(100))).toBe(false);
  expect(validCollaborationMachineName('\u00A0' + '😀'.repeat(100) + '\u00A0')).toBe(true);
  expect(validCollaborationMachineName('\tTeam')).toBe(false);
});
