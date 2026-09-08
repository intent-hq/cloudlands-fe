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
  it('builds an info box naming the app in the title with every identity input in the message', () => {
    const opts = buildAboutDialogOptions(info);
    expect(opts.type).toBe('info');
    expect(opts.title).toContain(info.applicationName);
    const lines = opts.message.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(info.applicationName);
    expect(lines[1]).toContain(info.applicationVersion);
    expect(lines[2]).toBe(info.intentdVersion);
    expect(lines[3]).toBe(info.copyright);
  });

  it('carries the third-party credits in the detail', () => {
    const opts = buildAboutDialogOptions(info);
    expect(opts.detail).toContain('tailcat');
    expect(opts.detail).toContain('BSD-3-Clause');
  });

  it('omits the intentd line when no version source is available', () => {
    const opts = buildAboutDialogOptions({ ...info, intentdVersion: '' });
    const lines = opts.message.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.length > 0)).toBe(true);
    expect(opts.message).not.toContain('intentd');
    expect(opts.message).toContain(info.applicationVersion);
    expect(opts.message).toContain(info.copyright);
  });
});
