/**
 * Graceful-shutdown ordering regression guard (AST-based).
 *
 * `ConsolidatedBackendService.shutdown()` (invoked by `shutdownUnifiedBackend`)
 * already saves sessions and kills providers, so our clean-quit flush from
 * `agentBackendHandler.persistShutdownState()` MUST run BEFORE
 * `shutdownUnifiedBackend()` — otherwise the flush either races against
 * cleared state or is overwritten by the backend's own shutdown.
 *
 * Importing `src/main/index.ts` has heavy top-level side effects (Sentry,
 * electron app, IPC registration), so we parse the source with the
 * TypeScript compiler API and walk just the relevant function bodies.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
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

function findGracefulShutdown(sf: ts.SourceFile): ts.FunctionLikeDeclaration {
  let found: ts.FunctionLikeDeclaration | undefined;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'gracefulShutdown' && n.body) {
      found = n;
      return;
    }
    if (ts.isVariableStatement(n)) {
      for (const decl of n.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === 'gracefulShutdown' &&
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
  if (!found) throw new Error('gracefulShutdown function not found in src/main/index.ts');
  return found;
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
  it('calls persistShutdownState() BEFORE shutdownUnifiedBackend() inside gracefulShutdown', () => {
    const sf = parseIndex();
    const gs = findGracefulShutdown(sf);
    const calls = callsitesIn(gs.body!);
    const persistIdx = calls.findIndex((c) => c.text === 'agentBackendHandler.persistShutdownState');
    const unifiedIdx = calls.findIndex((c) => c.text === 'shutdownUnifiedBackend');
    expect(persistIdx).toBeGreaterThan(-1);
    expect(unifiedIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeLessThan(unifiedIdx);
  });

  it('window-all-closed either delegates to gracefulShutdown or calls persistShutdownState before shutdownUnifiedBackend', () => {
    const sf = parseIndex();
    const handler = findWindowAllClosedHandler(sf);
    const calls = callsitesIn(handler.body!);
    const delegates = calls.some((c) => c.text === 'gracefulShutdown');
    if (delegates) {
      expect(delegates).toBe(true);
      return;
    }
    const persistIdx = calls.findIndex((c) => c.text === 'agentBackendHandler.persistShutdownState');
    const unifiedIdx = calls.findIndex((c) => c.text === 'shutdownUnifiedBackend');
    expect(persistIdx).toBeGreaterThan(-1);
    expect(unifiedIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeLessThan(unifiedIdx);
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
    const persistIdx = calls.findIndex((c) => c.text === 'agentBackendHandler.persistShutdownState');
    const unifiedIdx = calls.findIndex((c) => c.text === 'shutdownUnifiedBackend');
    expect(promptIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeGreaterThan(-1);
    expect(unifiedIdx).toBeGreaterThan(-1);
    // Prompt must run before any teardown, otherwise providers are already dead
    // by the time before-quit fires and the check silently sees zero streams.
    expect(promptIdx).toBeLessThan(persistIdx);
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
    // (the daemon owns MCP process lifecycle now).
    const sf = parseIndex();
    const gs = findGracefulShutdown(sf);
    const calls = callsitesIn(gs.body!);
    const required = [
      'cleanupTerminals',
      'disposeAllScriptProcessManagers',
      'cleanupAutoUpdater',
      'app.exit',
    ];
    for (const name of required) {
      expect(
        calls.some((c) => c.text === name),
        `gracefulShutdown must still call ${name}() — removing it would regress the non-macOS window-all-closed cleanup path that now delegates here`,
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
