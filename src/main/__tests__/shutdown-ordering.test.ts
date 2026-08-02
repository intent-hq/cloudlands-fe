/**
 * Graceful-shutdown ordering regression guard (AST-based).
 *
 * The persist-in-flight hook (`agentBackendHandler.persistShutdownState()`)
 * was retired alongside the FE `AgentBackendHandler` (C1d-7), and the
 * `shutdownUnifiedBackend` / `ConsolidatedBackendService.shutdown()` teardown
 * was retired with the main-process agent handlers — the daemon owns agent
 * lifecycle and in-flight session persistence via `agent.completeOnce`
 * (PROTOCOL.md §5.32). What remains is the non-teardown ordering
 * (running-agent prompt BEFORE any teardown, single SIGINT/SIGTERM owner,
 * non-macOS delegate-to-gracefulShutdown path).
 *
 * Importing `src/main/index.ts` has heavy top-level side effects (Sentry,
 * electron app, IPC registration), so we parse the source with the
 * TypeScript compiler API and walk just the relevant function bodies.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const INDEX_PATH = path.resolve(__dirname, '..', 'index.ts');

interface CallSite {
  text: string;
  pos: number;
}

function parseIndex(): ts.SourceFile {
  const src = fs.readFileSync(INDEX_PATH, 'utf8');
  return ts.createSourceFile(INDEX_PATH, src, ts.ScriptTarget.Latest, true);
}

function callsitesIn(node: ts.Node): CallSite[] {
  const out: CallSite[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      out.push({ text: n.expression.getText(), pos: n.pos });
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

function findNamedFunction(sf: ts.SourceFile, name: string): ts.FunctionLikeDeclaration {
  let found: ts.FunctionLikeDeclaration | undefined;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name && n.body) {
      found = n;
      return;
    }
    if (ts.isVariableStatement(n)) {
      for (const decl of n.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === name &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          found = decl.initializer;
          return;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!found) throw new Error(`${name} function not found in src/main/index.ts`);
  return found;
}

function findGracefulShutdown(sf: ts.SourceFile): ts.FunctionLikeDeclaration {
  return findNamedFunction(sf, 'gracefulShutdown');
}

// The cleanup chain was extracted into performGracefulShutdown() so that
// gracefulShutdown() can bound it with the runWithHardExitTimeout watchdog
// (intent-hq/monorepo#1300). Body-level assertions run against the extracted
// function; findShutdownCleanupBody() first proves gracefulShutdown() still
// delegates there, so the checks cover code that is actually reachable from
// gracefulShutdown().
function findShutdownCleanupBody(sf: ts.SourceFile): ts.FunctionLikeDeclaration {
  const gs = findGracefulShutdown(sf);
  let watchdogCall: ts.CallExpression | undefined;
  const visit = (n: ts.Node) => {
    if (watchdogCall) return;
    if (ts.isCallExpression(n) && n.expression.getText() === 'runWithHardExitTimeout') {
      watchdogCall = n;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(gs.body!);
  if (!watchdogCall) {
    throw new Error(
      'gracefulShutdown must bound its cleanup chain via runWithHardExitTimeout (intent-hq/monorepo#1300)',
    );
  }
  const [runArg] = watchdogCall.arguments;
  if (!runArg || runArg.getText() !== 'performGracefulShutdown') {
    throw new Error(
      'gracefulShutdown must pass performGracefulShutdown to runWithHardExitTimeout so the cleanup chain stays reachable',
    );
  }
  return findNamedFunction(sf, 'performGracefulShutdown');
}

function findWindowAllClosedHandler(sf: ts.SourceFile): ts.FunctionLikeDeclaration {
  let found: ts.FunctionLikeDeclaration | undefined;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n) && n.expression.getText().endsWith('app.on')) {
      const [evtArg, handlerArg] = n.arguments;
      if (
        evtArg &&
        ts.isStringLiteral(evtArg) &&
        evtArg.text === 'window-all-closed' &&
        handlerArg &&
        (ts.isArrowFunction(handlerArg) || ts.isFunctionExpression(handlerArg))
      ) {
        found = handlerArg;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!found) throw new Error('window-all-closed handler not found in src/main/index.ts');
  return found;
}

describe('gracefulShutdown call ordering (AST)', () => {
  it('does not re-introduce the retired persistShutdownState hook in gracefulShutdown', () => {
    // Sentinel: `agentBackendHandler.persistShutdownState()` was retired in
    // C1d-7 (daemon owns in-flight persistence via `agent.completeOnce`,
    // PROTOCOL.md §5.32), and `shutdownUnifiedBackend` was retired with the
    // main-process agent handlers. Adding either back would resurrect the FE
    // agent backend.
    const sf = parseIndex();
    const calls = [
      ...callsitesIn(findGracefulShutdown(sf).body!),
      ...callsitesIn(findShutdownCleanupBody(sf).body!),
    ];
    expect(calls.some((c) => c.text === 'agentBackendHandler.persistShutdownState')).toBe(false);
    expect(calls.some((c) => c.text === 'shutdownUnifiedBackend')).toBe(false);
  });

  it('window-all-closed does not re-introduce the retired persistShutdownState hook', () => {
    const sf = parseIndex();
    const handler = findWindowAllClosedHandler(sf);
    const calls = callsitesIn(handler.body!);
    expect(calls.some((c) => c.text === 'agentBackendHandler.persistShutdownState')).toBe(false);
  });

  it('window-all-closed invokes the running-agent prompt BEFORE any backend teardown (or delegates to gracefulShutdown)', () => {
    const sf = parseIndex();
    const handler = findWindowAllClosedHandler(sf);
    const calls = callsitesIn(handler.body!);
    const delegates = calls.some((c) => c.text === 'gracefulShutdown');
    if (delegates) {
      expect(delegates).toBe(true);
      return;
    }
    // Find the prompt-helper call (or an inline showMessageBox as a fallback)
    const promptIdx = calls.findIndex(
      (c) =>
        c.text === 'confirmQuitWithRunningAgents' ||
        c.text === 'dialog.showMessageBox' ||
        c.text.endsWith('.showMessageBox'),
    );
    const unifiedIdx = calls.findIndex((c) => c.text === 'shutdownUnifiedBackend');
    expect(promptIdx).toBeGreaterThan(-1);
    expect(unifiedIdx).toBeGreaterThan(-1);
    // Prompt must run before any teardown, otherwise providers are already dead
    // by the time before-quit fires and the check silently sees zero streams.
    expect(promptIdx).toBeLessThan(unifiedIdx);
  });

  it('non-macOS window-all-closed delegates the confirmed-quit path to gracefulShutdown() and returns before the inline teardown', () => {
    // Regression guard for the "non-macOS close path can re-enter before-quit after
    // teardown" bug. On the non-macOS last-window-close path, after the user
    // confirms the running-agent prompt, the handler must delegate teardown to
    // gracefulShutdown() (which runs cleanupTerminals/cleanupNoteTerminals/
    // disposeAllScriptProcessManagers/cleanupAutoUpdater, sets
    // isShuttingDown=true, and calls app.exit(0)) — and then return before the
    // inline teardown block runs. Without this, app.quit() at the end of the
    // handler fires before-quit → gracefulShutdown for a duplicate teardown and a
    // potential second running-agent dialog. Conversely, simply suppressing
    // before-quit without delegating would skip the gracefulShutdown-only cleanup
    // the non-macOS close path previously relied on.
    const sf = parseIndex();
    const handler = findWindowAllClosedHandler(sf);
    const body = handler.body!;

    // Locate the non-darwin confirmed-quit branch: an IfStatement whose condition
    // includes `process.platform !== 'darwin'`.
    let branch: ts.IfStatement | undefined;
    const findBranch = (n: ts.Node) => {
      if (branch) return;
      if (ts.isIfStatement(n)) {
        const condText = n.expression.getText();
        if (condText.includes("process.platform !== 'darwin'")) {
          branch = n;
          return;
        }
      }
      ts.forEachChild(n, findBranch);
    };
    findBranch(body);
    expect(branch).toBeDefined();

    const branchCalls = callsitesIn(branch!.thenStatement);
    const promptIdx = branchCalls.findIndex((c) => c.text === 'confirmQuitWithRunningAgents');
    const gsIdx = branchCalls.findIndex((c) => c.text === 'gracefulShutdown');
    expect(promptIdx).toBeGreaterThan(-1);
    expect(gsIdx).toBeGreaterThan(-1);
    // gracefulShutdown must be awaited AFTER the running-agent prompt.
    expect(promptIdx).toBeLessThan(gsIdx);

    // The non-darwin branch must contain a bare `return;` after gracefulShutdown
    // so the inline bespoke teardown + app.quit() at the bottom of the handler is
    // skipped on the confirmed-quit path (otherwise the duplicate teardown and
    // before-quit re-entry are re-introduced).
    let returnAfterGsFound = false;
    const findReturn = (n: ts.Node) => {
      if (returnAfterGsFound) return;
      if (ts.isReturnStatement(n) && n.pos > branchCalls[gsIdx].pos) {
        returnAfterGsFound = true;
        return;
      }
      ts.forEachChild(n, findReturn);
    };
    findReturn(branch!.thenStatement);
    expect(returnAfterGsFound).toBe(true);
  });

  it('gracefulShutdown preserves the cleanup responsibilities the non-macOS close path depends on', () => {
    // Cleanup-preservation regression guard. Because non-macOS window-all-closed
    // delegates its confirmed-quit teardown to gracefulShutdown(), the set of
    // cleanups that previously ran inline on that path MUST remain reachable
    // inside gracefulShutdown. If any of these are removed, the non-macOS
    // last-window-close path silently stops cleaning up those resources
    // (PTY terminals, workspace scripts, auto-updater periodic checks) and the
    // process no longer force-exits via app.exit() after teardown.
    // `cleanupNoteTerminals` was retired in D6 alongside `notes-primitives.ipc.ts`;
    // the MCP hub `cleanupMCP` step was retired in G3 alongside the FE MCP hub
    // (the daemon owns MCP process lifecycle now). The cleanup chain now lives
    // in performGracefulShutdown(); findShutdownCleanupBody() proves it is
    // still reachable from gracefulShutdown() via runWithHardExitTimeout.
    const sf = parseIndex();
    const cleanup = findShutdownCleanupBody(sf);
    const calls = callsitesIn(cleanup.body!);
    const required = [
      'cleanupTerminals',
      'disposeAllScriptProcessManagers',
      'cleanupAutoUpdater',
      'app.exit',
    ];
    for (const name of required) {
      expect(
        calls.some((c) => c.text === name),
        `gracefulShutdown (via performGracefulShutdown) must still call ${name}() — removing it would regress the non-macOS window-all-closed cleanup path that now delegates here`,
      ).toBe(true);
    }
  });

  it('confirmQuitWithRunningAgents consults the daemon, not the removed main-store stream state', () => {
    // Regression guard for the quit crash: the old prompt read
    // `agentBackendHandler.getActiveStreams()`, which reached into the removed
    // main-process messageAccumulator Redux slice and threw
    // `Cannot read properties of undefined (reading 'accumulators')` on every
    // quit. The prompt must ask the daemon (listRespondingAgents) instead and
    // never touch the dead store paths again.
    const sf = parseIndex();
    let fn: ts.FunctionLikeDeclaration | undefined;
    const visit = (n: ts.Node) => {
      if (fn) return;
      if (
        ts.isFunctionDeclaration(n) &&
        n.name?.text === 'confirmQuitWithRunningAgents' &&
        n.body
      ) {
        fn = n;
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(fn, 'confirmQuitWithRunningAgents not found in src/main/index.ts').toBeDefined();

    const calls = callsitesIn(fn!.body!);
    expect(calls.some((c) => c.text === 'listRespondingAgents')).toBe(true);
    expect(calls.some((c) => c.text === 'agentBackendHandler.getActiveStreams')).toBe(false);
    expect(calls.some((c) => c.text.includes('messageAccumulator'))).toBe(false);
  });

  it('main process registers exactly one SIGINT and one SIGTERM handler (single-owner invariant)', () => {
    const sf = parseIndex();
    let sigint = 0;
    let sigterm = 0;
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && n.expression.getText() === 'process.on') {
        const [evtArg] = n.arguments;
        if (evtArg && ts.isStringLiteral(evtArg)) {
          if (evtArg.text === 'SIGINT') sigint++;
          if (evtArg.text === 'SIGTERM') sigterm++;
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(sigint).toBe(1);
    expect(sigterm).toBe(1);
  });
});

function findConfirmQuit(sf: ts.SourceFile): ts.FunctionLikeDeclaration {
  let found: ts.FunctionLikeDeclaration | undefined;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'confirmQuitWithRunningAgents' && n.body) {
      found = n;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!found) throw new Error('confirmQuitWithRunningAgents not found in src/main/index.ts');
  return found;
}

describe('external-daemon-aware quit flow (AST)', () => {
  it('gracefulShutdown never calls stopIntentdSidecar in external mode (no-kill guard)', () => {
    // External daemons are not ours to stop: the shutdown path must branch on
    // getConnectionMode() and only reach stopIntentdSidecar() (SIGTERM →
    // SIGKILL escalation) on the non-external side of that branch. The branch
    // lives in performGracefulShutdown(); findShutdownCleanupBody() proves it
    // is still reachable from gracefulShutdown() via runWithHardExitTimeout.
    const sf = parseIndex();
    const gs = findShutdownCleanupBody(sf);

    let branch: ts.IfStatement | undefined;
    const findBranch = (n: ts.Node) => {
      if (branch) return;
      if (ts.isIfStatement(n)) {
        const condText = n.expression.getText();
        if (condText.includes('getConnectionMode()') && condText.includes("'external'")) {
          branch = n;
          return;
        }
      }
      ts.forEachChild(n, findBranch);
    };
    findBranch(gs.body!);
    expect(
      branch,
      "gracefulShutdown must branch on getConnectionMode() === 'external' around stopIntentdSidecar",
    ).toBeDefined();

    // The external (then) branch must not touch the sidecar stop path — only
    // log that we are leaving the daemon alone.
    const externalCalls = callsitesIn(branch!.thenStatement);
    expect(externalCalls.some((c) => c.text === 'stopIntentdSidecar')).toBe(false);
    expect(externalCalls.some((c) => c.text === 'logger.info')).toBe(true);

    // The non-external (else) branch owns the single stopIntentdSidecar call.
    expect(branch!.elseStatement).toBeDefined();
    const sidecarCalls = callsitesIn(branch!.elseStatement!);
    expect(sidecarCalls.some((c) => c.text === 'stopIntentdSidecar')).toBe(true);

    // No stray stopIntentdSidecar call outside the guarded else branch.
    const allStops = callsitesIn(gs.body!).filter((c) => c.text === 'stopIntentdSidecar');
    expect(allStops).toHaveLength(1);
  });

  it('confirmQuitWithRunningAgents branches dialog copy on connection mode via buildQuitDialogOptions', () => {
    // The dialog copy lives in the pure, unit-tested buildQuitDialogOptions
    // helper (quit-dialog.test.ts asserts the per-mode copy). The prompt must
    // feed it the live connection mode and keep the zero-agent fast path
    // (listRespondingAgents) intact in every mode.
    const sf = parseIndex();
    const fn = findConfirmQuit(sf);
    const calls = callsitesIn(fn.body!);
    expect(calls.some((c) => c.text === 'listRespondingAgents')).toBe(true);
    expect(calls.some((c) => c.text === 'getConnectionMode')).toBe(true);
    expect(calls.some((c) => c.text === 'buildQuitDialogOptions')).toBe(true);
    expect(calls.some((c) => c.text === 'dialog.showMessageBox')).toBe(true);
  });
});
