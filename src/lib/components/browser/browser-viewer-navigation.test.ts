import { describe, expect, it } from 'vitest';
import {
  applyViewerNavigationEvent,
  createViewerNavigationState,
  type ViewerNavigationCommand,
  type ViewerNavigationEvent,
} from './browser-viewer-navigation';

const isValidBrowserUrl = (url: string) => url.startsWith('https://');

/** One scenario step: an event and the commands it must produce. */
type Step = [event: ViewerNavigationEvent, commands: ViewerNavigationCommand[]];

const canonical = (url: string, webviewReady = true): ViewerNavigationEvent => ({
  type: 'canonical',
  url,
  webviewReady,
});
const guest = (url: string, isMainFrame = true): ViewerNavigationEvent => ({
  type: 'guest-navigated',
  url,
  isMainFrame,
  inPage: false,
});
const inPage = (url: string, isMainFrame = true): ViewerNavigationEvent => ({
  type: 'guest-navigated',
  url,
  isMainFrame,
  inPage: true,
});
const address = (url: string): ViewerNavigationEvent => ({ type: 'address', url });
const followSettled = (seq: number): ViewerNavigationEvent => ({ type: 'follow-settled', seq });
const forwardSettled = (seq: number, ok: boolean): ViewerNavigationEvent => ({
  type: 'forward-settled',
  seq,
  ok,
});
const refresh: ViewerNavigationEvent = { type: 'refresh' };
const load = (seq: number, url: string): ViewerNavigationCommand => ({ type: 'load', seq, url });
const forward = (seq: number, url: string): ViewerNavigationCommand => ({
  type: 'forward',
  seq,
  url,
});

/** Mirror opened at canonical `url`, initial load (follow #1) settled. */
const opened = (url: string): Step[] => [
  [canonical(url, false), []],
  [guest(url), []],
  [followSettled(1), []],
];

const scenarios: Array<{ name: string; steps: Step[] }> = [
  {
    name: 'the initial src load is follow #1: its redirect is not forwarded, a later navigation is',
    steps: [
      [canonical('https://h/dashboard', false), []],
      [guest('https://h/dashboard'), []],
      [guest('https://h/login'), []],
      [followSettled(1), []],
      [guest('https://h/account'), [forward(1, 'https://h/account')]],
    ],
  },
  {
    name: 'a host-driven canonical change is loaded once and its navigations are not forwarded',
    steps: [
      ...opened('https://a/'),
      [canonical('https://b'), [load(2, 'https://b')]],
      [guest('https://b'), []],
      [guest('https://b/'), []],
      [followSettled(2), []],
      [canonical('https://b'), []],
      [guest('https://d/'), [forward(1, 'https://d/')]],
    ],
  },
  {
    name: 'a mirror-initiated navigation is forwarded once and the host echo issues no load',
    steps: [
      ...opened('https://a/'),
      [guest('https://c/'), [forward(1, 'https://c/')]],
      [canonical('https://c/'), []],
      [forwardSettled(1, true), []],
      [canonical('https://c/'), []],
    ],
  },
  {
    name: 'a superseded follow-load cannot settle its successor: the rejection of B is stale',
    steps: [
      ...opened('https://a/'),
      [canonical('https://b/'), [load(2, 'https://b/')]],
      [canonical('https://c'), [load(3, 'https://c')]],
      [followSettled(2), []],
      [guest('https://c'), []],
      [guest('https://c/'), []],
      [followSettled(3), []],
      [guest('https://e/'), [forward(1, 'https://e/')]],
    ],
  },
  {
    name: 'canonical A→B→A before B commits issues a load of A instead of skipping it',
    steps: [
      ...opened('https://a/'),
      [canonical('https://b/'), [load(2, 'https://b/')]],
      [canonical('https://a/'), [load(3, 'https://a/')]],
      [followSettled(2), []],
      [guest('https://a/'), []],
      [followSettled(3), []],
    ],
  },
  {
    name: 'a pending forward does not suppress a real Back to the canonical URL',
    steps: [
      ...opened('https://b/'),
      [guest('https://c/'), [forward(1, 'https://c/')]],
      [guest('https://b/'), [forward(2, 'https://b/')]],
      [canonical('https://c/'), [load(2, 'https://c/')]],
      [guest('https://c/'), []],
      [followSettled(2), []],
      [canonical('https://b/'), [load(3, 'https://b/')]],
      [guest('https://b/'), []],
      [followSettled(3), []],
      [forwardSettled(1, true), []],
      [forwardSettled(2, true), []],
    ],
  },
  {
    name: 'subframe navigations are ignored',
    steps: [
      ...opened('https://a/'),
      [guest('https://ads.example/frame#x', false), []],
      [guest('https://a/#top'), [forward(1, 'https://a/#top')]],
    ],
  },
  {
    name: 'a rejected forward reloads the canonical URL the host stayed on',
    steps: [
      ...opened('https://a/'),
      [guest('https://c/'), [forward(1, 'https://c/')]],
      [forwardSettled(1, false), [load(2, 'https://a/')]],
      [guest('https://a/'), []],
      [followSettled(2), []],
      [canonical('https://a/'), []],
    ],
  },
  {
    name: 'a rejection is stale once a newer follow moved the mirror on',
    steps: [
      ...opened('https://a/'),
      [guest('https://c/'), [forward(1, 'https://c/')]],
      [canonical('https://d/'), [load(2, 'https://d/')]],
      [forwardSettled(1, false), []],
    ],
  },
  {
    name: 'a rejection issues no reload when the user already went back to the canonical URL',
    steps: [
      ...opened('https://a/'),
      [guest('https://c/'), [forward(1, 'https://c/')]],
      [guest('https://a/'), [forward(2, 'https://a/')]],
      [forwardSettled(1, false), []],
      [forwardSettled(2, false), []],
      [canonical('https://a/'), []],
    ],
  },
  {
    name: 'refresh reloads the canonical URL here as a follow and forwards it to the host',
    steps: [
      ...opened('https://a/'),
      [refresh, [load(2, 'https://a/'), forward(1, 'https://a/')]],
      [guest('https://a/'), []],
      [followSettled(2), []],
      [forwardSettled(1, true), []],
    ],
  },
  {
    name: 'a canonical change is deferred until the webview is ready, then loaded',
    steps: [
      [canonical('https://a/', false), []],
      [canonical('https://b/', false), []],
      [canonical('https://b/', true), [load(2, 'https://b/')]],
    ],
  },
  {
    name: 'a canonical URL the mirror may not load is skipped and does not open a follow',
    steps: [
      ...opened('https://a/'),
      [canonical('file:///etc/passwd'), []],
      [guest('https://a/#x'), [forward(1, 'https://a/#x')]],
    ],
  },
  {
    name: 'a redirect the host also took is adopted without a reload',
    steps: [
      [canonical('https://h/a', false), []],
      [guest('https://h/a'), []],
      [guest('https://h/a/'), []],
      [followSettled(1), []],
      [canonical('https://h/a/'), []],
      [canonical('https://h/a'), [load(2, 'https://h/a')]],
    ],
  },
  {
    name: 'an empty canonical URL is ignored',
    steps: [
      [canonical(''), []],
      [canonical('https://a/', false), []],
      [canonical(''), []],
    ],
  },
  {
    name: 'an address-bar request reaches the host even though the mirror cannot load the URL',
    steps: [
      ...opened('https://a/'),
      [address('https://b/'), [load(2, 'https://b/'), forward(1, 'https://b/')]],
      [followSettled(2), []],
      [forwardSettled(1, true), []],
      [canonical('https://b/'), []],
    ],
  },
  {
    name: 'an address-bar request forwards the typed URL, not where the mirror was redirected',
    steps: [
      ...opened('https://a/'),
      [
        address('https://b/dashboard'),
        [load(2, 'https://b/dashboard'), forward(1, 'https://b/dashboard')],
      ],
      [guest('https://b/dashboard'), []],
      [guest('https://b/login'), []],
      [followSettled(2), []],
      [canonical('https://b/dashboard'), []],
    ],
  },
  {
    name: 'a rejected address-bar request brings the mirror back to the canonical URL',
    steps: [
      ...opened('https://a/'),
      [address('https://b/'), [load(2, 'https://b/'), forward(1, 'https://b/')]],
      [guest('https://b/'), []],
      [followSettled(2), []],
      [forwardSettled(1, false), [load(3, 'https://a/')]],
    ],
  },
  {
    name: 'an address the mirror may not load is not requested either',
    steps: [...opened('https://a/'), [address('http://b/'), []], [address(''), []]],
  },
  {
    name: 'in-page navigation after the follow committed is forwarded while slow resources keep the load open',
    steps: [
      ...opened('https://a/'),
      [canonical('https://b/'), [load(2, 'https://b/')]],
      [guest('https://b/'), []],
      [inPage('https://b/#section'), [forward(1, 'https://b/#section')]],
      [followSettled(2), []],
      [canonical('https://b/#section'), []],
    ],
  },
  {
    name: 'in-page navigation during the initial load is forwarded once its document committed',
    steps: [
      [canonical('https://a/', false), []],
      [inPage('https://old/#x'), []],
      [guest('https://a/'), []],
      [inPage('https://a/'), []],
      [inPage('https://a/#x'), [forward(1, 'https://a/#x')]],
      [inPage('https://a/#x', false), []],
      [followSettled(1), []],
    ],
  },
];

describe('viewer (mirror) navigation reconciler — REV-2 Model 3', () => {
  it.each(scenarios)('$name', ({ steps }) => {
    const state = createViewerNavigationState({ isValidBrowserUrl });
    steps.forEach(([event, expected], index) => {
      expect(applyViewerNavigationEvent(state, event), `step ${index}: ${event.type}`).toEqual(
        expected,
      );
    });
  });
});
