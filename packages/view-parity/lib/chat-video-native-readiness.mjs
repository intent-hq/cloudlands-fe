import assert from 'node:assert/strict';

// This is a pinned verification contract, never a production media API.
// Chromium's loading panel finishes its current 1333ms mask cycle after canplaythrough:
// chromium/src@971a7443b0c9b0a9b2860529b33331b76077ec62,
// media_control_loading_panel_element.cc:152-180,208-219.
const browserContract = {
  product: 'HeadlessChrome/153.0.8010.12',
  revision: '@971a7443b0c9b0a9b2860529b33331b76077ec62',
};
const playerSelector = 'video[data-testid="chat-video-player"]';
const timeoutMs = 5_000;

// Executed through CDP with the actual video as `this`, and its native panel's
// shadow root as an argument. Only observation is installed; no DOM/media writes.
function observeControls(root, selector, bound) {
  const video = this;
  const panel = root.host;
  const controls = panel.parentElement;
  if (
    !(video instanceof globalThis.HTMLVideoElement) ||
    video !== document.querySelector(selector) ||
    panel.getRootNode().host !== video ||
    panel.getAttribute('pseudo') !== '-internal-media-controls-loading-panel' ||
    controls.getAttribute('pseudo') !== '-webkit-media-controls'
  ) {
    throw new Error('Unsupported native video/panel ownership contract');
  }
  const source = video.currentSrc;
  const poster = video.poster;
  const events = [];
  const snapshot = () => {
    const mask = root.querySelector(
      '[pseudo="-internal-media-controls-loading-panel-spinner-mask-1-background"]',
    );
    const style = mask ? globalThis.getComputedStyle(mask) : null;
    return {
      media: {
        source: video.currentSrc,
        poster: video.poster,
        readyState: video.readyState,
        networkState: video.networkState,
        paused: video.paused,
        currentTime: video.currentTime,
        played: Array.from({ length: video.played.length }, (_, i) => [
          video.played.start(i),
          video.played.end(i),
        ]),
        buffered: Array.from({ length: video.buffered.length }, (_, i) => [
          video.buffered.start(i),
          video.buffered.end(i),
        ]),
        controls: video.controls,
        autoplay: video.autoplay,
        error: video.error?.code ?? null,
      },
      controlsClass: controls.className,
      panel: {
        connected: panel.isConnected,
        display: globalThis.getComputedStyle(panel).display,
        children: root.childNodes.length,
        mask: style ? { name: style.animationName, duration: style.animationDuration } : null,
      },
    };
  };
  let timer;
  let observer;
  let finish;
  let before;
  let finished = false;
  let waited = false;
  const mediaEvents = [
    'loadedmetadata',
    'loadeddata',
    'canplay',
    'canplaythrough',
    'error',
    'emptied',
    'play',
    'playing',
    'seeking',
  ];
  const animationEnd = (event) => {
    events.push({
      type: event.type,
      trusted: event.isTrusted,
      name: event.animationName,
      elapsedTime: event.elapsedTime,
      target: event.target.getAttribute('pseudo'),
    });
    // Native target listeners perform cleanup after this capture listener.
    // The MutationObserver checks the resulting hidden/empty panel.
  };
  const check = () => {
    if (finished) return;
    try {
      const state = snapshot();
      if (
        !video.isConnected ||
        video !== document.querySelector(selector) ||
        !state.panel.connected ||
        video.currentSrc !== source ||
        video.poster !== poster ||
        !video.controls ||
        video.autoplay ||
        !video.paused ||
        video.currentTime !== 0 ||
        video.played.length ||
        video.error
      )
        return finish(false, 'Target changed, detached, errored, or ceased to be unplayed', state);
      const ready =
        video.readyState >= video.HAVE_CURRENT_DATA &&
        controls.classList.contains('phase-ready') &&
        controls.classList.contains('state-stopped');
      const settled = state.panel.display === 'none' && state.panel.children === 0;
      if (ready && settled) {
        if (
          waited &&
          !events.some(
            (e) =>
              e.trusted &&
              e.name === 'mask-1-spin' &&
              e.target === '-internal-media-controls-loading-panel-spinner-mask-1-background',
          )
        ) {
          return finish(false, 'Native panel cleared without observed trusted completion', state);
        }
        return finish(
          true,
          waited ? 'native animation completed and panel cleared' : 'already settled',
          state,
        );
      }
      if (state.panel.display !== 'none') {
        if (state.panel.mask?.name !== 'mask-1-spin' || state.panel.mask.duration !== '1.333s')
          return finish(false, 'Unsupported native loading animation contract', state);
        waited = true;
      }
    } catch (error) {
      finish(false, String(error));
    }
  };
  const ready = new Promise((resolve) => {
    finish = (ok, reason, after) => {
      if (finished) return;
      finished = true;
      globalThis.clearTimeout(timer);
      observer?.disconnect();
      root.removeEventListener('animationend', animationEnd, true);
      for (const type of mediaEvents) video.removeEventListener(type, check);
      resolve({ ok, reason, before, after, events, observersCleaned: true });
    };
    try {
      before = snapshot();
      observer = new globalThis.MutationObserver(check);
      observer.observe(root, { childList: true, subtree: true });
      observer.observe(panel, { attributes: true });
      observer.observe(controls, { attributes: true });
      observer.observe(video.ownerDocument, { childList: true, subtree: true });
      root.addEventListener('animationend', animationEnd, true);
      for (const type of mediaEvents) video.addEventListener(type, check);
      timer = globalThis.setTimeout(() => {
        try {
          finish(false, 'Native-controls readiness timed out', snapshot());
        } catch (error) {
          finish(false, String(error));
        }
      }, bound);
      // Attach first, then check: native completion before attachment is accepted
      // only with positive ready/stopped + hidden/empty evidence for this panel.
      check();
    } catch (error) {
      finish(false, String(error));
    }
  });
  return { ready, cancel: () => finish(false, 'Native-controls observation cancelled') };
}

function panelRoots(node) {
  const found = [];
  if (node.attributes?.includes('-internal-media-controls-loading-panel'))
    found.push(...(node.shadowRoots ?? []));
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])])
    found.push(...panelRoots(child));
  return found;
}

export async function waitForUnplayedNativeVideoControls(page, player, info, name) {
  const receipt = { contract: browserContract, timeoutMs };
  let session;
  let handle;
  let controller;
  try {
    assert.equal(await player.count(), 1, 'Native readiness requires one actual target video');
    handle = await player.elementHandle();
    const sameTarget = () =>
      handle.evaluate(
        (node, selector) =>
          node.isConnected &&
          node.ownerDocument.querySelectorAll(selector).length === 1 &&
          node === node.ownerDocument.querySelector(selector),
        playerSelector,
      );
    assert.ok(await sameTarget(), 'Native readiness target must be the unique live chat player');
    session = await page.context().newCDPSession(page);
    receipt.browser = await session.send('Browser.getVersion');
    for (const [key, value] of Object.entries(browserContract))
      assert.equal(receipt.browser[key], value, `Unsupported native-controls browser ${key}`);
    const { root } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: playerSelector,
    });
    assert.ok(nodeId, 'Actual chat video disappeared before native inspection');
    const { node } = await session.send('DOM.describeNode', { nodeId, depth: -1, pierce: true });
    const roots = panelRoots(node);
    assert.equal(
      roots.length,
      1,
      'Unsupported native controls: expected one known loading-panel shadow root',
    );
    receipt.backendNodeId = node.backendNodeId;
    const group = 'chat-video-native-readiness';
    const videoObject = await session.send('DOM.resolveNode', {
      backendNodeId: node.backendNodeId,
      objectGroup: group,
    });
    const panelObject = await session.send('DOM.resolveNode', {
      backendNodeId: roots[0].backendNodeId,
      objectGroup: group,
    });
    const observation = await session.send('Runtime.callFunctionOn', {
      objectId: videoObject.object.objectId,
      functionDeclaration: observeControls.toString(),
      arguments: [
        { objectId: panelObject.object.objectId },
        { value: playerSelector },
        { value: timeoutMs },
      ],
      objectGroup: group,
    });
    assert.ok(!observation.exceptionDetails, JSON.stringify(observation.exceptionDetails));
    controller = observation.result.objectId;
    assert.ok(controller, 'Native observer did not return a cleanup controller');
    const outcome = await session.send('Runtime.callFunctionOn', {
      objectId: controller,
      functionDeclaration: 'function() { return this.ready; }',
      awaitPromise: true,
      returnByValue: true,
    });
    assert.ok(!outcome.exceptionDetails, JSON.stringify(outcome.exceptionDetails));
    receipt.observation = outcome.result.value;
    assert.ok(receipt.observation.ok, receipt.observation.reason);
    assert.ok(await sameTarget(), 'Chat video replaced during native readiness');
  } catch (error) {
    receipt.error = String(error);
    throw error;
  } finally {
    receipt.cleanupErrors = [];
    for (const cleanup of [
      () =>
        controller &&
        session.send('Runtime.callFunctionOn', {
          objectId: controller,
          functionDeclaration: 'function() { this.cancel(); }',
        }),
      () =>
        session?.send('Runtime.releaseObjectGroup', { objectGroup: 'chat-video-native-readiness' }),
      () => session?.detach(),
      () => handle?.dispose(),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        receipt.cleanupErrors.push(String(error));
      }
    }
    await info.attach(`${name}-native-controls-readiness.json`, {
      body: JSON.stringify(receipt, null, 2),
      contentType: 'application/json',
    });
  }
  if (receipt.cleanupErrors.length)
    throw new Error(`Native-controls cleanup failed: ${receipt.cleanupErrors.join('; ')}`);
}
