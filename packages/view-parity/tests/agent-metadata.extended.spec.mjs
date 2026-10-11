import {
  test,
  expect,
  rpc,
  openMetadata,
  existingAgent,
  acquire,
  release,
  snapshot,
  requests,
  lease,
  unsubscribed,
  wireIds,
  assertNormalized,
} from '../lib/agent-metadata.mjs';

test.describe('agent metadata runtime', () => {
  test.skip(
    process.env.PARITY_AGENT_METADATA !== '1',
    'Requires an approved immutable candidate and real daemon; read-only opt-in',
  );

  test('real agent.get normalization agrees with the independent wire projection', async ({
    page,
    metadataWire,
  }, testInfo) => {
    const workspaceId = await openMetadata(page);
    const agentId = await existingAgent(page, workspaceId);
    const start = metadataWire.exchanges.length;
    const session = await page.evaluate(
      async ({ workspaceId, agentId }) => {
        const { agentClient } = await import(
          new URL('/src/features/agent/agent-client.ts', location.href).href
        );
        return agentClient.get(agentId, workspaceId);
      },
      { workspaceId, agentId },
    );
    const reads = requests(metadataWire, 'agent.get', start);
    expect(reads).toHaveLength(1);
    expect(reads[0].request.params).toEqual({ agentId, workspaceId });
    expect(reads[0].response.error).toBeUndefined();
    assertNormalized(session, reads[0].response.result.agent);
    const independent = await rpc(page, 'agent.get', { agentId, workspaceId });
    for (const key of ['id', 'workspaceId', 'createdAt'])
      expect(session[key]).toEqual(independent.agent[key]);
    expect((await snapshot(page, workspaceId, agentId)).hydrated).toBe(false);
    await testInfo.attach('metadata-normalization.json', {
      body: JSON.stringify(
        {
          agentId,
          workspaceId,
          checked:
            'canonical client result versus raw daemon AgentLite; separate real identity read',
          transcriptHydration: 'not exercised',
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });

  test('shared consumers coalesce reads and leases, release once, and reacquire real metadata', async ({
    page,
    metadataWire,
  }, testInfo) => {
    const workspaceId = await openMetadata(page);
    const agentId = await existingAgent(page, workspaceId);
    expect((await snapshot(page, workspaceId, agentId)).workspace?.agentsLoaded).not.toBe(true);
    const start = metadataWire.exchanges.length;
    const consumers = await acquire(page, workspaceId, agentId, 2);
    let firstLease;
    let secondLease;
    try {
      firstLease = await lease(metadataWire, workspaceId, start);
      await expect
        .poll(async () => (await snapshot(page, workspaceId, agentId)).hydrated, {
          timeout: 15_000,
        })
        .toBe(true);
      const reads = requests(metadataWire, 'agent.get', start);
      expect(reads).toHaveLength(1);
      expect(reads[0].request.params).toEqual({ agentId, workspaceId });
      expect(reads[0].response.error).toBeUndefined();
      expect(requests(metadataWire, 'agent.subscribe', start)).toHaveLength(1);
      await expect
        .poll(async () =>
          (await snapshot(page, workspaceId, agentId)).workspace?.agentIds.slice().sort(),
        )
        .toEqual(wireIds(metadataWire, firstLease));
      const state = await snapshot(page, workspaceId, agentId);
      expect(state.workspace.agentsLoaded).toBe(true);
      expect(state.workspaceId).toBe(workspaceId);
      expect(state.sessionIds).toContain(agentId);
      expect(state.workspace.agentIds).toContain(agentId);
      expect(state.rows.every((row) => state.sessionIds.includes(row.id))).toBe(true);
      expect(state.session.messages).toEqual([]);
      for (const key of ['id', 'workspaceId', 'createdAt'])
        expect(state.session[key]).toEqual(reads[0].response.result.agent[key]);
      await release(consumers, 0);
      // A real read/ack provides an observation boundary after the synchronous public release.
      await rpc(page, 'agent.get', { agentId, workspaceId });
      expect(
        requests(metadataWire, 'events.unsubscribe').filter(
          (e) => e.request.params?.subscriptionId === firstLease,
        ),
      ).toEqual([]);
      await release(consumers, 1);
      const unsubscribeResult = await unsubscribed(metadataWire, firstLease);
      const restart = metadataWire.exchanges.length;
      const reacquired = await acquire(page, workspaceId, agentId);
      try {
        secondLease = await lease(metadataWire, workspaceId, restart);
        expect(secondLease).not.toBe(firstLease);
        await expect
          .poll(() => requests(metadataWire, 'agent.get', restart).filter((e) => e.response).length)
          .toBe(1);
        await expect
          .poll(async () =>
            (await snapshot(page, workspaceId, agentId)).workspace?.agentIds.includes(agentId),
          )
          .toBe(true);
      } finally {
        await release(reacquired);
        if (secondLease) await unsubscribed(metadataWire, secondLease);
        await reacquired.dispose();
      }
      await testInfo.attach('metadata-lease-lifecycle.json', {
        body: JSON.stringify(
          {
            workspaceId,
            agentId,
            firstLease,
            secondLease,
            unsubscribeResult,
            evidenceLevel: 'public module acquire/release and real daemon acknowledgements',
            unrun: [
              'actual feature-view unmount',
              'late response after release',
              'same-document reconnect',
              'identity revocation',
              'transcript retention',
              'model/effort mutations',
            ],
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    } finally {
      await release(consumers);
      if (firstLease) await unsubscribed(metadataWire, firstLease);
      await consumers.dispose();
    }
  });

  test('an actual empty workspace seeds an empty index without clearing its nonempty sibling', async ({
    page,
    metadataWire,
  }, testInfo) => {
    const emptyId = process.env.PARITY_AGENT_EMPTY_WORKSPACE_ID;
    test.skip(!emptyId, 'No real empty workspace supplied; do not create or fabricate one');
    const workspaceId = await openMetadata(page);
    expect(emptyId).not.toBe(workspaceId);
    expect((await rpc(page, 'workspace.get', { workspaceId: emptyId })).workspace.id).toBe(emptyId);
    const agentId = await existingAgent(page, workspaceId);
    const nonempty = await acquire(page, workspaceId, agentId);
    let empty;
    let nonemptyLease;
    let emptyLease;
    try {
      nonemptyLease = await lease(metadataWire, workspaceId);
      await expect
        .poll(async () => (await snapshot(page, workspaceId, agentId)).workspace?.agentsLoaded)
        .toBe(true);
      expect((await snapshot(page, emptyId)).workspace?.agentsLoaded).not.toBe(true);
      empty = await acquire(page, emptyId);
      emptyLease = await lease(metadataWire, emptyId);
      const firstSnapshot = metadataWire.pushes.find(
        (p) => p.subscriptionId === emptyLease && p.kind === 'snapshot',
      );
      expect(
        firstSnapshot.snapshot,
        'Empty acceptance requires a genuinely empty daemon snapshot',
      ).toEqual([]);
      await expect
        .poll(async () => (await snapshot(page, emptyId)).workspace?.agentsLoaded)
        .toBe(true);
      expect((await snapshot(page, emptyId)).workspace.agentIds).toEqual([]);
      expect((await snapshot(page, workspaceId, agentId)).workspace.agentIds).toContain(agentId);
      await release(empty);
      await unsubscribed(metadataWire, emptyLease);
      expect((await snapshot(page, workspaceId, agentId)).workspace.agentIds).toContain(agentId);
      await testInfo.attach('metadata-empty-workspace.json', {
        body: JSON.stringify(
          { workspaceId, emptyId, nonemptyLease, emptyLease, snapshot: firstSnapshot.snapshot },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    } finally {
      if (empty) {
        await release(empty);
        if (emptyLease) await unsubscribed(metadataWire, emptyLease);
        await empty.dispose();
      }
      await release(nonempty);
      if (nonemptyLease) await unsubscribed(metadataWire, nonemptyLease);
      await nonempty.dispose();
    }
  });

  test.skip('actual view unmount, late reply, reconnect and identity transition fencing', () => {
    // Requires real owning view/root and admitted identity transitions. No duplicate
    // root startup, private saga cancellation, fake events or test-only product APIs.
  });
  test.skip('disposable model and effort queue acknowledgements including null Auto', () => {
    // Requires coordinator review of the concrete owned-resource lifecycle first.
    // Never change an existing user agent or infer mutation acceptance from reads.
  });
});
