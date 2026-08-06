/**
 * Tests for the release-notes mutation middleware — the renderer half of the
 * modal flow, driven through the mock IPC router.
 *
 * Asserts that:
 * - `initializeReleaseNotes` subscribes to the main → renderer show push once
 * - the startup push (notes attached) opens the modal with those notes
 * - the Help-menu push (`notes: null`) opens the modal loading, fetches over
 *   `release-notes:get`, and resolves into content
 * - an unavailable fetch still opens the modal (fallback state)
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock backend transport so unrelated middlewares resolve quietly
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: () => Promise.resolve(undefined),
  backendSubscribe: () => Promise.resolve({ subscriptionId: "sub-rn-1" }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));

import { RELEASE_NOTES_CHANNELS } from "$features/release-notes/types";
import { __resetReleaseNotesMiddlewareForTests } from "$features/release-notes/release-notes-mutation-service";
import { store as appStore } from "$store/renderer/store";
import {
  closeReleaseNotesModal,
  initializeReleaseNotes,
} from "$store/renderer/slices/release-notes/release-notes-slice";
import {
  addMockIpcListener,
  emitMockIpcEvent,
  mockIpcListenerCount,
  registerMockIpcHandler,
  resetMockIpcRouter,
} from "$shared/ipc-mock-router";

const NOTES = {
  version: "2.1.0",
  notes: "## What changed\n\n- Everything",
  url: "https://github.com/intent-hq/cloudlands-releases/releases/tag/v2.1.0",
};

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

beforeAll(() => {
  let listenerIdCounter = 0;
  (window as any).electronAPI = {
    ...((window as any).electronAPI || {}),
    on: vi.fn((channel: string, handler: (data: any) => void) => {
      addMockIpcListener(channel, handler);
      return ++listenerIdCounter;
    }),
    offById: vi.fn(),
  };
});

describe("release-notes-mutation-service", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    await flush();
    __resetReleaseNotesMiddlewareForTests();
    resetMockIpcRouter();
    appStore.dispatch(closeReleaseNotesModal());
  });

  it("subscribes to the show push exactly once", async () => {
    appStore.dispatch(initializeReleaseNotes());
    appStore.dispatch(initializeReleaseNotes());
    await flush();

    expect(mockIpcListenerCount(RELEASE_NOTES_CHANNELS.SHOW)).toBe(1);
    expect(appStore.state.releaseNotes.initialized).toBe(true);
  });

  it("opens the modal with the notes carried by the startup push", async () => {
    appStore.dispatch(initializeReleaseNotes());
    await flush();

    emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: NOTES });
    await flush();

    expect(appStore.state.releaseNotes.showModal).toBe(true);
    expect(appStore.state.releaseNotes.releaseNotes).toEqual(NOTES);
    expect(appStore.state.releaseNotes.loading).toBe(false);
  });

  it("fetches over release-notes:get when the menu push carries no notes", async () => {
    const getSpy = vi.fn(async () => ({ success: true, data: NOTES }));
    registerMockIpcHandler(RELEASE_NOTES_CHANNELS.GET, getSpy);

    appStore.dispatch(initializeReleaseNotes());
    await flush();

    emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: null });
    await flush();

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(appStore.state.releaseNotes.showModal).toBe(true);
    expect(appStore.state.releaseNotes.releaseNotes).toEqual(NOTES);
    expect(appStore.state.releaseNotes.loading).toBe(false);
  });

  it("still opens the modal (fallback state) when no notes are available", async () => {
    registerMockIpcHandler(RELEASE_NOTES_CHANNELS.GET, async () => ({
      success: false,
      error: { message: "Release notes are not available in this build" },
    }));

    appStore.dispatch(initializeReleaseNotes());
    await flush();

    emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: null });
    await flush();

    expect(appStore.state.releaseNotes.showModal).toBe(true);
    expect(appStore.state.releaseNotes.releaseNotes).toBeNull();
    expect(appStore.state.releaseNotes.loading).toBe(false);
  });
});
