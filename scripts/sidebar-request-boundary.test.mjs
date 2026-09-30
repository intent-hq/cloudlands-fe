import assert from 'node:assert/strict';
import { test } from 'vitest';
import { waitForSidebarRequest } from '../test/sidebar-request-boundary.mjs';

const pending = () => new Promise(() => {});

test('a real request releases the boundary while preparation is still pending', async () => {
  await waitForSidebarRequest(Promise.resolve(), pending(), 100);
});

test('early startup failure is preserved before the request deadline', async () => {
  const failure = new Error('original startup failure');
  await assert.rejects(
    waitForSidebarRequest(pending(), Promise.resolve(failure), 100),
    (error) => error === failure,
  );
});

test('missing request has a finite deadline even if preparation never settles', async () => {
  await assert.rejects(waitForSidebarRequest(pending(), pending(), 5), /request deadline exceeded/);
});

test('unexpected preparation success without a request fails explicitly', async () => {
  await assert.rejects(
    waitForSidebarRequest(pending(), Promise.resolve(null), 100),
    /completed without/,
  );
});
