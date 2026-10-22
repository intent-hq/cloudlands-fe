// Future workload only: disposable hosted container, --network none, no host sockets.
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { digest, rpcClient, roleBridge, forbidden, sanitizeEvidence } from './wire.mjs';
import { forgeFixture } from './forge.mjs';
import { Owned, identity } from './owned.mjs';
import {
  until,
  ready,
  multiplayer,
  checkpoint,
  ordinaryCreate,
  directShareGuest,
  runScenes,
} from './scenes.mjs';
const plan = JSON.parse(await readFile(new URL('./plan.json', import.meta.url)));
const grantBytes = await readFile('/inputs/execution-grant.json');
if (digest(grantBytes) !== process.argv[2]) throw new Error('separate grant digest mismatch');
const grant = JSON.parse(grantBytes);
if (
  !grant.hostedExecutionAuthorized ||
  grant.attempt !== 1 ||
  grant.image !== plan.image ||
  grant.sourceSha !== process.argv[3] ||
  grant.candidateSha256 !== plan.candidate.sha256
)
  throw new Error('execution grant subject mismatch');
const root = '/work',
  output = '/evidence';
await mkdir(`${root}/run`, { mode: 0o700 }); // exclusive invocation, no resume
const log = [];
let logBytes = 0,
  firstFailure = null;
let rejectFailure;
const failed = new Promise((_, reject) => {
  rejectFailure = reject;
});
// Failure may happen during setup, before the main race starts observing it.
failed.catch(() => {});
const record = (row) => {
  const text = JSON.stringify(sanitizeEvidence({ at: new Date().toISOString(), ...row }));
  logBytes += Buffer.byteLength(text);
  if (logBytes > plan.budgets.artifactBytes / 2) throw new Error('evidence bound');
  log.push(text);
  appendFileSync(`${output}/live-events.jsonl`, `${text}\n`, { mode: 0o600 });
};
const fail = (error) => {
  if (!firstFailure) {
    firstFailure = error;
    rejectFailure(error);
  }
};
const active = () => {
  if (firstFailure) throw firstFailure;
};
const owned = new Owned(record),
  bridges = {},
  rpcs = {},
  pages = {},
  contexts = [];
let forge,
  browser,
  status,
  sceneResults,
  completed = false;
const timer = setTimeout(
  () => fail(new Error('UI 30 minute deadline')),
  plan.budgets.uiSeconds * 1000,
);
const clean = {
  PATH: '/usr/bin:/bin',
  HOME: `${root}/home`,
  XDG_CONFIG_HOME: `${root}/home/.config`,
  XDG_CACHE_HOME: `${root}/cache`,
  XDG_DATA_HOME: `${root}/home/.local/share`,
  TMPDIR: `${root}/tmp`,
  NODE_OPTIONS: '',
  DD_TRACE_ENABLED: 'false',
  GH_CONFIG_DIR: `${root}/empty-gh`,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
};
async function udsStatus(path) {
  const socket = createConnection(path);
  socket.setTimeout(3000, () => socket.destroy(new Error('UDS status deadline')));
  await once(socket, 'connect');
  socket.write(
    `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'system.status', params: {} })}\n`,
  );
  let data = '';
  try {
    for await (const b of socket) {
      data += b.toString();
      if (data.length > 65536) throw new Error('status bound');
      if (data.includes('\n')) return JSON.parse(data.split('\n')[0]).result;
    }
  } finally {
    socket.destroy();
  }
  throw new Error('missing status response');
}
async function join(created, scope, role) {
  active();
  const rpc = await rpcClient(status.port, status.fingerprint, null, '/invite');
  try {
    const params = {
      inviteId: created.invite.id,
      secret: created.secret,
      ...(scope ? { scope } : {}),
    };
    const challenge = await rpc.request('invite.challenge', params);
    const proof = forge.prove(role, challenge.nonce);
    const joined = await rpc.request('invite.prove', {
      ...params,
      ...proof,
      nonce: challenge.nonce,
    });
    if (!joined.token || !joined.principalId)
      throw new Error('daemon did not mint principal credential');
    record({
      kind: 'real-invite-proof',
      role,
      principalId: joined.principalId,
      hostRole: joined.hostRole,
      credentialLogged: false,
    });
    return joined;
  } finally {
    rpc.close();
  }
}
async function audit() {
  if (firstFailure) throw firstFailure;
  for (const bridge of Object.values(bridges)) {
    if (bridge.frames.some((r) => r.direction === 'request' && forbidden(r.frame)))
      throw new Error('account action boundary');
  }
  const ports = [
    status.port,
    Number(new URL(forge.url).port),
    ...Object.values(bridges).map((b) => Number(new URL(b.url).port)),
  ];
  return owned.proof(process.pid, ports);
}
async function workload() {
  record({
    kind: 'workload',
    sourceSha: grant.sourceSha,
    grantSha256: digest(grantBytes),
    wrapper: await identity(process.pid),
    classification: 'NEW candidate and NEW fixtures',
  });
  for (const dir of ['home', 'home/Developer', 'cache', 'tmp', 'empty-gh', 'data', 'workspaces'])
    await mkdir(`${root}/${dir}`, { recursive: true, mode: 0o700 });
  const bytes = await readFile('/inputs/candidate/intentd'),
    binary = JSON.parse(await readFile('/inputs/candidate/binary.json'));
  const info = await lstat('/inputs/candidate/intentd');
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    digest(bytes) !== binary.sha256 ||
    bytes.length !== binary.bytes
  )
    throw new Error('candidate archive binding');
  forge = await forgeFixture(record);
  active();
  const ownerToken = randomBytes(32).toString('hex');
  await writeFile(
    `${root}/data/config.toml`,
    '[server]\nbindAddress="127.0.0.1"\n[server.wsApi]\nenabled=true\n[server.tunnel]\nenabled=false\n[model]\ndefaultProvider="mock"\n[sourceControl.gitlab]\nhost="gitlab.fixture.invalid"\n',
    { flag: 'wx', mode: 0o600 },
  );
  await owned.start(
    'candidate',
    '/inputs/candidate/intentd',
    ['serve'],
    {
      ...clean,
      INTENTD_DATA_DIR: `${root}/data`,
      INTENTD_WORKSPACES_DIR: `${root}/workspaces`,
      INTENTD_AUTH_TOKEN: ownerToken,
      INTENTD_TCP_PORT: '0',
      INTENTD_SECRETS_FILE: `${root}/data/secrets.json`,
      MOCK_AGENT_SCRIPT_PATH: '/repo/tests/member-controls/mock-acp.mjs',
      INTENTD_GITHUB_API_BASE_URI: forge.url,
      INTENTD_GITHUB_LOGIN_BASE_URI: forge.url,
      INTENTD_GITLAB_API_BASE_URI: forge.url,
    },
    root,
  );
  await until(async () => {
    try {
      status = await udsStatus(`${root}/data/intentd.sock`);
      return status.port && status.fingerprint;
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') return false;
      throw e;
    }
  }, 'private daemon listener readiness');
  rpcs.owner = await rpcClient(status.port, status.fingerprint, ownerToken);
  active();
  await rpcs.owner.request('client.hello');
  const actualOwner = await rpcs.owner.request('principal.me');
  if (actualOwner.principal?.hostRole !== 'owner') throw new Error('actual TLS owner admission');
  const catalog = await rpcs.owner.request('provider.list');
  record({ kind: 'startup-provider-discovery', catalog });
  // Deliberate unresolved prerequisite: stock invite issuance can require a tunnel address.
  // No DB edit, fake token, authority injection or fake Tailcat advertisement is used.
  const memberInvite = await rpcs.owner.request('host.invite.create', {
    pinProvider: 'github',
    pinLogin: 'member',
  });
  const member = await join(memberInvite, 'host', 'member');
  const bootstrap = await rpcs.owner.request('workspace.create', {
    title: 'guest-bootstrap',
    path: `${root}/home/Developer/guest-bootstrap`,
    isNewRepo: true,
  });
  const guestInvite = await rpcs.owner.request('workspace.invite.create', {
    workspaceId: bootstrap.workspace.id,
    pinLogin: 'guest',
    pinProvider: 'github',
  });
  const guest = await join(guestInvite, undefined, 'guest');
  const tokens = { owner: ownerToken, member: member.token, guest: guest.token };
  for (const role of ['member', 'guest']) {
    active();
    rpcs[role] = await rpcClient(status.port, status.fingerprint, tokens[role]);
    await rpcs[role].request('client.hello');
    const me = await rpcs[role].request('principal.me');
    if (me.principal?.hostRole !== role) throw new Error(`${role} actual TLS role mismatch`);
  }
  await rpcs.owner.request('workspace.delete', { workspaceId: bootstrap.workspace.id });
  for (const role of ['owner', 'member', 'guest']) {
    active();
    bridges[role] = await roleBridge({
      role,
      token: tokens[role],
      ...status,
      webRoot: '/repo/dist/web',
      record,
      fail,
    });
  }
  await audit(); // actual roles, provider and owned listeners BEFORE browser
  browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    args: ['--disable-dev-shm-usage'],
    env: clean,
  });
  const makePage = async (role, path) => {
    active();
    const context = await browser.newContext({
      locale: 'en-US',
      reducedMotion: 'reduce',
      viewport: { width: 1440, height: 1000 },
    });
    contexts.push(context);
    active();
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', (e) => {
      record({ kind: 'page-error', role, message: e.message.slice(0, 1024) });
      fail(e);
    });
    await page.goto(`${bridges[role].url}${path}`, { waitUntil: 'domcontentloaded' });
    await ready(page, bridges[role], role);
    pages[role] = page;
    await checkpoint(page, `${role}-ready`, output, record);
    await multiplayer(page, bridges[role], role);
    return page;
  };
  await makePage('member', '/workspace/new');
  const workspace = await ordinaryCreate(pages.member, bridges.member);
  record({ kind: 'ordinary-member-create', workspace });
  await audit(); // mandatory FIRST post-create proof, exactly once
  await directShareGuest(pages.member, rpcs.member, rpcs.guest, guest.principalId, workspace);
  await makePage('guest', workspace.urlPath);
  bridges.owner.hold.arm();
  await makePage('owner', workspace.urlPath);
  sceneResults = await runScenes({ pages, bridges, workspace, output, record, audit });
  await audit();
  completed = true;
}
let workloadTask;
const onCancel = () => fail(new Error('owned workload cancellation'));
process.once('SIGTERM', onCancel);
process.once('SIGINT', onCancel);
try {
  workloadTask = workload();
  await Promise.race([workloadTask, failed]);
} catch (error) {
  fail(error);
  record({
    kind: 'first-failure',
    message: error.message,
    rpcCode: error.rpc?.data?.code ?? error.rpc?.code,
    classification:
      error.rpc?.data?.code === 'tunnel-down'
        ? 'expected-narrow-transport-refusal; NOT mint/lookup/product success'
        : 'setup-or-product-refusal',
    sceneResults: sceneResults ?? 'UNRUN',
  });
} finally {
  clearTimeout(timer);
  // No UI evidence collection after an identity/containment refusal delays release.
  for (const context of contexts) await context.close().catch(fail);
  await browser?.close().catch(fail);
  for (const bridge of Object.values(bridges)) await bridge.close().catch(fail);
  for (const rpc of Object.values(rpcs)) rpc.close();
  await forge?.close().catch(fail);
  await owned.close().catch(fail);
  if (workloadTask) {
    // Closing only owned transports/contexts makes pending work reject. A task
    // that cannot settle is an incomplete cleanup, never a resumed attempt.
    await Promise.race([
      workloadTask.catch(() => {}),
      new Promise((resolve) => {
        const stop = setTimeout(() => {
          fail(new Error('workload unwind deadline'));
          resolve();
        }, 30000);
        stop.unref();
      }),
    ]);
  }
  process.off('SIGTERM', onCancel);
  process.off('SIGINT', onCancel);
  record({
    kind: 'terminal',
    completed,
    success: completed && !firstFailure,
    failure: firstFailure?.message ?? null,
    runtimeApproval: false,
  });
  await writeFile(`${output}/events.jsonl`, `${log.join('\n')}\n`, { flag: 'wx', mode: 0o600 });
  if (!completed || firstFailure) process.exitCode = 1;
}
