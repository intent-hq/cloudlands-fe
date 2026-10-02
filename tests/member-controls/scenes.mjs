import { expect } from '@playwright/test';
const ACTION = 15000,
  STATUS = 30000;
export const sceneIds = [
  'pending-canonical-pin',
  'cold-canonical-owner',
  'status-only-lab-order',
  'held-readmission',
  'role-share-boundaries',
  'open-share-lab-off',
];
export async function until(probe, message, timeout = STATUS) {
  await expect.poll(probe, { timeout, message }).toBeTruthy();
}
function responses(bridge, method) {
  return bridge.frames.filter((r) => r.direction === 'response' && r.request?.method === method);
}
function statusResponses(bridge) {
  return responses(bridge, 'sourceControl.authStatus').filter(
    (r) => r.request.params?.provider === 'gitlab',
  );
}
export async function ready(page, bridge, role, since = 0) {
  await page.getByTestId('app-ready').waitFor({ state: 'visible', timeout: STATUS });
  await until(
    () =>
      bridge.frames
        .slice(since)
        .some(
          (r) =>
            r.direction === 'response' &&
            r.request?.method === 'principal.me' &&
            r.frame.result?.principal?.hostRole === role,
        ),
    `fresh browser ${role} admission`,
  );
  // Trial checks actual visibility, stability and hit target without invoking it.
  await page
    .getByRole('button', { name: 'Settings', exact: true })
    .click({ trial: true, timeout: ACTION });
}
export async function command(page, label) {
  await page.keyboard.press('Control+k'); // Original keyboard action, exactly once.
  const search = page
    .getByRole('dialog', { name: 'Quick actions' })
    .getByPlaceholder('Type @ # > ~ / * to filter...');
  await search.fill(label, { timeout: ACTION });
  await page.getByText(label, { exact: true }).click({ timeout: ACTION });
}
export async function multiplayer(page, bridge, role) {
  const before = bridge.frames.length;
  await command(page, 'Enable experimental multiplayer');
  await until(
    () =>
      bridge.frames
        .slice(before)
        .some(
          (r) =>
            r.direction === 'response' &&
            r.request?.method === 'principal.me' &&
            r.frame.result?.principal?.hostRole === role,
        ),
    'ordinary lab enable refreshes current admission',
  );
}
async function share(page) {
  await page
    .getByRole('button', { name: /share workspace|share space|^share$/i })
    .click({ timeout: ACTION });
  await page.getByRole('dialog').waitFor({ timeout: ACTION });
}
export async function checkpoint(page, name, output, record) {
  const target = await page.context().newCDPSession(page);
  const info = await target.send('Target.getTargetInfo');
  await target.detach();
  const aria = await page.locator('body').ariaSnapshot({ timeout: ACTION });
  record({
    kind: 'checkpoint',
    name,
    url: page.url(),
    target: info.targetInfo,
    aria: aria.slice(0, 65536),
  });
  // Screenshot can contain an invite capability: redact that UI from the image.
  await page.screenshot({
    path: `${output}/${name}.png`,
    mask: [
      page.getByTestId('share-created-link-url'),
      page.locator('[data-testid="share-invite-url"]'),
    ],
    timeout: ACTION,
  });
}
export async function ordinaryCreate(page, bridge) {
  await page
    .getByRole('button', { name: 'New Workspace', exact: true })
    .first()
    .click({ timeout: ACTION });
  const prompt = page.getByRole('textbox', { name: /prompt|message|what/i }).first();
  await prompt.fill('Reply with MEMBER_FIXTURE_REPLY', { timeout: ACTION });
  // Do not set a path, repository, hidden provider or Redux state.
  await page
    .getByRole('button', { name: /create workspace|create space|start/i })
    .last()
    .click({ timeout: ACTION });
  await until(
    () => responses(bridge, 'workspace.create').some((r) => r.frame.result?.workspace?.id),
    'durable workspace create response',
  );
  const created = responses(bridge, 'workspace.create').at(-1).frame.result;
  const workspace = created.workspace;
  if (!workspace.id || workspace.id.startsWith('optimistic-'))
    throw new Error('no durable workspace ID');
  await page.waitForURL(new RegExp(`/workspace/${workspace.id}(?:$|[/?#])`), { timeout: STATUS });
  await page.getByText('MEMBER_FIXTURE_REPLY', { exact: true }).last().waitFor({ timeout: STATUS });
  await until(
    () =>
      responses(bridge, 'agent.create').some((r) => r.frame.result?.agent?.id) ||
      responses(bridge, 'agent.list').some((r) =>
        r.frame.result?.agents?.some((a) => a.workspaceId === workspace.id),
      ),
    'durable agent ID',
  );
  return {
    id: workspace.id,
    path: workspace.path ?? workspace.worktreePath,
    urlPath: `/workspace/${workspace.id}`,
  };
}
export async function directShareGuest(page, memberRpc, guestRpc, guestId, workspace) {
  await share(page);
  await page.getByTestId('share-existing-guest-trigger').click({ timeout: ACTION });
  await page.getByRole('option', { name: /guest/i }).click({ timeout: ACTION });
  await page.getByTestId('share-existing-guest-invite').click({ timeout: ACTION });
  const roster = await memberRpc.request('workspace.members.list', { workspaceId: workspace.id });
  if (!roster.members?.some((m) => m.principalId === guestId && m.role === 'collaborator'))
    throw new Error('ordinary Share grant missing from readback');
  const read = await guestRpc.request('workspace.get', { workspaceId: workspace.id });
  if (read.workspace?.id !== workspace.id)
    throw new Error('guest cannot read fresh shared workspace');
  await page.keyboard.press('Escape');
}
export async function runScenes({ pages, bridges, workspace, output, record, audit }) {
  const results = [];
  async function scene(id, run) {
    try {
      const detail = await run();
      await checkpoint(pages.owner, id, output, record);
      results.push({ id, status: 'observed', detail });
    } catch (error) {
      results.push({ id, status: 'failed', error: error.message });
      record({
        kind: 'scenes',
        results,
        unrun: sceneIds.filter((s) => !results.some((r) => r.id === s)),
      });
      throw error;
    }
  }
  const owner = pages.owner,
    bridge = bridges.owner;
  await scene(sceneIds[0], async () => {
    await until(() => bridge.hold.held !== null, 'genuine pending owner status response');
    await share(owner);
    const pin = owner.getByLabel(/Restrict to a GitLab user/);
    if (await pin.count()) {
      await pin.fill('member');
      await expect(owner.getByRole('button', { name: /Create invite/ })).toBeDisabled({
        timeout: ACTION,
      });
      await pin.fill('');
    }
    await expect(owner.getByRole('button', { name: /Create invite/ })).toBeEnabled({
      timeout: ACTION,
    });
    return {
      unpinnedAvailable: true,
      nonemptyPin: (await pin.count())
        ? 'observed'
        : 'UNEXERCISED: ordinary cold account-free control hidden',
    };
  });
  await scene(sceneIds[1], async () => {
    const release = bridge.hold.release();
    record({ kind: 'hold-release', ...release });
    if (release.disposition !== 'delivered-original-socket')
      throw new Error('cold status not delivered');
    const actual = statusResponses(bridge).find(
      (r) => r.socketId === release.socketId && r.frame.id === release.requestId,
    );
    if (actual?.frame.result?.host !== 'gitlab.fixture.invalid')
      throw new Error('cold canonical instance mismatch');
    if (new URL(owner.url()).pathname.includes('connections'))
      throw new Error('Connections warmed cold observation');
    return { socketId: release.socketId, host: actual.frame.result.host, beforeConnections: true };
  });
  await scene(sceneIds[2], async () => {
    const count = statusResponses(bridge).length;
    await owner.keyboard.press('Escape');
    await command(owner, 'Enable experimental GitLab');
    await command(owner, 'Disable experimental GitLab');
    if (statusResponses(bridge).length !== count)
      throw new Error('lab toggle unexpectedly initialized status');
    await audit();
    return { statusProducedBy: 'owner admission', labTriggersStatus: false };
  });
  await scene(sceneIds[3], async () => {
    bridge.hold.arm();
    const before = bridge.frames.length;
    bridge.disconnect();
    bridge.reconnect();
    await ready(owner, bridge, 'owner', before);
    await until(() => bridge.hold.held !== null, 'held status after genuine readmission');
    const held = bridge.hold.held;
    bridge.disconnect();
    // Transport closes the original socket. This does not pretend delivery to a stale saga.
    const release = bridge.hold.release();
    record({ kind: 'hold-release', ...release });
    if (release.disposition !== 'closed-origin-discard')
      throw new Error('expected original socket discard');
    if (!owner.url().endsWith(workspace.urlPath))
      throw new Error('unknown state lost intended route');
    await expect(
      owner.getByRole('button', { name: /share workspace|share space|^share$/i }),
    ).toHaveCount(0, { timeout: ACTION });
    const start = bridge.frames.length;
    bridge.reconnect();
    await ready(owner, bridge, 'owner', start);
    return { socketId: held.socketId, transportIsolation: true, deliveredStaleSaga: 'UNEXERCISED' };
  });
  await scene(sceneIds[4], async () => {
    for (const role of ['member', 'guest']) {
      if (statusResponses(bridges[role]).length)
        throw new Error(`${role} performed owner GitLab status read`);
      await expect(
        pages[role].getByRole('button', { name: /Connect GitHub|Connect GitLab/ }),
      ).toHaveCount(0, { timeout: ACTION });
    }
    await expect(
      pages.guest.getByRole('button', { name: /share workspace|share space|^share$/i }),
    ).toHaveCount(0, { timeout: ACTION });
    await share(pages.member);
    await pages.member.keyboard.press('Escape');
    await share(owner);
    return { guestWorkspaceRead: true, management: ['member', 'owner'], ownerStatusOnly: true };
  });
  await scene(sceneIds[5], async () => {
    await owner.keyboard.press('Escape');
    await command(owner, 'Enable experimental GitLab');
    await share(owner);
    // An ordinary command from an open modal may be unavailable. Never mutate the flag to reach it.
    try {
      await command(owner, 'Disable experimental GitLab');
    } catch (error) {
      throw new Error(`open-modal ordinary shortcut unavailable: ${error.message}`, {
        cause: error,
      });
    }
    await audit();
    return {
      localPreferenceRoute: 'ordinary palette',
      pinRetention: 'unexercised unless ordinary nonempty selection was reachable',
    };
  });
  record({ kind: 'scenes', results });
  return results;
}
