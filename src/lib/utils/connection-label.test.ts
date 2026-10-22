import { expect, it } from 'vitest';
import { formatConnectionLabel, formatGuestSessionLabel } from './connection-label';

it('preserves the accepted collaboration name while retaining personal alias precedence', () => {
  const hostname = '\uFEFFTeam\uFEFF';
  expect(formatGuestSessionLabel({ hostname, label: 'studio.example:5180' })).toBe(hostname);
  expect(
    formatConnectionLabel({ hostname, label: 'My studio', host: 'studio.example', port: 5180 }),
  ).toBe('My studio');
});
