import path from 'node:path';
import ts from 'typescript';
import { parse } from 'svelte/compiler';
import { templateEvidence } from './component-evidence.ts';
import { hash, inside, isTestFile, slash, Sources } from './files.ts';
import type { Analysis, Config, Fragment, Target, Trace } from './types.ts';
import { CHECKS_VERSION, checkAssertion, checkFixtureLayout } from './assertion-checks.ts';

export const ANALYZER_VERSION = `7/checks-${CHECKS_VERSION}`;
type Module = {
  source: ts.SourceFile;
  declarations: Map<string, ts.Node>;
  imports: Map<string, { specifier: string; imported: string }>;
  exports: Map<string, { specifier?: string; imported: string }>;
  stars: string[];
  hooks: ts.Node[];
  warnings: string[];
};
type TestNode = { node: ts.CallExpression; target: Target; scope: ts.Node[] };
const functionNode = (node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node);

function chain(node: ts.Node): string[] {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) return [...chain(node.expression), node.name.text];
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression))
    return [...chain(node.expression), node.argumentExpression.text];
  if (ts.isCallExpression(node)) return chain(node.expression);
  if (ts.isTaggedTemplateExpression(node)) return chain(node.tag);
  return [];
}

function names(node: ts.Node): Set<string> {
  const result = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (ts.isTypeNode(child) || ts.isInterfaceDeclaration(child)) return;
    if (
      ts.isIdentifier(child) &&
      !(ts.isPropertyAccessExpression(child.parent) && child.parent.name === child) &&
      !(ts.isPropertyAssignment(child.parent) && child.parent.name === child)
    )
      result.add(child.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return result;
}

function declaredNames(node: ts.Node): string[] {
  if (ts.isVariableStatement(node))
    return node.declarationList.declarations.flatMap((d) =>
      ts.isIdentifier(d.name) ? [d.name.text] : [...names(d.name)],
    );
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name
  )
    return [node.name.text];
  return [];
}

function location(
  node: ts.Node,
  source: ts.SourceFile,
): { line: number; endLine: number; code: string } {
  return {
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    endLine: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
    code: node.getText(source),
  };
}

function parseModule(file: string, text: string): Module {
  const warnings: string[] = [];
  let script = text;
  if (file.endsWith('.svelte')) {
    try {
      const ast = parse(text, { modern: true });
      const ranges = [ast.instance, ast.module]
        .filter((n) => n != null)
        .map((n) => {
          const content = n.content as typeof n.content & { start: number; end: number };
          return [content.start, content.end] as const;
        });
      script = text
        .split('')
        .map((c, i) =>
          c === '\n' || ranges.some(([start, end]) => i >= start && i < end) ? c : ' ',
        )
        .join('');
    } catch {
      warnings.push(`${file}: Svelte parse failed; component excerpt only`);
      script = '';
    }
  }
  const source = ts.createSourceFile(
    file,
    script,
    ts.ScriptTarget.Latest,
    true,
    /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] })
    .parseDiagnostics;
  if (diagnostics.length)
    warnings.push(`${file}: ${diagnostics.length} syntax diagnostics; trace may be incomplete`);
  const module: Module = {
    source,
    declarations: new Map(),
    imports: new Map(),
    exports: new Map(),
    stars: [],
    hooks: [],
    warnings,
  };
  for (const statement of source.statements) {
    for (const name of declaredNames(statement)) module.declarations.set(name, statement);
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (clause?.name) module.imports.set(clause.name.text, { specifier, imported: 'default' });
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          module.imports.set(element.name.text, {
            specifier,
            imported: element.propertyName?.text ?? element.name.text,
          });
      if (bindings && ts.isNamespaceImport(bindings))
        module.imports.set(bindings.name.text, { specifier, imported: '*' });
    }
    if (ts.isExportDeclaration(statement)) {
      const specifier =
        statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : undefined;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements)
          module.exports.set(element.name.text, {
            specifier,
            imported: element.propertyName?.text ?? element.name.text,
          });
      } else if (specifier) module.stars.push(specifier);
    }
    if (
      ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    )
      module.declarations.set('default', statement);
    if (ts.isExportAssignment(statement)) module.declarations.set('default', statement);
    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
      const parts = chain(statement.expression);
      if (
        parts.some((p) =>
          /^(beforeAll|beforeEach|afterAll|afterEach|mock|doMock|use|configure)$/.test(p),
        )
      )
        module.hooks.push(statement);
    }
  }
  return module;
}

function testNodes(file: string, module: Module): TestNode[] {
  const { source, imports } = module;
  const testNames = new Set(['it', 'test', 'specify']);
  const describeNames = new Set(['describe', 'suite']);
  for (const [local, { imported, specifier }] of imports) {
    if (['it', 'test', 'specify'].includes(imported)) testNames.add(local);
    if (['describe', 'suite'].includes(imported)) describeNames.add(local);
    if (specifier === 'node:test' && imported === 'default') testNames.add(local);
  }
  const result: TestNode[] = [];
  const duplicates = new Map<string, number>();
  const visit = (
    node: ts.Node,
    parents: string[],
    scope: ts.Node[],
    inherited: Target['status'],
  ): void => {
    if (ts.isCallExpression(node)) {
      const parts = chain(node.expression);
      const root = imports.get(parts[0])?.imported === '*' ? parts[1] : parts[0];
      let callback: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | undefined =
        node.arguments.find(functionNode);
      if (!callback && node.arguments.length > 1) {
        const argument = node.arguments.find((arg, index) => index > 0 && ts.isIdentifier(arg));
        if (argument && ts.isIdentifier(argument)) {
          const declaration = module.declarations.get(argument.text);
          if (declaration && ts.isFunctionDeclaration(declaration)) callback = declaration;
          else if (declaration && ts.isVariableStatement(declaration)) {
            const initializer = declaration.declarationList.declarations.find(
              (d) => ts.isIdentifier(d.name) && d.name.text === argument.text,
            )?.initializer;
            if (initializer && functionNode(initializer)) callback = initializer;
          }
        }
      }
      const first = node.arguments[0];
      const title =
        first && !functionNode(first)
          ? ts.isStringLiteralLike(first)
            ? first.text
            : first.getText(source)
          : '<dynamic title>';
      const status =
        parts.includes('skip') || inherited === 'skipped'
          ? 'skipped'
          : parts.includes('todo')
            ? 'todo'
            : parts.some((p) => ['skipIf', 'runIf', 'fixme'].includes(p)) ||
                inherited === 'conditional'
              ? 'conditional'
              : inherited;
      const suite = describeNames.has(root) || (testNames.has(root) && parts.includes('describe'));
      const registration =
        (testNames.has(root) &&
          !parts
            .slice(1)
            .some((p) =>
              [
                'use',
                'extend',
                'step',
                'info',
                'setTimeout',
                'slow',
                'fail',
                'beforeEach',
                'afterEach',
                'beforeAll',
                'afterAll',
              ].includes(p),
            )) ||
        suite;
      if (registration && (callback || (first && ts.isStringLiteralLike(first)))) {
        if (suite && callback?.body) {
          const hooks = ts.isBlock(callback.body)
            ? callback.body.statements.filter(
                (s) =>
                  declaredNames(s).length > 0 ||
                  (ts.isExpressionStatement(s) &&
                    ts.isCallExpression(s.expression) &&
                    chain(s.expression).some((p) =>
                      /^(beforeAll|beforeEach|afterAll|afterEach)$/.test(p),
                    )),
              )
            : [];
          visit(callback.body, [...parents, title], [...scope, ...hooks], status);
          return;
        }
        const name = [...parents, title].join(' > ');
        if (suite) return;
        const ordinal = duplicates.get(name) ?? 0;
        duplicates.set(name, ordinal + 1);
        const target: Target = {
          id: hash([file, 'test', name, ordinal]),
          kind: 'test',
          name,
          file,
          ...location(node, source),
          status,
          parentId: hash([file, 'file']),
        };
        result.push({ node, target, scope });
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, parents, scope, inherited));
  };
  visit(source, [], module.hooks, 'active');
  return result;
}

function assertionNodes(node: ts.Node, module: Module): ts.CallExpression[] {
  const expectNames = new Set(['expect', 'assert', 'expectTypeOf', 'assertType']);
  const directAsserts = new Set(['assert', 'assertType']);
  for (const [local, { imported, specifier }] of module.imports) {
    if (expectNames.has(imported) || specifier.startsWith('node:assert') || specifier === 'assert')
      expectNames.add(local);
    if (specifier.startsWith('node:assert') || specifier === 'assert' || imported === 'assertType')
      directAsserts.add(local);
  }
  const result: ts.CallExpression[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child)) {
      let parts = chain(child.expression);
      if (
        module.imports.get(parts[0])?.imported === '*' &&
        ['expect', 'assert', 'expectTypeOf', 'assertType'].includes(parts[1])
      )
        parts = parts.slice(1);
      if (
        expectNames.has(parts[0]) &&
        !(
          parts[0] === 'expect' &&
          ['assertions', 'hasAssertions', 'extend', 'getState', 'setState'].includes(parts[1])
        )
      ) {
        if (parts.length > 1 || directAsserts.has(parts[0])) {
          result.push(child);
          return;
        }
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return result;
}

export class Analyzer {
  sources: Sources;
  config: Config;
  files: Set<string>;
  modules = new Map<string, Module>();
  constructor(sources: Sources, files: string[], config: Config) {
    this.sources = sources;
    this.files = new Set(files);
    this.config = config;
  }

  module(file: string): Module {
    if (!this.modules.has(file)) this.modules.set(file, parseModule(file, this.sources.read(file)));
    return this.modules.get(file)!;
  }

  resolve(from: string, specifier: string): string | undefined {
    let base: string | undefined;
    if (specifier.startsWith('.'))
      base = path.resolve(this.sources.root, path.dirname(from), specifier);
    else {
      const alias = Object.keys(this.config.aliases)
        .sort((a, b) => b.length - a.length)
        .find((a) => specifier === a || specifier.startsWith(`${a}/`));
      if (alias)
        base = path.resolve(
          this.sources.root,
          this.config.aliases[alias],
          specifier.slice(alias.length).replace(/^\//, ''),
        );
      else if (specifier.startsWith('/src/') || specifier.startsWith('/test/'))
        base = path.resolve(this.sources.root, `.${specifier}`);
    }
    if (!base || !inside(this.sources.root, base)) return undefined;
    const relative = slash(path.relative(this.sources.root, base));
    const candidates = [
      relative,
      ...[
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
        '.mjs',
        '.cjs',
        '.mts',
        '.cts',
        '.svelte',
        '/index.ts',
        '/index.js',
      ].map((ext) => relative + ext),
    ];
    if (/\.[cm]?js$/.test(relative)) candidates.push(relative.replace(/\.([cm]?)js$/, '.$1ts'));
    return candidates.find((file) => this.files.has(file));
  }

  analyze(file: string): Analysis {
    const module = this.module(file);
    const tests = testNodes(file, module);
    const testNames = new Map(tests.map((t) => [t, names(t.node)]));
    const dependencies: Record<string, string> = { [file]: this.sources.digest(file) };
    const traces: Trace[] = [];
    for (const test of tests) {
      const fragments: Fragment[] = [];
      const warnings = new Set(module.warnings);
      const seen = new Set<string>();
      const pending: { priority: number; run: () => void }[] = [];
      const interest = new Set<string>();
      const instances = new Map<string, string>();
      const methodsByClass = new Map<string, Set<string>>();
      const instanceDeclarations = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
          if (node.initializer && ts.isNewExpression(node.initializer))
            instances.set(node.name.text, node.initializer.expression.getText(module.source));
          else if (node.type && ts.isTypeReferenceNode(node.type))
            instances.set(node.name.text, node.type.typeName.getText(module.source));
        }
        if (
          ts.isBinaryExpression(node) &&
          ts.isIdentifier(node.left) &&
          ts.isNewExpression(node.right)
        )
          instances.set(node.left.text, node.right.expression.getText(module.source));
        ts.forEachChild(node, instanceDeclarations);
      };
      for (const node of [test.node, ...test.scope, ...module.declarations.values()])
        instanceDeclarations(node);
      const collectInterest = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node)) {
          interest.add(node.name.text);
          const receiver = chain(node.expression)[0];
          const className =
            instances.get(receiver) ?? (module.imports.has(receiver) ? receiver : undefined);
          if (className) {
            const symbol = module.imports.get(className)?.imported ?? className;
            const methods = methodsByClass.get(symbol) ?? new Set<string>();
            methods.add(node.name.text);
            methodsByClass.set(symbol, methods);
          }
        }
        ts.forEachChild(node, collectInterest);
      };
      for (const node of [test.node, ...test.scope]) collectInterest(node);
      const scoped = new Map(module.declarations);
      for (const node of test.scope) for (const name of declaredNames(node)) scoped.set(name, node);
      const requiredOmissions: string[] = [];
      const omit = (reason: string): void => {
        warnings.add(reason);
        requiredOmissions.push(reason);
      };

      const helperAssertions: { file: string; node: ts.CallExpression; module: Module }[] = [];
      let chars = Math.min(test.target.code.length, this.config.maxContextChars / 2);
      if (test.target.code.length > this.config.maxContextChars / 2)
        omit('Test body exceeds context budget; excerpt truncated');
      const add = (
        sourceFile: string,
        node: ts.Node,
        reason: string,
        depth: number,
        required = true,
        rank?: number,
      ): void => {
        const m = this.module(sourceFile);
        const key = `${sourceFile}:${node.pos}:${node.end}`;
        if (seen.has(key)) return;
        seen.add(key);
        dependencies[sourceFile] = this.sources.digest(sourceFile);
        if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
        const setup = reason === 'Test setup or teardown';
        const mock = setup && /\b(?:mock|doMock)\s*\(/.test(node.getText(m.source));
        const priority =
          rank ??
          (sourceFile === file
            ? (setup ? -22 : -50) + depth
            : depth * 2 + (mock ? -20 : setup ? -18 : ts.isFunctionDeclaration(node) ? 0 : 1));
        pending.push({
          priority,
          run: () => {
            for (const warning of m.warnings) warnings.add(warning);
            if (
              depth > this.config.maxDepth ||
              fragments.length >= this.config.maxFragments ||
              chars >= this.config.maxContextChars
            ) {
              (required ? omit : (s: string) => warnings.add(s))(
                `Required context omitted by budget/depth: ${sourceFile}:${location(node, m.source).line} (${reason})`,
              );
              return;
            }
            const loc = location(node, m.source);
            const remaining = Math.min(required ? 6000 : 2400, this.config.maxContextChars - chars);
            const code = loc.code.slice(0, remaining);
            if (code.length < loc.code.length)
              (required ? omit : (s: string) => warnings.add(s))(
                `Truncated related declaration in ${sourceFile}:${loc.line}`,
              );
            fragments.push({
              file: sourceFile,
              ...loc,
              endLine: loc.line + code.split('\n').length - 1,
              code,
              reason,
              priority,
              required,
            });
            chars += code.length;
            if (
              sourceFile === file ||
              isTestFile(sourceFile) ||
              /(?:^|[/.-])(?:test|tests|__tests__|testing)(?:[/.-]|$)/.test(sourceFile)
            ) {
              for (const assertion of assertionNodes(node, m))
                helperAssertions.push({ file: sourceFile, node: assertion, module: m });
            }
            follow(sourceFile, node, depth + 1, required, priority + 2);
          },
        });
      };
      const exported = (sourceFile: string, symbol: string, depth: number): void => {
        const m = this.module(sourceFile);
        dependencies[sourceFile] = this.sources.digest(sourceFile);
        const exportKey = `export:${sourceFile}:${symbol}`;
        if (seen.has(exportKey)) return;
        seen.add(exportKey);
        if (depth > this.config.maxDepth) {
          omit(`Required export omitted by depth: ${sourceFile}:${symbol}`);
          return;
        }
        if (sourceFile.endsWith('.svelte')) {
          if (seen.has(`component:${sourceFile}`)) return;
          seen.add(`component:${sourceFile}`);
          warnings.add(
            `${sourceFile}: template references are bounded static evidence, not runtime coverage`,
          );
          const text = this.sources.read(sourceFile);
          let bindings: ReturnType<typeof templateEvidence>;
          try {
            bindings = templateEvidence(text);
          } catch {
            omit(`Svelte bindings unresolved: ${sourceFile}`);
            return;
          }
          const eventNames = new Set<string>();
          const testText = test.target.code.toLowerCase();
          for (const event of [
            'paste',
            'click',
            'keydown',
            'keyup',
            'input',
            'change',
            'submit',
            'focus',
            'blur',
          ])
            if (
              testText.includes(event) ||
              (event === 'keydown' && /keyboard|keypress|press\(/.test(testText))
            )
              eventNames.add(event);
          if (eventNames.has('keydown')) eventNames.add('click');
          const selected = bindings.filter((b) => b.events.some((e) => eventNames.has(e)));
          // Prefer the control whose accessible selector or handler matches test vocabulary.
          const words = new Set(
            (testText.match(/[a-z]{4,}/g) ?? []).filter(
              (w) =>
                ![
                  'expect',
                  'screen',
                  'button',
                  'await',
                  'const',
                  'test',
                  'true',
                  'false',
                  'query',
                  'role',
                ].includes(w),
            ),
          );
          const affinity = (b: (typeof bindings)[number]) =>
            [...words].filter((w) => b.code.toLowerCase().includes(w)).length;
          selected.sort((a, b) => affinity(b) - affinity(a));
          const strongest = selected.length ? affinity(selected[0]) : 0;
          const relevant = selected.filter((b) => affinity(b) === strongest).slice(0, 3);
          if (selected.filter((b) => affinity(b) === strongest).length > 3)
            omit(`Ambiguous event path in ${sourceFile}; only three candidate bindings included`);

          const bindingNames = (b: (typeof bindings)[number]) =>
            relevant.includes(b)
              ? Object.entries(b.handlers ?? {})
                  .filter(([event]) => eventNames.has(event))
                  .flatMap(([, refs]) => refs)
              : b.names;
          const stateNames = new Set<string>();
          const queueBinding = (b: (typeof bindings)[number], priority: number): void => {
            const key = `binding:${sourceFile}:${b.start}`;
            if (seen.has(key)) return;
            seen.add(key);
            pending.push({
              priority,
              run: () => {
                const line = text.slice(0, b.start).split('\n').length;
                const remaining = this.config.maxContextChars - chars;
                if (fragments.length >= this.config.maxFragments || remaining < b.code.length) {
                  omit(`Required Svelte binding omitted by budget: ${sourceFile}:${line}`);
                  return;
                }
                fragments.push({
                  file: sourceFile,
                  line,
                  endLine: line + b.code.split('\n').length - 1,
                  code: b.code,
                  reason: 'Svelte event/state/render binding',
                  priority,
                  required: true,
                });
                chars += b.code.length;
                for (const name of bindingNames(b)) {
                  const declaration = m.declarations.get(name);
                  if (declaration) {
                    for (const referenced of names(declaration)) stateNames.add(referenced);
                    add(
                      sourceFile,
                      declaration,
                      `Svelte binding reference to ${name}`,
                      depth,
                      true,
                      priority + 2,
                    );
                  }
                }
                if (b.component) {
                  const imported = m.imports.get(b.component);
                  const resolved = imported && this.resolve(sourceFile, imported.specifier);
                  // Leaf controls are external implementation context; the parent binding is primary evidence.
                  if (resolved && !/^(Button|Icon|Fa|Tooltip)$/.test(b.component))
                    exported(resolved, imported!.imported, depth + 1);
                }
              },
            });
          };
          for (const b of relevant) {
            for (const name of bindingNames(b)) {
              if (m.declarations.has(name)) stateNames.add(name);
              const declaration = m.declarations.get(name);
              if (declaration)
                for (const ref of names(declaration))
                  if (m.declarations.has(ref)) stateNames.add(ref);
            }
          }
          relevant.forEach((b) => queueBinding(b, -40));
          bindings
            .filter((b) => !relevant.includes(b) && b.names.some((n) => stateNames.has(n)))
            .sort((a, b) => Number(b.code.includes('bind:')) - Number(a.code.includes('bind:')))
            .forEach((b) => queueBinding(b, -36));
          if (!selected.length) {
            // Render-only tests still need props and conditional output, not a component prefix.
            bindings.slice(0, 8).forEach((b) => queueBinding(b, -35));
            if (bindings.length > 8)
              omit(`Render context is partial for ${sourceFile}; no matched event path`);
          }
          return;
        }
        if (symbol === '*') {
          warnings.add(`${sourceFile}: namespace import uses bounded declaration context`);
          for (const declaration of new Set(m.declarations.values()))
            add(sourceFile, declaration, 'Namespace import', depth);
          return;
        }
        const declaration = m.declarations.get(symbol);
        if (declaration) {
          if (ts.isClassDeclaration(declaration)) {
            const requested = new Set(methodsByClass.get(symbol) ?? []);
            const members = new Set<ts.ClassElement>();
            for (let pass = 0; pass < 4; pass++)
              for (const member of declaration.members) {
                if (
                  member.name &&
                  requested.has(member.name.getText(m.source)) &&
                  !members.has(member)
                ) {
                  members.add(member);
                  const visit = (n: ts.Node): void => {
                    if (
                      ts.isPropertyAccessExpression(n) &&
                      n.expression.kind === ts.SyntaxKind.ThisKeyword
                    )
                      requested.add(n.name.text);
                    ts.forEachChild(n, visit);
                  };
                  visit(member);
                }
              }
            if (members.size) {
              for (const member of members)
                add(
                  sourceFile,
                  member,
                  'Invoked instance member and its this references',
                  depth,
                  true,
                  -15,
                );
              return;
            }
            omit(`Instance methods unresolved for ${symbol} in ${sourceFile}`);
          }
          if (declaration.getText(m.source).length > 2400) {
            let candidates: readonly ts.Node[] = [];
            if (ts.isFunctionDeclaration(declaration) && declaration.body)
              candidates = declaration.body.statements;
            if (ts.isVariableStatement(declaration)) {
              let initializer = declaration.declarationList.declarations[0]?.initializer;
              while (
                initializer &&
                (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer))
              )
                initializer = initializer.expression;
              if (initializer && ts.isObjectLiteralExpression(initializer))
                candidates = initializer.properties;
            }
            const selected = candidates.filter((candidate) => {
              let matched = false;
              const visit = (node: ts.Node): void => {
                if (
                  (ts.isPropertyAccessExpression(node) && interest.has(node.name.text)) ||
                  (ts.isPropertyAssignment(node) && interest.has(node.name.getText(m.source)))
                )
                  matched = true;
                ts.forEachChild(node, visit);
              };
              visit(candidate);
              return matched;
            });
            if (selected.length) {
              warnings.add(
                `Selected relevant statements from ${symbol} in ${sourceFile}; enclosing declaration omitted`,
              );
              for (const statement of selected)
                add(sourceFile, statement, `Selected statement in ${symbol}`, depth);
              return;
            }
          }
          add(sourceFile, declaration, `Reference to ${symbol}`, depth);
          return;
        }
        const alias = m.exports.get(symbol);
        if (alias) {
          const targetFile = alias.specifier
            ? this.resolve(sourceFile, alias.specifier)
            : sourceFile;
          if (targetFile) exported(targetFile, alias.imported, depth + 1);
          else omit(`Unresolved re-export ${symbol} in ${sourceFile}`);
          return;
        }
        const imported = m.imports.get(symbol);
        if (imported) {
          const targetFile = this.resolve(sourceFile, imported.specifier);
          if (targetFile) exported(targetFile, imported.imported, depth + 1);
          return;
        }
        for (const specifier of m.stars) {
          const targetFile = this.resolve(sourceFile, specifier);
          if (targetFile) exported(targetFile, symbol, depth + 1);
        }
        if (!m.stars.length) omit(`Declaration ${symbol} not resolved in ${sourceFile}`);
      };
      const follow = (
        sourceFile: string,
        node: ts.Node,
        depth: number,
        required = true,
        rank?: number,
      ): void => {
        const m = this.module(sourceFile);
        for (const name of names(node)) {
          const declaration = (sourceFile === file ? scoped : m.declarations).get(name);
          if (declaration && declaration !== node)
            add(
              sourceFile,
              declaration,
              `Local reference to ${name}`,
              depth,
              required,
              sourceFile === file ? -49 + depth : rank,
            );
          const imported = m.imports.get(name);
          if (imported) {
            const resolved = this.resolve(sourceFile, imported.specifier);
            if (resolved) exported(resolved, imported.imported, depth);
            else if (
              imported.specifier.startsWith('.') ||
              Object.keys(this.config.aliases).some(
                (a) => imported.specifier === a || imported.specifier.startsWith(`${a}/`),
              )
            )
              omit(`Unresolved local import ${imported.specifier} in ${sourceFile}`);
          }
        }
        const visit = (child: ts.Node): void => {
          if (ts.isStringLiteralLike(child) && /\.(?:[cm]?[jt]sx?|svelte|css)$/.test(child.text)) {
            const referenced = this.files.has(child.text)
              ? child.text
              : this.resolve(sourceFile, child.text);
            if (referenced && !seen.has(`literal:${referenced}`)) {
              seen.add(`literal:${referenced}`);
              dependencies[referenced] = this.sources.digest(referenced);
              pending.push({
                priority: depth * 2 + 4,
                run: () => {
                  const remaining = Math.max(
                    0,
                    Math.min(1800, this.config.maxContextChars - chars),
                  );
                  if (!remaining || fragments.length >= this.config.maxFragments) {
                    warnings.add(`Referenced file omitted by context budget: ${referenced}`);
                    return;
                  }
                  const text = this.sources.read(referenced);
                  const code = text.slice(0, remaining);
                  fragments.push({
                    file: referenced,
                    line: 1,
                    endLine: code.split('\n').length,
                    code,
                    reason: 'Literal file reference; static excerpt, not evidence of execution',
                    priority: depth * 2 + 4,
                  });
                  chars += code.length;
                  if (code.length < text.length)
                    warnings.add(`Referenced file excerpt truncated: ${referenced}`);
                },
              });
            }
          }
          if (
            ts.isCallExpression(child) &&
            (child.expression.kind === ts.SyntaxKind.ImportKeyword ||
              chain(child.expression).some((p) =>
                ['require', 'importActual', 'importMock'].includes(p),
              ))
          ) {
            const specifier = child.arguments[0];
            if (specifier && ts.isStringLiteralLike(specifier)) {
              const resolved = this.resolve(sourceFile, specifier.text);
              if (resolved) exported(resolved, '*', depth);
              else if (
                specifier.text.startsWith('.') ||
                Object.keys(this.config.aliases).some(
                  (a) => specifier.text === a || specifier.text.startsWith(`${a}/`),
                )
              )
                warnings.add(`Dynamic import context unavailable: ${specifier.text}`);
            } else warnings.add('Computed import cannot be resolved statically');
          }
          ts.forEachChild(child, visit);
        };
        visit(node);
      };
      follow(file, test.node, 0);
      for (const hook of test.scope)
        if (!declaredNames(hook).length) add(file, hook, 'Test setup or teardown', 0);
      const neighborCandidates = tests
        .filter((t) => t !== test)
        .map((t) => ({
          t,
          overlap: [...testNames.get(t)!].filter((n) => testNames.get(test)!.has(n)).length,
        }))
        .sort(
          (a, b) =>
            b.overlap - a.overlap ||
            Math.abs(a.t.target.line - test.target.line) -
              Math.abs(b.t.target.line - test.target.line),
        )
        .slice(0, 2);
      for (const { t } of neighborCandidates)
        pending.push({
          priority: 100,
          run: () => {
            if (
              fragments.length >= this.config.maxFragments ||
              chars + t.target.code.length > this.config.maxContextChars
            ) {
              warnings.add(
                `Neighbor evidence omitted by budget: ${file}:${t.target.line}; redundancy unconfirmed`,
              );
              return;
            }
            fragments.push({
              file,
              line: t.target.line,
              endLine: t.target.endLine,
              code: t.target.code,
              reason: 'Neighbor test for overlap review',
              priority: 100,
              required: false,
            });
            chars += t.target.code.length;
          },
        });
      let steps = 0;
      while (pending.length && steps++ < 500) {
        pending.sort((a, b) => a.priority - b.priority);
        pending.shift()!.run();
      }
      if (pending.length) warnings.add('Context traversal work limit reached');
      fragments.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
      const targets: Target[] = [
        { ...test.target, code: test.target.code.slice(0, this.config.maxContextChars / 2) },
      ];
      const assertions = [
        ...assertionNodes(test.node, module).map((node) => ({ file, node, module })),
        ...helperAssertions,
      ];
      const assertionSeen = new Set<string>();
      const assertionOrdinals = new Map<string, number>();
      for (const assertion of assertions) {
        const key = `${assertion.file}:${assertion.node.pos}`;
        if (assertionSeen.has(key)) continue;
        assertionSeen.add(key);
        const loc = location(assertion.node, assertion.module.source);
        const identity = `${assertion.file}:${loc.code}`;
        const ordinal = assertionOrdinals.get(identity) ?? 0;
        assertionOrdinals.set(identity, ordinal + 1);
        const id = hash([test.target.id, assertion.file, loc.code, ordinal]);
        targets.push({
          id,
          parentId: test.target.id,
          kind: 'assertion',
          name: `${test.target.name} / assertion ${targets.length}`,
          file: assertion.file,
          ...loc,
          code: loc.code.slice(0, 4000),
          status: test.target.status,
          findings: checkAssertion(assertion.node, assertion.module.source),
        });
        if (loc.code.length > 4000) warnings.add('Assertion exceeds excerpt budget');
      }
      if (!assertions.length)
        warnings.add(
          'No recognized assertion sites; may use custom helpers or implicit failure checks',
        );
      if (chain(test.node.expression).some((p) => ['each', 'for'].includes(p)))
        warnings.add('Parameterized test: one static declaration, not expanded runtime cases');
      targets[0].findings = [
        ...targets.slice(1).flatMap((target) => target.findings ?? []),
        ...checkFixtureLayout(
          test.node,
          [...new Set(fragments.map((fragment) => fragment.file))]
            .filter((related) => related.endsWith('.svelte'))
            .map((related) => ({ file: related, code: this.sources.read(related) })),
        ),
      ];
      for (const warning of warnings)
        if (
          /unresolved|not resolved|unavailable|Computed import|syntax diagnostics|parse failed|Assertion exceeds|work limit|Selected relevant statements|Referenced file excerpt truncated/.test(
            warning,
          ) &&
          !requiredOmissions.includes(warning)
        )
          requiredOmissions.push(warning);
      const trace: Trace = {
        id: '',
        version: ANALYZER_VERSION,
        file,
        targets,
        fragments,
        evidence: {
          completeness: requiredOmissions.length ? 'partial' : 'bounded',
          omissions: requiredOmissions,
        },
        warnings: [...warnings],
        dependencies: {},
      };
      traces.push(trace);
    }
    const source = this.sources.read(file);
    const fileTarget: Target = {
      id: hash([file, 'file']),
      kind: 'file',
      name: file,
      file,
      line: 1,
      endLine: source.split('\n').length,
      code: tests.length ? '' : source.slice(0, this.config.maxContextChars),
      status: 'active',
      findings: traces.flatMap((trace) => trace.targets[0].findings ?? []),
    };
    const perTestBudget = Math.max(
      0,
      Math.floor(this.config.maxContextChars / Math.max(1, tests.length)) - 150,
    );
    const overview = tests
      .map(
        ({ target }) =>
          `${target.line}: [${target.status}] ${target.name}\n${target.code.slice(0, perTestBudget)}`,
      )
      .join('\n\n');
    const warnings = [...module.warnings];
    if (!tests.length)
      warnings.push(
        'No recognized test declarations; may use generated suites or custom registration',
      );
    if (tests.some(({ target }) => target.code.length > perTestBudget))
      warnings.push('File-level test excerpts truncated; inspect individual test traces');
    if (overview.length > this.config.maxContextChars)
      warnings.push('File inventory exceeds context budget; truncated');
    traces.unshift({
      id: '',
      version: ANALYZER_VERSION,
      file,
      targets: [fileTarget],
      fragments: [
        {
          file,
          line: 1,
          endLine: fileTarget.endLine,
          code: overview.slice(0, this.config.maxContextChars),
          reason: 'Test inventory and bounded declaration excerpts',
        },
      ],
      dependencies: {},
      warnings: [
        ...warnings,
        'File judgment uses bounded excerpts; use test and assertion scores for detailed evidence',
      ],
    });
    for (const trace of traces) {
      trace.dependencies = { ...dependencies };
      trace.id = hash(trace);
    }
    return { traces, dependencies, warnings };
  }
}
