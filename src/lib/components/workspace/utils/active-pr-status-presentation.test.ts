import { describe, expect, it } from 'vitest';
import { faCodeMerge, faCodePullRequest } from '@fortawesome/free-solid-svg-icons';
import { getActivePrStatusPresentation } from './active-pr-status-presentation';

describe('getActivePrStatusPresentation', () => {
  it('mirrors the PRSection row styling per status', () => {
    expect(getActivePrStatusPresentation('open')).toEqual({
      icon: faCodePullRequest,
      className: 'text-emerald-500',
    });
    expect(getActivePrStatusPresentation('merged')).toEqual({
      icon: faCodeMerge,
      className: 'text-purple-500',
    });
    expect(getActivePrStatusPresentation('closed')).toEqual({
      icon: faCodePullRequest,
      className: 'text-red-500',
    });
    expect(getActivePrStatusPresentation('draft')).toEqual({
      icon: faCodePullRequest,
      className: 'text-subtle',
    });
    expect(getActivePrStatusPresentation('unknown')).toEqual({
      icon: faCodePullRequest,
      className: 'text-subtle',
    });
  });
});
