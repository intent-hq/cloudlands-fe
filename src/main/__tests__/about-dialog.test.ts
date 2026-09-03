/**
 * Help → About dialog copy: the message carries the app identity lines and
 * the detail carries the third-party license credits (tailcat, BSD-3-Clause),
 * the same credits text the macOS about panel receives via `credits`.
 */

import { describe, expect, it } from 'vitest';

import { buildAboutDialogOptions, formatThirdPartyCredits } from '../about-dialog';

const info = {
  applicationName: 'Intent',
  applicationVersion: '1.2.3 (abc1234)',
  copyright: '\u00A9 2026 Intent Contributors',
  intentdVersion: 'intentd: 0.8.23 (def5678)',
};

describe('formatThirdPartyCredits', () => {
  it('credits tailcat under its BSD-3-Clause license', () => {
    const credits = formatThirdPartyCredits();
    expect(credits).toContain('tailcat');
    expect(credits).toContain('BSD-3-Clause');
  });
});

describe('buildAboutDialogOptions', () => {
  it('builds an info box titled About <app> with identity lines and credits', () => {
    const opts = buildAboutDialogOptions(info);
    expect(opts.type).toBe('info');
    expect(opts.title).toBe('About Intent');
    expect(opts.message.split('\n')).toEqual([
      'Intent',
      'Version: 1.2.3 (abc1234)',
      'intentd: 0.8.23 (def5678)',
      '\u00A9 2026 Intent Contributors',
    ]);
    expect(opts.detail).toBe(formatThirdPartyCredits());
  });

  it('omits the intentd line when no version source is available', () => {
    const opts = buildAboutDialogOptions({ ...info, intentdVersion: '' });
    expect(opts.message.split('\n')).toEqual([
      'Intent',
      'Version: 1.2.3 (abc1234)',
      '\u00A9 2026 Intent Contributors',
    ]);
    expect(opts.detail).toContain('tailcat');
  });
});
