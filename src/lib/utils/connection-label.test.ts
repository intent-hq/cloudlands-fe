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

it.each([' Clément’s Mac Studio ', undefined, null, ''])(
  'labels the local machine "This computer" on screen (machine name %j)',
  (machineName) => {
    expect(formatLocalMachineLabel({ machineName })).toBe('This computer');
  },
);

const savedRemote = { label: 'intent1', host: '192.0.2.9', port: 5181, hostname: null };

it('labels the local row This computer and every saved connection by its plain name', () => {
  expect(formatMachineRowLabel({ ...savedRemote, id: 'intent1', isLocal: false }, 'intent1')).toBe(
    'intent1',
  );
  expect(formatMachineRowLabel({ ...savedRemote, id: 'mini', isLocal: false }, 'intent1')).toBe(
    'intent1',
  );
  expect(
    formatMachineRowLabel(
      { ...savedRemote, id: 'local', isLocal: true, machineName: 'MacBook Pro' },
      'local',
    ),
  ).toBe('This computer');
});
