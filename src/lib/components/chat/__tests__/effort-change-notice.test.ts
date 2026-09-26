import { describe, expect, it } from 'vitest';
import { formatEffortChangeLabel, getEffortChangeNotice } from '../effort-change-notice';

describe('daemon effort-change notices', () => {
  it('only recognizes the persisted effort notice metadata', () => {
    expect(getEffortChangeNotice(undefined)).toBeNull();
    expect(getEffortChangeNotice({})).toBeNull();
    expect(getEffortChangeNotice({ metadata: { type: 'model_changed' } })).toBeNull();
    expect(
      getEffortChangeNotice({ metadata: { type: 'effort_changed', from: null, to: 'none' } }),
    ).toEqual({ from: null, to: 'none' });
  });

  it.each([
    ['medium', 'high', 'Medium', 'High'],
    ['MeDiUm', 'HIGH', 'Medium', 'High'],
    ['NONE', 'xHIGH', 'Off', 'Extra high'],
    [null, 'none', 'Auto', 'Off'],
    ['none', null, 'Off', 'Auto'],
    ['minimal', 'xhigh', 'Minimal', 'Extra high'],
    ['low', 'max', 'Low', 'Max'],
    ['provider-custom', 'Future Effort', 'provider-custom', 'Future Effort'],
  ])(
    'formats %s → %s without losing the meaning of either level',
    (from, to, fromLabel, toLabel) => {
      const notice = getEffortChangeNotice({ metadata: { type: 'effort_changed', from, to } });
      const label = formatEffortChangeLabel(notice!, 'Daemon fallback');
      expect(label).toContain(fromLabel);
      expect(label).toContain(toLabel);
      expect(label.indexOf(fromLabel!)).toBeLessThan(label.indexOf(toLabel!));
      expect(label).not.toContain('Daemon fallback');
    },
  );

  it.each([
    {},
    { from: null },
    { to: 'high' },
    { from: '', to: 'high' },
    { from: 'medium', to: '   ' },
    { from: false, to: 'high' },
    { from: 'medium', to: ['high'] },
  ])('uses the daemon text for incomplete metadata: %j', (metadata) => {
    const notice = getEffortChangeNotice({ metadata: { type: 'effort_changed', ...metadata } });
    expect(notice).not.toBeNull();
    expect(formatEffortChangeLabel(notice!, 'Saved daemon explanation')).toBe(
      'Saved daemon explanation',
    );
  });
});
