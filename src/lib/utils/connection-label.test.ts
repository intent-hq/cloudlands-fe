import { expect, it } from 'vitest';
import {
  formatConnectionLabel,
  formatGuestSessionLabel,
  formatLocalMachineLabel,
} from './connection-label';

it('preserves the accepted collaboration name while retaining personal alias precedence', () => {
  const hostname = '\uFEFFTeam\uFEFF';
  expect(formatGuestSessionLabel({ hostname, label: 'studio.example:5180' })).toBe(hostname);
  expect(
    formatConnectionLabel({ hostname, label: 'My studio', host: 'studio.example', port: 5180 }),
  ).toBe('My studio');
});

it('labels the local machine by its own name with the local suffix', () => {
  expect(formatLocalMachineLabel({ machineName: ' Clément’s Mac Studio ' })).toBe(
    'Clément’s Mac Studio (local)',
  );
});

it.each([undefined, null, '', '   '])(
  'falls back to "This machine (local)" when the machine name is %j',
  (machineName) => {
    expect(formatLocalMachineLabel({ machineName })).toBe('This machine (local)');
  },
);
