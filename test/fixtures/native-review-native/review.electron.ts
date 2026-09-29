/** Five finite actual-client cases against the separately attributed owned driver. */
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { createWriteStream, writeFileSync } from 'node:fs';
import {
  copyFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  lstat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';
import type { Fixture, Ready, WireRecord } from './main';
import type {
  NativeReviewInput,
  NativeReviewObservation,
  NativeReviewPreparedView,
  NativeReviewTextCommand,
} from '../../../src/shared/types/native-review-operation';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const evidence = process.env.NATIVE_REVIEW_EVIDENCE_DIR;
const executable = process.env.NATIVE_REVIEW_DRIVER;
const source = process.env.NATIVE_REVIEW_DRIVER_SOURCE;
if (!evidence || !executable || !source)
  throw new Error('Explicit evidence, pinned executable and frozen source required');
const executableHash = '5bed0a98e35e3e61348408bb4cc748e1ccb6dfb435bc11d14b2afc40398753d8';
const identity = {
  sourceCommit: '9c412560c616b6b852d702776e2732a35ba6e1f7',
  sourceTree: 'df4d07af4992edcfc49e7f6632e0c933bdc17fe5',
  executableSha256: executableHash,
  sourceSha256: '',
};
const groups = [
  ['01 routing and explicit prepared plans', ['frontend']],
  ['02 member guest and immutable claims', ['frontend', 'held-stop']],
  ['03 original history and authority retirement', ['frontend', 'held-stop']],
  ['04 admitted work and document socket lifetime', ['frontend', 'held-stop']],
  ['05 uncertain original POST without replay', ['frontend']],
] as const;
let bundle: string;
const python = '/usr/bin/python3';
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const record = (dir: string, name: string, value: unknown) =>
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const environment = (home: string) => ({
  PATH: '/usr/bin:/bin',
  HOME: home,
  XDG_CONFIG_HOME: join(home, 'config'),
  XDG_CACHE_HOME: join(home, 'cache'),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  DD_TRACE_ENABLED: 'false',
  RUST_LOG: 'error',
  INTENTD_TEST_KEEP_TMP: '1',
});
const renderer = `
import { LiveWorkspacesClient } from '${join(root, 'src/lib/client/live/live-workspaces-client.ts')}';
const client = new LiveWorkspacesClient(); const sessions = new Map(); const work = new Map(); let demand = 0; let closeRead = () => {};
window.native = { results: {}, errors: {}, retirements: [], current: null,
 async begin(key, input) { const session = await client.beginNativeReview({attemptId: key,root:input.review.root,admission:'original-fixture-document',hostContext:'original-fixture-host'},input,kind=>this.retirements.push({key,kind})); sessions.set(key,session); return session.preview; },
 start(key,command={}) { const promise = sessions.get(key).confirm(command); work.set(key,promise); promise.then(value=>this.results[key]=value,error=>this.errors[key]=String(error)); },
 async confirm(key,command={}) { const value=await sessions.get(key).confirm(command); this.results[key]=value; return value; },
 async reconcile(key) { const value=await sessions.get(key).reconcile(); this.results[key]=value; return value; },
 async release(key) { await sessions.get(key).release(); },
 async read(workspaceId) { closeRead(); this.current=null; return new Promise((resolve,reject)=> { client.observeRepositoryContext({workspaceId,binding:'fixture-read',requestId:String(++demand)}, update=> {if(update.type==='received'){this.current=update.response.context;resolve(update);} else if(update.type==='unavailable') reject(new Error('context unavailable')); else if(update.type==='retired')this.current=null;}).then(stop=>closeRead=stop,reject); }); },
 async quiesce() { await Promise.allSettled([...work.values()]); },
 async close() { closeRead(); await Promise.allSettled([...sessions.values()].map(s=>s.release())); }
};
`;
// Node/libuv stdio "pipe" is a socketpair. This controller owns a genuine
// anonymous pipe and the original supervisor Child; its wait is not a native receipt.
const pipeController = String.raw`
import hashlib,json,os,pathlib,selectors,stat,subprocess,sys,threading
root=pathlib.Path(sys.argv[2]);child=None;writer=None;waiter=None;failure=None
done=threading.Event();wait_result={};sequence=0;sent_bytes=0
context={'version':1,'runId':sys.argv[3],'descriptorSha256':sys.argv[4],'executableSha256':sys.argv[5]}
os.set_blocking(1,False)

def record(kind,details):
    global sequence,sent_bytes
    value={**context,'kind':kind,'sequence':sequence,'details':details};sequence+=1
    data=(json.dumps(value,separators=(',',':'))+'\n').encode()
    if len(data)>2048 or sent_bytes+len(data)>8192:raise RuntimeError('metadata bound')
    with (root/('controller-'+kind+'.json')).open('xb') as out:
        os.chmod(out.name,0o600);out.write(data);out.flush();os.fsync(out.fileno())
    sent_bytes+=len(data)
    if os.write(1,data)!=len(data):raise RuntimeError('partial metadata output')

def wait_original():
    try:
        code=child.wait()
        wait_result.update(returnCode=code,code=code if code>=0 else None,signal=-code if code<0 else None,waitedOriginalChild=True)
    except BaseException as error:
        wait_result.update(waitedOriginalChild=False,error=type(error).__name__)
    finally:done.set()

selector=selectors.DefaultSelector();selector.register(0,selectors.EVENT_READ)
try:
    data=(root/'descriptor.json').read_bytes()
    if len(data)>8192 or hashlib.sha256(data).hexdigest()!=context['descriptorSha256']:raise RuntimeError('descriptor identity')
    descriptor=json.loads(data)
    if descriptor['runId']!=context['runId'] or descriptor['executableSha256']!=context['executableSha256']:raise RuntimeError('run identity')
    if not selector.select(5) or os.read(0,1)!=b'R':raise RuntimeError('controller bootstrap missing')
    with (root/'driver.log').open('xb') as log:
        os.chmod(log.name,0o600)
        child=subprocess.Popen([sys.argv[1],'--ignored','--exact','native_review_fixture_driver','--nocapture','--test-threads=1'],stdin=subprocess.PIPE,stdout=log,stderr=log,close_fds=True,bufsize=0)
        writer=child.stdin
        waiter=threading.Thread(target=wait_original);waiter.start()
        fifo=stat.S_ISFIFO(os.fstat(writer.fileno()).st_mode)
        inheritable=os.get_inheritable(writer.fileno())
        if not fifo or inheritable:raise RuntimeError('private anonymous pipe unavailable')
        record('allocation',{'supervisorPid':child.pid,'controllerPid':os.getpid(),'writerIsFifo':fifo,'writerInheritable':inheritable})
        if writer.write(b'R')!=1:raise RuntimeError('bootstrap write incomplete')
        while not done.is_set():
            if os.fstat(log.fileno()).st_size>8388608:raise RuntimeError('driver log bound')
            if selector.select(.05):
                value=os.read(0,1)
                if value:raise RuntimeError('unexpected controller lifetime data')
                raise RuntimeError('controller EOF before supervisor wait')
except BaseException as error:
    failure=str(error)[:512]
finally:
    if failure and writer and not writer.closed:
        try:writer.close()
        except OSError as error:failure+='; writer close '+type(error).__name__
    if waiter:
        done.wait();waiter.join()
        try:record('supervisor-wait',{'supervisorPid':child.pid,**wait_result,'failure':failure})
        except OSError as error:failure=failure or 'wait receipt output '+type(error).__name__
    if writer and not writer.closed:
        try:writer.close()
        except OSError as error:failure=failure or 'writer close '+type(error).__name__
    selector.close()
    success=not failure and wait_result.get('waitedOriginalChild') is True and wait_result.get('returnCode')==0
    try:record('helper-result',{'success':success,'failure':failure,'nativeCompletion':'not asserted'})
    except OSError:success=False
sys.exit(0 if success else 1)
`;
const actualFactory = join(root, 'src/features/backend/main/backend-connection.ts');
const socketShim = `import {createBackendSocket as original} from ${JSON.stringify(actualFactory + '?original')};
export * from ${JSON.stringify(actualFactory + '?original')};
export function createBackendSocket(...args) { const socket=Reflect.apply(original,this,args); const result=globalThis.nativeReviewSocketObserver(socket,args[0]); if(result!==socket)throw new Error('Observer replaced original Duplex'); return socket; }`;
const alias = ['shared', 'features', 'lib', 'store'].map((part) => ({
  find: `$${part}`,
  replacement: join(root, 'src', part),
}));
const modules = (label: string): Plugin => ({
  name: 'pin-executed-inputs',
  async generateBundle(_options, output) {
    const ids = new Set(
      Object.values(output).flatMap((chunk) =>
        chunk.type === 'chunk' ? Object.keys(chunk.modules) : [],
      ),
    );
    const inputs = await Promise.all(
      [...ids].sort().map(async (id) => {
        const virtual =
          id === '\0native-renderer'
            ? renderer
            : id === '\0native-socket-observer'
              ? socketShim
              : null;
        if (virtual !== null) return { id, sha256: hash(virtual), source: virtual };
        try {
          return { id, sha256: hash(await readFile(id)) };
        } catch {
          return { id, virtual: id.startsWith('\0') };
        }
      }),
    );
    record(evidence!, `${label}-inputs`, inputs);
    if (label === 'main.mjs') {
      const clientId = join(root, 'src/features/backend/main/json-rpc-client.ts');
      const wrapperId = '\0native-socket-observer';
      const client = this.getModuleInfo(clientId);
      const wrapper = this.getModuleInfo(wrapperId);
      const original = this.getModuleInfo(actualFactory);
      const rendered = [clientId, wrapperId, actualFactory].map((id) => {
        const chunk = Object.values(output).find(
          (item) => item.type === 'chunk' && item.modules[id]?.renderedLength > 0,
        );
        if (!chunk || chunk.type !== 'chunk') throw new Error(`Missing rendered module: ${id}`);
        const module = chunk.modules[id];
        if (!module.code) throw new Error(`Rendered module has no code: ${id}`);
        return {
          id,
          chunk: chunk.fileName,
          chunkHash: hash(chunk.code),
          renderedHash: hash(module.code),
          renderedLength: module.renderedLength,
          renderedExports: module.renderedExports,
          ...(id === wrapperId ? { code: module.code } : {}),
        };
      });
      if (
        !client?.isIncluded ||
        !wrapper?.isIncluded ||
        !original?.isIncluded ||
        !client.importedIds.includes(wrapperId) ||
        client.importedIds.includes(actualFactory) ||
        !wrapper.importers.includes(clientId) ||
        !wrapper.importedIds.includes(actualFactory) ||
        wrapper.importedIds.some((id) => id !== actualFactory) ||
        !original.importers.includes(wrapperId) ||
        !rendered[1].renderedExports.includes('createBackendSocket') ||
        !rendered[2].renderedExports.includes('createBackendSocket') ||
        inputs.find((input) => input.id === wrapperId)?.sha256 !== hash(socketShim)
      )
        throw new Error('Original client -> rendered observer -> factory relation missing');
      const wrapperChunk = output[rendered[1].chunk];
      const clientChunk = output[rendered[0].chunk];
      if (wrapperChunk.type !== 'chunk' || clientChunk.type !== 'chunk')
        throw new Error('Rendered client/observer chunks missing');
      const normalize = (node: unknown) =>
        JSON.stringify(node, (key, value) =>
          ['start', 'end', 'loc', 'raw'].includes(key) ? undefined : value,
        );
      const functions = this.parse(rendered[1].code!).body.filter(
        (node) => node.type === 'FunctionDeclaration',
      );
      if (functions.length !== 1 || !functions[0].id)
        throw new Error('Expected one rendered observer function');
      const wrapperFunction = functions[0];
      if (
        !this.parse(wrapperChunk.code).body.some(
          (node) =>
            node.type === 'FunctionDeclaration' &&
            node.id?.name === wrapperFunction.id!.name &&
            normalize(node) === normalize(wrapperFunction),
        )
      )
        throw new Error('Observer function absent from final emitted AST');
      const factoryAssignments = (code: string) => {
        const found: string[] = [];
        let nodes = 0;
        const visit = (node: any) => {
          if (!node || typeof node !== 'object') return;
          if (++nodes > 1_000_000) throw new Error('Emitted AST bound');
          if (
            node.type === 'AssignmentExpression' &&
            node.left?.type === 'MemberExpression' &&
            node.left.object?.type === 'ThisExpression' &&
            node.left.property?.name === 'socketFactory' &&
            node.right?.type === 'LogicalExpression' &&
            node.right.operator === '??' &&
            node.right.right?.name === wrapperFunction.id!.name
          )
            found.push(normalize(node));
          for (const value of Object.values(node))
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === 'object') visit(value);
        };
        visit(this.parse(code));
        return found;
      };
      const expectedAssignments = factoryAssignments(clientChunk.modules[clientId].code!);
      const emittedAssignments = factoryAssignments(clientChunk.code);
      if (expectedAssignments.length !== 1 || !emittedAssignments.includes(expectedAssignments[0]))
        throw new Error('Original client does not select the emitted observer factory');
      const graph = { client, wrapper, original };
      record(evidence!, 'observer-build-preflight', {
        wrapperSourceHash: hash(socketShim),
        wrapperFunctionAstHash: hash(normalize(wrapperFunction)),
        clientFactoryAssignmentAstHash: hash(expectedAssignments[0]),
        graph: Object.fromEntries(
          Object.entries(graph).map(([name, info]) => [
            name,
            { id: info.id, importedIds: info.importedIds, importers: info.importers },
          ]),
        ),
        rendered,
        qualification: 'Build import relation only; runtime allocation/forwarding still required',
      });
    }
  },
});

test.beforeAll(async () => {
  await mkdir(evidence!, { recursive: true, mode: 0o700 });
  const artifact = await lstat(executable!);
  expect({
    regular: artifact.isFile(),
    bytes: artifact.size,
    mode: artifact.mode & 0o777,
    sha: hash(await readFile(executable!)),
  }).toEqual({ regular: true, bytes: 266605984, mode: 0o555, sha: executableHash });
  identity.sourceSha256 = hash(
    await readFile(join(source!, 'crates/intentd/tests/e2e_native_review_wire.rs')),
  );
  record(evidence!, 'frozen-cases', {
    pipeControllerHash: hash(pipeController),
    python: {
      path: python,
      resolved: await realpath(python),
      sha256: hash(await readFile(python)),
    },
    groups,
    workers: 1,
    retries: 0,
    driverLifetimeSeconds: 150,
    groupBudgetMs: 180000,
    identity,
    executable,
    source,
    socketShimHash: hash(socketShim),
    rendererHash: hash(renderer),
  });
  bundle = await mkdtemp(join(tmpdir(), 'native-review-electron-code-'));
  await symlink(await realpath(join(root, 'node_modules')), join(bundle, 'node_modules'));
  await writeFile(join(bundle, 'pipe-controller.py'), pipeController, { mode: 0o600 });
  await writeFile(join(evidence!, 'pipe-controller.py'), pipeController, { mode: 0o600 });
  const shim: Plugin = {
    name: 'observe-real-factory',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id === actualFactory + '?original') return actualFactory;
      if (importer?.endsWith('/json-rpc-client.ts') && id === './backend-connection')
        return '\0native-socket-observer';
    },
    load(id) {
      if (id === '\0native-socket-observer') return socketShim;
    },
  };
  for (const [entry, name] of [
    ['test/fixtures/native-review-native/main.ts', 'main.mjs'],
    ['src/preload/index.ts', 'preload.cjs'],
  ]) {
    await build({
      configFile: false,
      logLevel: 'error',
      resolve: { alias },
      plugins: [shim, modules(name)],
      build: {
        target: 'es2022',
        ssr: join(root, entry),
        outDir: bundle,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: name.endsWith('.cjs') ? 'cjs' : 'es', entryFileNames: name },
        },
      },
    });
    await copyFile(join(bundle, name), join(evidence!, name));
  }
  await build({
    configFile: false,
    logLevel: 'error',
    resolve: { alias },
    plugins: [
      modules('renderer'),
      {
        name: 'inline-native-facade',
        resolveId(id) {
          if (id === 'native-renderer') return '\0native-renderer';
        },
        load(id) {
          if (id === '\0native-renderer') return renderer;
        },
      },
    ],
    build: {
      outDir: bundle,
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        input: 'native-renderer',
        output: { format: 'es', entryFileNames: 'renderer.js', inlineDynamicImports: true },
      },
    },
  });
  await copyFile(join(bundle, 'renderer.js'), join(evidence!, 'renderer.js'));
  record(
    evidence!,
    'compiled',
    await Promise.all(
      ['main.mjs', 'preload.cjs', 'renderer.js'].map(async (name) => ({
        name,
        sha256: hash(await readFile(join(bundle, name))),
      })),
    ),
  );
});
test.afterAll(async () => {
  if (bundle) await rm(bundle, { recursive: true, force: true });
});

function control(ready: Ready, action: unknown): Promise<any> {
  const request = { version: 1, runId: ready.runId, id: randomUUID(), action };
  const bytes = JSON.stringify(request) + '\n';
  if (Buffer.byteLength(bytes) > 8192) throw new Error('Control frame bound');
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection(ready.control);
    let input = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Original control response deadline'));
    }, 10000);
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once('connect', () => socket.write(bytes));
    socket.on('data', (chunk) => {
      input += chunk.toString();
      if (input.length > 8192) {
        clearTimeout(timer);
        socket.destroy();
        reject(new Error('Control reply bound'));
        return;
      }
      if (!input.includes('\n')) return;
      clearTimeout(timer);
      socket.end();
      try {
        const value = JSON.parse(input.slice(0, input.indexOf('\n')));
        if (value.id !== request.id || value.error) throw new Error(JSON.stringify(value));
        resolvePromise(value.result);
      } catch (error) {
        reject(error);
      }
    });
  });
}
async function waitFile(path: string, child: ChildProcess) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('Original driver exited before ready');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error('Original driver ready deadline');
}
type Main = Fixture;
const main = <T>(app: ElectronApplication, fn: (fixture: Main) => T) =>
  app.evaluate(({ app: _app }, code) => {
    const fixture = (globalThis as unknown as { nativeReviewFixture: Main }).nativeReviewFixture;
    return (0, eval)(`(${code})`)(fixture);
  }, fn.toString()) as Promise<Awaited<T>>;
const pageFor = async (app: ElectronApplication, key: string) => {
  await expect
    .poll(() =>
      app
        .windows()
        .find((page) => page.url().endsWith('/' + key))
        ?.url(),
    )
    .toContain('/' + key);
  const page = app.windows().find((value) => value.url().endsWith('/' + key))!;
  await page.waitForFunction(() => !!(window as any).native);
  return page;
};
const begin = (
  page: Page,
  key: string,
  input: NativeReviewInput,
): Promise<NativeReviewPreparedView> =>
  page.evaluate(({ key, input }) => (window as any).native.begin(key, input), { key, input });
const confirm = (
  page: Page,
  key: string,
  command: NativeReviewTextCommand = {},
): Promise<NativeReviewObservation> =>
  page.evaluate(({ key, command }) => (window as any).native.confirm(key, command), {
    key,
    command,
  });
const reconcile = (page: Page, key: string): Promise<NativeReviewObservation> =>
  page.evaluate((key) => (window as any).native.reconcile(key), key);
const inputFor = (
  ready: Ready,
  host: number,
  registered = false,
  combined = false,
): NativeReviewInput => ({
  workspaceId: ready.hosts[host].workspaceId,
  action: combined ? 'commit' : 'create-pr',
  ...(combined
    ? { options: { stageUnstaged: false, pushAfterCommit: true, createPRAfterPush: true } }
    : {}),
  review: {
    root: registered
      ? {
          kind: 'registered',
          workspaceId: ready.hosts[host].workspaceId,
          gitRootId: ready.hosts[host].registeredRootId,
        }
      : { kind: 'primary', workspaceId: ready.hosts[host].workspaceId },
    choice: {
      kind: 'explicitTarget',
      target: {
        provider: 'gitlab',
        instanceBaseUrl: ready.hosts[host].instance,
        projectPath: 'group/project',
      },
    },
    targetBranch: 'trunk',
    pushRemote: 'forge',
  },
});
const settled = (value: NativeReviewObservation, expected: 'created' | 'reused' | 'uncertain') => {
  expect(value.execute?.state).toBe('settled');
  expect(value.execute?.reviewExecution?.outcome.status).toBe(expected);
  return value.execute!.reviewExecution!;
};
async function arm(ready: Ready, operationId: string, method: 'GET' | 'POST', mode = 'hold') {
  const status = await control(ready, { command: 'barrierStatus', host: 0 });
  const counts = status.counts ?? {};
  const barrier = {
    id: randomUUID(),
    operationId,
    method,
    route: 'mergeRequests',
    ordinal: (counts[`${method}:mergeRequests`] ?? 0) + 1,
    mode,
    holdSeconds: 30,
  };
  await control(ready, { command: 'armProvider', host: 0, barrier });
  return barrier;
}
async function entered(ready: Ready, id: string) {
  let last: any;
  await expect
    .poll(async () => {
      last = await control(ready, { command: 'barrierStatus', host: 0 });
      return (
        last.barriers?.some((barrier: any) => barrier.id === id && barrier.entered) &&
        last.events?.some((event: any) => event.authenticated && event.phase === 'entered')
      );
    })
    .toBe(true);
  return last;
}

function stopInventory(source: ReturnType<Fixture['evidence']>) {
  if (source.faults.length || source.records.length > 1024)
    throw new Error('Original stop observation missing or overflowed');
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const sameRoot = (a: any, b: any) =>
    a?.workspaceId === b?.workspaceId && a?.kind === b?.kind && a?.gitRootId === b?.gitRootId;
  const issued = source.records.filter(
    (row) => row.direction === 'request' && row.envelope.method === 'accept-changes.execute',
  );
  if (issued.length > 16) throw new Error('Original stop request bound');
  const rows = issued.map((row, index) => {
    const request = {
      host: row.host,
      operationId: row.envelope.params?.review?.operationId,
      socketId: row.socketId,
      requestId: row.envelope.id,
    };
    if (
      ![0, 1].includes(request.host) ||
      typeof request.operationId !== 'string' ||
      !uuid.test(request.operationId) ||
      !uuid.test(request.socketId) ||
      !(
        typeof request.requestId === 'string' ||
        (Number.isSafeInteger(request.requestId) && request.requestId >= 0)
      ) ||
      source.allocations.filter(
        (allocation) =>
          allocation.host === request.host && allocation.socketId === request.socketId,
      ).length !== 1 ||
      issued
        .slice(0, index)
        .some(
          (previous) =>
            (previous.host === request.host &&
              previous.envelope.params?.review?.operationId === request.operationId) ||
            (previous.socketId === request.socketId && previous.envelope.id === request.requestId),
        )
    )
      throw new Error('Original stop request identity missing or duplicated');
    const sameSocket = (candidate: WireRecord) =>
      candidate.host === request.host && candidate.socketId === request.socketId;
    const responses = source.records.filter(
      (candidate) =>
        sameSocket(candidate) &&
        candidate.direction === 'response' &&
        candidate.envelope.id === request.requestId,
    );
    if (responses.length > 1) throw new Error('Ambiguous original stop response');
    const originalResponse = responses[0]?.envelope ?? null;
    // Same strict settled predicate as the pinned driver's driver_completed.
    const settled = (envelope: any) =>
      envelope?.jsonrpc === '2.0' &&
      !Object.hasOwn(envelope, 'error') &&
      envelope.result?.state === 'settled' &&
      envelope.result.operationId === request.operationId &&
      envelope.result.reviewExecution?.requestId === request.operationId;
    const history =
      source.records.findLast(
        (candidate, position) =>
          sameSocket(candidate) &&
          candidate.direction === 'response' &&
          settled(candidate.envelope) &&
          source.records
            .slice(source.records.indexOf(row) + 1, position)
            .some(
              (query) =>
                sameSocket(query) &&
                query.direction === 'request' &&
                query.envelope.id === candidate.envelope.id &&
                query.envelope.method === 'accept-changes.reconcile' &&
                query.envelope.params?.operationId === request.operationId &&
                sameRoot(query.envelope.params?.root, row.envelope.params.review.root),
            ),
      )?.envelope ?? null;
    const preparations = (source.ipcRecords as Record<string, any>[]).filter(
      (ipc) =>
        ipc.channel === 'backend:native-review:prepare' &&
        ipc.main === true &&
        ipc.result?.ok === true &&
        ipc.result.result?.preview?.reviewPreparation?.operationId === request.operationId &&
        sameRoot(ipc.result.result.preview.reviewPreparation.root, row.envelope.params.review.root),
    );
    const preparation = preparations.length === 1 ? preparations[0] : null;
    const handlers = preparation
      ? (source.ipcRecords as Record<string, any>[]).filter(
          (ipc) =>
            ipc.channel === 'backend:native-review:execute' &&
            ipc.main === true &&
            ipc.sender === preparation.sender &&
            ipc.frame === preparation.frame &&
            ipc.args?.[0]?.id === preparation.result.result.id &&
            sameRoot(ipc.args[0].root, row.envelope.params.review.root),
        )
      : [];
    // A retired renderer can receive an unavailable IPC result after a genuine wire settlement.
    // Handler completion proves only the join; the original socket proves native completion.
    const joined =
      source.pending === 0 &&
      handlers.length > 0 &&
      handlers.every((ipc) => Object.hasOwn(ipc, 'result') || Object.hasOwn(ipc, 'rejected'));
    return {
      request,
      originalResponse,
      history,
      joined,
      complete: joined && (settled(originalResponse) || settled(history)),
    };
  });
  return { rows, pending: rows.filter((row) => !row.complete).map((row) => row.request) };
}

async function withDriver(
  index: number,
  body: (context: {
    dir: string;
    ready: Ready;
    app: ElectronApplication;
    a: Page;
    b: Page;
    packet(name: string, value?: unknown): Promise<any>;
  }) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), `nrv-${index + 1}-`));
  await chmod(dir, 0o700);
  record(evidence!, `group-${index + 1}-location`, { dir });
  await mkdir(join(dir, 'runtime'), { mode: 0o700 });
  const home = join(dir, 'home');
  await mkdir(home, { mode: 0o700 });
  const runId = randomUUID();
  record(dir, 'descriptor', {
    version: 1,
    runId,
    ...identity,
    lifetimeSeconds: 150,
    scenarios: groups[index][1],
  });
  const descriptorHash = hash(await readFile(join(dir, 'descriptor.json')));
  const child = spawn(
    python,
    [join(bundle, 'pipe-controller.py'), executable!, dir, runId, descriptorHash, executableHash],
    {
      cwd: source!,
      env: { ...environment(home), INTENT_REVIEW_DRIVER_DESCRIPTOR: join(dir, 'descriptor.json') },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const lifecycle: Array<Record<string, any>> = [];
  let lifecycleFault: string | null = null;
  let metadata = '';
  let metadataBytes = 0;
  let stderr = '';
  const failLifecycle = (reason: string) => {
    lifecycleFault ??= reason;
    child.stdin!.end();
  };
  child.stdout!.on('data', (chunk: Buffer) => {
    metadataBytes += chunk.length;
    if (metadataBytes > 8192) return failLifecycle('controller metadata bound');
    metadata += chunk.toString('utf8');
    while (metadata.includes('\n')) {
      const end = metadata.indexOf('\n');
      const line = metadata.slice(0, end);
      metadata = metadata.slice(end + 1);
      try {
        const value = JSON.parse(line);
        if (
          Buffer.byteLength(line) > 2048 ||
          Object.keys(value).sort().join(',') !==
            'descriptorSha256,details,executableSha256,kind,runId,sequence,version' ||
          value.version !== 1 ||
          value.runId !== runId ||
          value.descriptorSha256 !== descriptorHash ||
          value.executableSha256 !== executableHash ||
          value.sequence !== lifecycle.length ||
          value.kind !== ['allocation', 'supervisor-wait', 'helper-result'][lifecycle.length] ||
          !value.details ||
          typeof value.details !== 'object' ||
          Array.isArray(value.details)
        )
          throw new Error('invalid lifecycle message');
        lifecycle.push(value);
      } catch {
        failLifecycle('controller metadata validation');
      }
    }
  });
  child.stderr!.on('data', (chunk: Buffer) => {
    if (Buffer.byteLength(stderr) + chunk.length > 8192)
      return failLifecycle('controller stderr bound');
    stderr += chunk.toString('utf8');
  });
  child.stdin!.on('error', () => failLifecycle('controller channel write failed'));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolvePromise) => {
      child.once('error', () => failLifecycle('controller spawn failed'));
      child.once('close', (code, signal) => resolvePromise({ code, signal }));
    },
  );
  child.stdin!.write('R');
  record(dir, 'allocation', { helperPid: child.pid, runId, executable, descriptorHash });
  let app: ElectronApplication | undefined;
  let ready: Ready | undefined;
  let success = false;
  const packet = async (name: string, value?: unknown) => {
    const result = {
      value,
      source: app ? await main(app, (f) => f.evidence()) : null,
      hosts: ready
        ? await Promise.all([0, 1].map((host) => control(ready!, { command: 'snapshot', host })))
        : null,
    };
    record(dir, name, result);
    return result;
  };
  try {
    ready = await waitFile(join(dir, 'ready.json'), child);
    expect(ready!.identity).toEqual(identity);
    expect(ready!.runId).toBe(runId);
    expect(ready!.hosts[0].workspaceId).toBe(ready!.hosts[1].workspaceId);
    expect(ready!.hosts[0].registeredRootId).toBe(ready!.hosts[1].registeredRootId);
    app = await electron.launch({
      args: [
        join(bundle, 'main.mjs'),
        join(dir, 'profile'),
        join(bundle, 'preload.cjs'),
        join(dir, 'ready.json'),
        join(bundle, 'renderer.js'),
      ],
      env: {
        ...environment(home),
        DISPLAY: process.env.DISPLAY!,
        XDG_RUNTIME_DIR: join(dir, 'runtime'),
      },
      timeout: 20000,
    });
    const logs = createWriteStream(join(dir, 'electron.log'), { mode: 0o600 });
    app.process().stdout?.pipe(logs, { end: false });
    app.process().stderr?.pipe(logs, { end: false });
    await expect
      .poll(() => app!.evaluate(() => !!(globalThis as any).nativeReviewFixture?.ready))
      .toBe(true);
    await body({
      dir,
      ready: ready!,
      app,
      a: await pageFor(app, 'host-A'),
      b: await pageFor(app, 'local-B'),
      packet,
    });
    await main(app, (f) => f.join());
    const before = await packet('before-stop');
    if (!before.source) throw new Error('Original main observations missing');
    const inventory = stopInventory(before.source);
    record(dir, 'stop-inventory-before', inventory);
    const { pending } = inventory;
    record(
      dir,
      'stop-begin',
      await control(ready!, { command: 'stop', phase: 'begin', pending, envelopes: [] }),
    );
    await main(app, (f) => f.join());
    const after = await main(app, (f) => f.evidence());
    record(dir, 'after-stop', after);
    const finalInventory = stopInventory(after);
    record(dir, 'stop-inventory-after', finalInventory);
    expect(after.records.slice(0, before.source.records.length)).toEqual(before.source.records);
    expect(finalInventory.rows.map((row) => row.request)).toEqual(
      inventory.rows.map((row) => row.request),
    );
    expect(after.pending).toBe(0);
    const originals = finalInventory.rows.map(({ request, originalResponse, history }) => ({
      request,
      originalResponse,
      history,
    }));
    record(dir, 'original-completions', originals);
    const envelopes = pending.map((request) => {
      const row = finalInventory.rows.find(
        (candidate) => JSON.stringify(candidate.request) === JSON.stringify(request),
      );
      if (!row?.complete) throw new Error('Original completion remains unobserved or unjoined');
      return { request, originalResponse: row.originalResponse, history: row.history };
    });
    record(
      dir,
      'stop-finish',
      await control(ready!, { command: 'stop', phase: 'finish', pending: [], envelopes }),
    );
    const result = await exited;
    record(dir, 'controller-helper-exit', result);
    const supervisorWait = JSON.parse(
      await readFile(join(dir, 'controller-supervisor-wait.json'), 'utf8'),
    );
    record(dir, 'original-supervisor-wait-observed', supervisorWait);
    expect(lifecycleFault).toBeNull();
    expect(metadata).toBe('');
    expect(lifecycle).toHaveLength(3);
    expect(supervisorWait).toEqual(lifecycle[1]);
    const allocation = lifecycle[0].details;
    expect(allocation).toEqual({
      supervisorPid: expect.any(Number),
      controllerPid: child.pid,
      writerIsFifo: true,
      writerInheritable: false,
    });
    expect(Number.isSafeInteger(allocation.supervisorPid) && allocation.supervisorPid > 0).toBe(
      true,
    );
    expect(supervisorWait.details).toEqual({
      supervisorPid: allocation.supervisorPid,
      returnCode: 0,
      code: 0,
      signal: null,
      waitedOriginalChild: true,
      failure: null,
    });
    expect(lifecycle[2].details).toEqual({
      success: true,
      failure: null,
      nativeCompletion: 'not asserted',
    });
    const stopped = JSON.parse(await readFile(join(dir, 'stopped.json'), 'utf8'));
    record(dir, 'final-stop-observed', stopped);
    expect(result).toEqual({ code: 0, signal: null });
    expect(stopped.success).toBe(true);
    expect(stopped.ownership.complete).toBe(true);
    expect(stopped.ownership.failed).toBe(false);
    expect(
      stopped.worker.cleanup.every((row: any) => row.udsClosed && row.tcpClosed && row.reaped),
    ).toBe(true);
    success = true;
  } catch (error) {
    record(dir, 'failure', {
      error: String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    try {
      await packet('failure-packet');
    } catch (packetError) {
      record(dir, 'failure-packet-error', String(packetError));
    }
    throw error;
  } finally {
    // EOF is failure cleanup, never success or a native receipt. Await this original allocation.
    if (!success) child.stdin!.end();
    const result = await exited;
    record(dir, 'controller-final-wait', { ...result, success });
    record(dir, 'controller-protocol-observed', { lifecycle, lifecycleFault, metadata, stderr });
    child.stdin!.end();
    if (app) {
      try {
        await main(app, (f) => f.shutdown());
      } finally {
        await app.close();
      }
    }
    const destination = join(evidence!, `group-${index + 1}`);
    await mkdir(destination, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(dir, { withFileTypes: true }))
      if (entry.isFile() && /\.(json|jsonl|log)$/.test(entry.name))
        await copyFile(join(dir, entry.name), join(destination, entry.name));
  }
}

test(groups[0][0], async () =>
  withDriver(0, async ({ ready, a, b, packet }) => {
    const baseline = await packet('baseline');
    await a.evaluate((id) => (window as any).native.read(id), ready.hosts[0].workspaceId);
    const prepared = await begin(a, 'a-create', inputFor(ready, 0));
    const created = await confirm(a, 'a-create', {
      prTitle: 'Owned primary create',
      prBody: 'fixture',
    });
    const first = await packet('primary-create', { prepared, created });
    expect(settled(created, 'created').gitReceipts).toEqual([]);
    expect(first.hosts[0].effects.pushes).toBe(baseline.hosts[0].effects.pushes);
    for (const key of ['primaryHead', 'registeredHead', 'index', 'worktree'])
      expect(first.hosts[0][key]).toEqual(baseline.hosts[0][key]);
    expect(first.hosts[1]).toEqual(baseline.hosts[1]);
    const combined = await begin(b, 'b-combined', inputFor(ready, 1, true, true));
    const completed = await confirm(b, 'b-combined', {
      commitMessage: 'Owned staged commit',
      prTitle: 'Owned combined review',
    });
    const second = await packet('registered-combined', { combined, completed });
    const receipts = settled(completed, 'created').gitReceipts;
    expect(receipts.map((row) => row.stage)).toEqual(['commit', 'push']);
    expect(second.hosts[1].registeredHead).not.toBe(baseline.hosts[1].registeredHead);
    expect(second.hosts[1].remoteHead).toBe(second.hosts[1].registeredHead);
    expect(second.hosts[0]).toEqual(first.hosts[0]);
    const registeredDir = join(dirname(ready.hosts[1].uds), 'secondary');
    expect(await readFile(join(registeredDir, 'unstaged.txt'), 'utf8')).toContain('unstaged');
    await begin(a, 'a-reused', inputFor(ready, 0));
    const reused = await confirm(a, 'a-reused');
    const final = await packet('create-reused', reused);
    expect(settled(reused, 'reused').gitReceipts).toEqual([]);
    expect(final.hosts[0].effects).toEqual(first.hosts[0].effects);
  }),
);

test(groups[1][0], async () =>
  withDriver(1, async ({ ready, app, a, packet }) => {
    await main(app, (f) => f.role('member'));
    const prepared = await begin(a, 'member', inputFor(ready, 0));
    await packet('member-prepared', prepared);
    expect(prepared.reviewPreparation.source.connection ?? null).toBeNull();
    expect(prepared.reviewPreparation.target.connection ?? null).toBeNull();
    const barrier = await arm(ready, prepared.reviewPreparation.operationId, 'GET');
    await a.evaluate(() => (window as any).native.start('member', { prTitle: 'Existing review' }));
    const admitted = await entered(ready, barrier.id);
    await packet('member-admitted', admitted);
    const duplicate = confirm(a, 'member', { prTitle: 'Existing review' });
    await control(ready, { command: 'releaseBarrier', host: 0, barrierId: barrier.id });
    const value = await duplicate;
    await packet('member-result', value);
    settled(value, 'reused');
    expect((await confirm(a, 'member', { prTitle: 'Existing review' })).execute).toEqual(
      value.execute,
    );
    await expect(confirm(a, 'member', { prTitle: 'changed' })).rejects.toThrow();
    const handle = await main(app, (f) => f.handle('host-A'));
    expect(handle).toBeDefined();
    await main(app, (f) => f.duplicateWindow());
    const other = await pageFor(app, 'other-A');
    const forged = await other.evaluate(
      (handle) =>
        (window as any).electronAPI.invoke('backend:native-review:execute', {
          id: handle!.id,
          root: handle!.input.review.root,
          command: {},
        }),
      handle,
    );
    const wrongRoot = await a.evaluate(
      ({ handle, gitRootId }) =>
        (window as any).electronAPI.invoke('backend:native-review:execute', {
          id: handle!.id,
          root: { ...handle!.input.review.root, kind: 'registered', gitRootId },
          command: {},
        }),
      { handle, gitRootId: ready.hosts[0].registeredRootId },
    );
    const frame = a.frames().find((value) => value !== a.mainFrame())!;
    const subframe = await frame.evaluate(
      (handle) =>
        (window as any).electronAPI.invoke('backend:native-review:execute', {
          id: handle!.id,
          root: handle!.input.review.root,
          command: {},
        }),
      handle,
    );
    await packet('wrong-owners', { forged, wrongRoot, subframe });
    expect(forged.ok).toBe(false);
    expect(wrongRoot.ok).toBe(false);
    expect(subframe.ok).toBe(false);
    await main(app, (f) => f.role('guest'));
    const read = await a.evaluate(
      (id) => (window as any).native.read(id),
      ready.hosts[0].workspaceId,
    );
    await packet('guest-local-read', read);
    expect(JSON.stringify(read)).not.toContain('accountId');
    await expect(begin(a, 'guest-denied', inputFor(ready, 0))).rejects.toThrow();
    const final = await packet('guest-native-denied');
    expect(
      final.source.records.filter(
        (row: WireRecord) =>
          row.direction === 'request' && row.envelope.method === 'accept-changes.execute',
      ),
    ).toHaveLength(1);
  }),
);

test(groups[2][0], async () =>
  withDriver(2, async ({ ready, app, a, packet }) => {
    await main(app, (f) => f.role('member'));
    await begin(a, 'known', inputFor(ready, 0));
    const known = await confirm(a, 'known');
    await packet('known-before-revoke', known);
    settled(known, 'reused');
    await control(ready, { command: 'revokeMember', host: 0 });
    const retained = await reconcile(a, 'known');
    await packet('history-after-revoke', retained);
    expect(retained.execute).toEqual(known.execute);
    expect(retained.current).toBe(false);
    await main(app, (f) => f.role('owner'));
    await begin(a, 'primary-before-delete', inputFor(ready, 0));
    await begin(a, 'registered-before-delete', inputFor(ready, 0, true));
    const scheduled = await main(app, (f) => f.pendingDelete(false));
    let cancelled: unknown;
    try {
      await expect
        .poll(() =>
          a.evaluate(
            () =>
              (window as any).native.retirements.filter((row: any) =>
                row.key.endsWith('before-delete'),
              ).length,
          ),
        )
        .toBe(2);
    } finally {
      cancelled = await main(app, (f) => f.pendingDelete(true));
    }
    await packet('pending-delete-cancel', { scheduled, cancelled });
    expect(cancelled).toEqual({ cancelled: true });
    await expect(confirm(a, 'primary-before-delete')).rejects.toThrow();
    await expect(confirm(a, 'registered-before-delete')).rejects.toThrow();
    await packet('old-roots-remain-retired');
  }),
);

test(groups[3][0], async () =>
  withDriver(3, async ({ ready, app, a, packet }) => {
    const prepared = await begin(a, 'held', inputFor(ready, 0));
    const barrier = await arm(ready, prepared.reviewPreparation.operationId, 'GET');
    await a.evaluate(() => (window as any).native.start('held'));
    await packet('held-entered', await entered(ready, barrier.id));
    await main(app, (f) => f.navigate());
    await control(ready, { command: 'releaseBarrier', host: 0, barrierId: barrier.id });
    await main(app, (f) => f.join());
    const next = app.windows().find((page) => page.url().endsWith('/host-A-next'))!;
    await next.waitForFunction(() => !!(window as any).native);
    const history = await packet('late-original-after-navigation');
    expect(await next.evaluate(() => (window as any).native.results)).toEqual({});
    expect(
      history.source.records.some(
        (row: WireRecord) =>
          row.direction === 'response' &&
          row.envelope.result?.reviewExecution?.outcome.status === 'reused',
      ),
    ).toBe(true);
    await begin(next, 'completed-before-reconnect', inputFor(ready, 0));
    const known = await confirm(next, 'completed-before-reconnect');
    await packet('known-before-reconnect', known);
    settled(known, 'reused');
    await main(app, (f) => f.reconnect());
    await expect(reconcile(next, 'completed-before-reconnect')).rejects.toThrow();
    const retained = await next.evaluate(
      () => (window as any).native.results['completed-before-reconnect'],
    );
    await packet('known-after-reconnect', retained);
    expect(retained.execute).toEqual(known.execute);
    await begin(next, 'unexecuted', inputFor(ready, 0));
    await main(app, (f) => f.destroy());
    await packet('destroyed-unexecuted');
  }),
);

test(groups[4][0], async () =>
  withDriver(4, async ({ ready, a, packet }) => {
    const prepared = await begin(a, 'lost-post', inputFor(ready, 0));
    const barrier = await arm(
      ready,
      prepared.reviewPreparation.operationId,
      'POST',
      'loseAfterPost',
    );
    const value = await confirm(a, 'lost-post', { prTitle: 'Uncertain original write' });
    const first = await packet('lost-post-original', { barrier, value });
    expect(settled(value, 'uncertain').gitReceipts).toEqual([]);
    expect(first.hosts[0].effects.posts).toBe(1);
    expect(first.hosts[0].effects.pushes).toBe(0);
    const history = await reconcile(a, 'lost-post');
    expect(history.reconciliation?.reviewExecution?.outcome.status).toBe('uncertain');
    await confirm(a, 'lost-post', { prTitle: 'Uncertain original write' });
    const final = await packet('lost-post-retained', history);
    expect(final.hosts[0].effects).toEqual(first.hosts[0].effects);
  }),
);
