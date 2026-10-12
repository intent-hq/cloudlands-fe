import {
  test,
  expect,
  requests,
  reply,
  openWorkspaceClient,
  read,
  assertRow,
  subscribe,
  release,
  unsubscribeReply,
} from './workspace-client.helpers.mjs';
import { screenshotEvidence } from '../lib/live-backend.mjs';

test.describe('workspace client runtime', () => {
  test.skip(
    process.env.PARITY_WORKSPACE_CLIENT !== '1',
    'Requires coordinator-approved immutable candidate and real daemon; read-only opt-in',
  );

  test('coalesces overlapping lists and get/open, preserving actual workspace rows', async ({
    page,
    workspaceWire,
  }, testInfo) => {
    const workspaceId = await openWorkspaceClient(page);
    const start = workspaceWire.exchanges.length;
    const output = await page.evaluate(async (workspaceId) => {
      const { workspaceClient } = await import(
        new URL('/src/features/workspace/workspace-client.ts', location.href).href
      );
      const active = workspaceClient.list();
      const activeAgain = workspaceClient.list({ includeArchived: false });
      const archived = workspaceClient.list({ includeArchived: true });
      const archivedAgain = workspaceClient.list({ includeArchived: true });
      const got = workspaceClient.get(workspaceId);
      const gotAgain = workspaceClient.get(workspaceId);
      const opened = workspaceClient.open(workspaceId);
      const values = await Promise.all([
        active,
        activeAgain,
        archived,
        archivedAgain,
        got,
        gotAgain,
        opened,
      ]);
      return {
        values,
        sharedPromises: [active === activeAgain, archived === archivedAgain, got === gotAgain],
      };
    }, workspaceId);
    expect(output.sharedPromises).toEqual([true, true, true]);
    const [active, activeAgain, archived, archivedAgain, got, gotAgain, opened] = output.values;
    expect(activeAgain).toEqual(active);
    expect(archivedAgain).toEqual(archived);
    expect(gotAgain).toEqual(got);
    expect(opened).toEqual(got);
    const lists = requests(workspaceWire, 'workspace.list', start);
    expect(lists).toHaveLength(2);
    const plain = lists.find((e) => e.request.params === undefined);
    const inclusive = lists.find((e) => e.request.params?.includeArchived === true);
    expect(plain).toBeTruthy();
    expect(inclusive.request.params).toEqual({ includeArchived: true });
    for (const [rows, entry] of [
      [active, plain],
      [archived, inclusive],
    ]) {
      expect(entry.response.error).toBeUndefined();
      expect(entry.response.result.workspaces).toBeInstanceOf(Array);
      expect(rows.map((w) => w.id)).toEqual(entry.response.result.workspaces.map((w) => w.id));
      for (const [index, row] of rows.entries())
        assertRow(row, entry.response.result.workspaces[index]);
    }
    expect(active.every((w) => w.status !== 'Archived')).toBe(true);
    const get = await reply(workspaceWire, 'workspace.get', { workspaceId }, start);
    expect(got.id).toBe(workspaceId);
    assertRow(got, get.response.result.workspace);
    const freshStart = workspaceWire.exchanges.length;
    const fresh = await read(page, 'get', [workspaceId]);
    const freshReply = await reply(workspaceWire, 'workspace.get', { workspaceId }, freshStart);
    assertRow(fresh, freshReply.response.result.workspace);
    await testInfo.attach('workspace-read-coverage.json', {
      body: JSON.stringify(
        {
          workspaceId,
          activeRows: active.length,
          inclusiveRows: archived.length,
          archivedRowsObserved: archived.filter((w) => w.status === 'Archived').length,
          coalesced: ['default/false list', 'includeArchived list', 'get/get/open'],
          settledReadRefetched: true,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await screenshotEvidence(page, testInfo, 'workspace-client-runtime.png');
  });

  test('available context, token usage and browser-client reads match their actual replies', async ({
    page,
    workspaceWire,
  }, testInfo) => {
    const workspaceId = await openWorkspaceClient(page);
    expect((await read(page, 'get', [workspaceId])).id).toBe(workspaceId);
    const coverage = [];
    for (const [method, field] of [
      ['getContext', 'items'],
      ['getTokenUsage', 'tokenUsage'],
      ['getBrowserClient', 'browserClient'],
    ]) {
      const start = workspaceWire.exchanges.length;
      const result = await read(page, method, [workspaceId]);
      const entry = await reply(workspaceWire, `workspace.${method}`, { workspaceId }, start);
      const raw = entry.response.result[field];
      expect(result).toEqual(raw);
      if (method === 'getContext') {
        expect(raw).toBeInstanceOf(Array);
        for (const item of raw)
          expect(item).toMatchObject({ id: expect.any(String), type: expect.any(String) });
      }
      if (method === 'getBrowserClient') {
        expect(['default', 'workspace']).toContain(raw.source);
        if (raw.source === 'workspace') expect(raw.clientId).toEqual(expect.any(String));
        else expect(Object.hasOwn(raw, 'clientId')).toBe(false);
        if (raw.resolved !== null) expect(raw.resolved.clientId).toEqual(expect.any(String));
      }
      coverage.push({
        method,
        available: raw !== null,
        count: Array.isArray(raw) ? raw.length : undefined,
      });
    }
    await testInfo.attach('workspace-projection-coverage.json', {
      body: JSON.stringify(
        { workspaceId, coverage, nonemptyContextOrUsageRequired: false },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });

  test('receives the global snapshot, releases once with server acknowledgment, and reacquires', async ({
    page,
    workspaceWire,
  }, testInfo) => {
    const workspaceId = await openWorkspaceClient(page);
    expect((await read(page, 'get', [workspaceId])).id).toBe(workspaceId);
    const leases = [];
    for (let acquisition = 0; acquisition < 2; acquisition++) {
      const start = workspaceWire.exchanges.length;
      const consumer = await subscribe(page);
      let subscriptionId;
      try {
        const registration = await reply(workspaceWire, 'workspace.subscribe', {}, start);
        subscriptionId = registration.response.result.subscriptionId;
        expect(subscriptionId).toEqual(expect.any(String));
        expect(leases.map((l) => l.subscriptionId)).not.toContain(subscriptionId);
        await expect
          .poll(
            () =>
              workspaceWire.pushes.some(
                (p) => p.subscriptionId === subscriptionId && p.kind === 'snapshot',
              ),
            { timeout: 15_000 },
          )
          .toBe(true);
        await expect
          .poll(() => consumer.evaluate(({ snapshots }) => snapshots.length), { timeout: 15_000 })
          .toBeGreaterThan(0);
        const push = workspaceWire.pushes.find(
          (p) => p.subscriptionId === subscriptionId && p.kind === 'snapshot',
        );
        expect(push.seq).toBe(0);
        const first = await consumer.evaluate(({ snapshots }) => snapshots[0]);
        expect(first.map((w) => w.id)).toEqual(push.snapshot.map((w) => w.id));
        expect(first.map((w) => w.id)).toContain(workspaceId);
        for (const [index, row] of first.entries()) assertRow(row, push.snapshot[index]);
        await release(consumer);
        const ack = await unsubscribeReply(workspaceWire, subscriptionId);
        const callbacksAfterRelease = await consumer.evaluate(({ snapshots }) => snapshots.length);
        await read(page, 'get', [workspaceId]);
        expect(await consumer.evaluate(({ snapshots }) => snapshots.length)).toBe(
          callbacksAfterRelease,
        );
        leases.push({
          subscriptionId,
          snapshotRows: first.length,
          subscribeAck: registration.received,
          snapshotReceipt: push.received,
          unsubscribeAck: ack.received,
          result: ack.response.result,
        });
      } finally {
        await release(consumer);
        if (subscriptionId) await unsubscribeReply(workspaceWire, subscriptionId);
        await consumer.dispose();
      }
    }
    await testInfo.attach('workspace-subscription-lifetime.json', {
      body: JSON.stringify(
        {
          workspaceId,
          leases,
          evidenceLevel: 'public singleton subscriptions and real daemon acknowledgments',
          unverified: [
            'mutations',
            'authority orchestration',
            'product-route unmount',
            'changed deltas',
            'reconnect',
            'unavailable identity',
            'immediate release/late ack',
            'full workspace UI',
          ],
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });
});
