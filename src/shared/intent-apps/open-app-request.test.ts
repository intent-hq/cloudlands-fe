import { describe, expect, it } from 'vitest';
import { findOpenAppRequest, isOpenAppLink, parseOpenAppLink } from './open-app-request';

describe('Intent apps open entry', () => {
  it('reads `--open-app <id>` and `--open-app=<id>`', () => {
    expect(findOpenAppRequest(['/opt/Intent', '--open-app', 'pomodoro-timer'])).toEqual({
      appId: 'pomodoro-timer',
      fromLink: false,
    });
    expect(findOpenAppRequest(['/opt/Intent', '--open-app=notes'])).toEqual({
      appId: 'notes',
      fromLink: false,
    });
  });

  it('reads `intent://app/<id>`', () => {
    expect(findOpenAppRequest(['/opt/Intent', 'intent://app/pomodoro-timer'])).toEqual({
      appId: 'pomodoro-timer',
      fromLink: true,
    });
    expect(parseOpenAppLink('INTENT://app/notes/')).toBe('notes');
  });

  it('refuses ids outside the manifest rule, so an id never becomes a flag or a path', () => {
    expect(findOpenAppRequest(['--open-app', '--inspect'])).toBeNull();
    expect(findOpenAppRequest(['--open-app'])).toBeNull();
    expect(findOpenAppRequest(['--open-app=Bad_Id'])).toBeNull();
    expect(parseOpenAppLink('intent://app/..')).toBeNull();
    expect(parseOpenAppLink('intent://app/a%2Fb')).toBeNull();
    expect(parseOpenAppLink('intent://app/notes/extra')).toBeNull();
    expect(parseOpenAppLink('intent://app/notes?x=1')).toBeNull();
  });

  it('marks every app link, valid or not, so no other router takes it', () => {
    expect(isOpenAppLink('intent://app/notes')).toBe(true);
    expect(isOpenAppLink('intent://app/BAD')).toBe(true);
    expect(isOpenAppLink('intent://app')).toBe(true);
    expect(isOpenAppLink('intent://apps/notes')).toBe(false);
    expect(isOpenAppLink('intent://open?path=/tmp')).toBe(false);
  });

  it('ignores command lines without a request', () => {
    expect(findOpenAppRequest(['/opt/Intent', 'intent://open?path=/tmp'])).toBeNull();
  });
});
