import { expect, it } from 'vitest';
import {
  formatConnectionLabel,
  formatGuestSessionLabel,
  formatLocalMachineLabel,
  formatMachineRowLabel,
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

const savedRemote = { label: 'intent1', host: '192.0.2.9', port: 5181, hostname: null };

it('labels the saved connection this window uses as the connected backend', () => {
  expect(formatMachineRowLabel({ ...savedRemote, id: 'intent1', isLocal: false }, 'intent1')).toBe(
    'intent1 (connected backend)',
  );
});

it('leaves other saved connections and the local row unchanged', () => {
  expect(formatMachineRowLabel({ ...savedRemote, id: 'mini', isLocal: false }, 'intent1')).toBe(
    'intent1',
  );
  expect(
    formatMachineRowLabel(
      { ...savedRemote, id: 'local', isLocal: true, machineName: 'MacBook Pro' },
      'local',
    ),
  ).toBe('MacBook Pro (local)');
});
