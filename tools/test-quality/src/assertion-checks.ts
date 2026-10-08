import ts from 'typescript';
import { parse } from 'svelte/compiler';
import type { Finding } from './types.ts';

export const CHECKS_VERSION = '2';

function unwrap(node: ts.Node): ts.Node {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression;
  return node;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function binding(identifier: ts.Identifier): ts.VariableDeclaration | undefined {
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    if (
      ts.isFunctionLike(scope) &&
      scope.parameters.some((p) => p.name.getText() === identifier.text)
    )
      return;
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    if (ts.isSourceFile(scope)) return;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.name.getText() === identifier.text) {
          if (
            !(statement.declarationList.flags & ts.NodeFlags.Const) ||
            declaration.pos > identifier.pos
          )
            return;
          return declaration;
        }
      }
    }
  }
}

function fixtureValue(node: ts.Node, seen = new Set<ts.Node>()): ts.Node | undefined {
  node = unwrap(node);
  if (seen.has(node)) return;
  seen.add(node);
  if (
    ts.isLiteralExpression(node) ||
    [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(
      node.kind,
    )
  )
    return node;
  if (ts.isIdentifier(node)) {
    const declaration = binding(node);
    return declaration?.initializer ? fixtureValue(declaration.initializer, seen) : undefined;
  }
  if (ts.isObjectLiteralExpression(node))
    return node.properties.every(
      (p) => ts.isPropertyAssignment(p) && fixtureValue(p.initializer, new Set(seen)),
    )
      ? node
      : undefined;
  if (ts.isArrayLiteralExpression(node))
    return node.elements.every((e) => fixtureValue(e, new Set(seen))) ? node : undefined;
  if (ts.isPropertyAccessExpression(node)) {
    const owner = fixtureValue(node.expression, seen);
    if (owner && ts.isObjectLiteralExpression(owner)) {
      const property = owner.properties.find(
        (p) =>
          ts.isPropertyAssignment(p) &&
          p.name.getText().replace(/^['"]|['"]$/g, '') === node.name.text,
      );
      if (property && ts.isPropertyAssignment(property))
        return fixtureValue(property.initializer, seen);
    }
    if (owner && ts.isArrayLiteralExpression(owner) && node.name.text === 'length') return owner;
  }
  return;
}

function preceding(node: ts.Node): ts.Statement[] {
  let statement = node;
  while (statement.parent && !ts.isBlock(statement.parent) && !ts.isSourceFile(statement.parent))
    statement = statement.parent;
  const block = statement.parent;
  return block && (ts.isBlock(block) || ts.isSourceFile(block))
    ? [...block.statements].filter((s) => s.end <= statement.pos)
    : [];
}

function guarded(node: ts.Node, expression: string): boolean {
  for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      parent.right.pos <= node.pos
    ) {
      const left = parent.left.getText().replace(/[()\s]/g, '');
      if (left === expression || left === `!!${expression}`) return true;
    }
    if (ts.isFunctionLike(parent)) break;
  }
  return preceding(node).some((statement) => {
    if (!ts.isIfStatement(statement) || statement.elseStatement) return false;
    const condition = statement.expression.getText().replace(/[()\s]/g, '');
    if (
      ![
        `!${expression}`,
        `${expression}==null`,
        `${expression}===null`,
        `${expression}===undefined`,
      ].includes(condition)
    )
      return false;
    const body = ts.isBlock(statement.thenStatement)
      ? statement.thenStatement.statements
      : [statement.thenStatement];
    return (
      body.length === 1 &&
      (ts.isThrowStatement(body[0]) ||
        (ts.isReturnStatement(body[0]) && body[0].expression?.kind === ts.SyntaxKind.FalseKeyword))
    );
  });
}

function assertedNonempty(node: ts.Node, expression: string): boolean {
  return preceding(node)
    .slice(-1)
    .some((statement) => {
      if (!ts.isExpressionStatement(statement)) return false;
      let found = false;
      walk(statement, (child) => {
        if (!ts.isCallExpression(child) || !ts.isPropertyAccessExpression(child.expression)) return;
        const matcher = child.expression.name.text;
        const call = child.expression.expression;
        if (!ts.isCallExpression(call) || call.expression.getText() !== 'expect') return;
        const arg = call.arguments[0]?.getText();
        const expected = child.arguments[0];
        if (!expected || !ts.isNumericLiteral(expected)) return;
        if (matcher === 'toHaveLength' && arg === expression && Number(expected.text) > 0)
          found = true;
        if (
          matcher === 'toBeGreaterThan' &&
          arg === `${expression}.length` &&
          Number(expected.text) >= 0
        )
          found = true;
      });
      return found;
    });
}

export function checkAssertion(node: ts.CallExpression, source: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];
  const add = (rule: Finding['rule'], evidence: ts.Node, message: string) =>
    findings.push({
      rule,
      certainty: 'review',
      file: source.fileName,
      line: source.getLineAndCharacterOfPosition(evidence.getStart(source)).line + 1,
      code: evidence.getText(source).slice(0, 1000),
      message,
    });
  const outer = node.expression;
  if (!ts.isPropertyAccessExpression(outer)) return findings;
  const positiveTrue =
    ['toBe', 'toEqual', 'toStrictEqual'].includes(outer.name.text) &&
    node.arguments[0]?.kind === ts.SyntaxKind.TrueKeyword;
  let root: ts.Node = outer.expression;
  while (ts.isPropertyAccessExpression(root)) {
    if (root.name.text === 'not') return findings;
    root = root.expression;
  }
  if (!ts.isCallExpression(root)) return findings;
  const callee = root.expression;
  const direct = ts.isIdentifier(callee) && callee.text === 'expect';
  const poll =
    ts.isPropertyAccessExpression(callee) &&
    callee.expression.getText() === 'expect' &&
    callee.name.text === 'poll';
  if (!direct && !poll) return findings;
  const actual = root.arguments[0];
  if (!actual) return findings;
  if (positiveTrue)
    walk(actual, (child) => {
      if (
        ts.isBinaryExpression(child) &&
        [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(
          child.operatorToken.kind,
        )
      ) {
        const left = unwrap(child.left),
          right = unwrap(child.right);
        if (
          ts.isPropertyAccessExpression(left) &&
          ts.isPropertyAccessExpression(right) &&
          left.questionDotToken &&
          right.questionDotToken &&
          left.expression.getText() === right.expression.getText() &&
          !guarded(child, left.expression.getText())
        ) {
          add(
            'nullish-equality',
            child,
            'Both optional accesses become undefined when their shared base is missing, so equality can pass without observing either value. Confirm a presence guard on every path.',
          );
        }
      }
      if (
        ts.isCallExpression(child) &&
        ts.isPropertyAccessExpression(child.expression) &&
        child.expression.name.text === 'every' &&
        !assertedNonempty(node, child.expression.expression.getText())
      ) {
        add(
          'empty-every',
          child,
          'every() returns true for an empty collection. Confirm emptiness is valid or assert nonempty input before treating this as evidence.',
        );
      }
    });
  if (direct && fixtureValue(actual)) {
    // Calls or writes before the assertion can mutate a const object's properties.
    const unsafe = preceding(node).some((statement) => {
      let effect = false;
      walk(statement, (child) => {
        if (
          (ts.isCallExpression(child) && !/^expect(?:\(|\.)/.test(child.getText())) ||
          ts.isAwaitExpression(child) ||
          ts.isNewExpression(child) ||
          ts.isDeleteExpression(child) ||
          (ts.isBinaryExpression(child) &&
            child.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
            child.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
          ts.isPostfixUnaryExpression(child) ||
          (ts.isPrefixUnaryExpression(child) &&
            [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(child.operator))
        )
          effect = true;
      });
      return effect;
    });
    if (!unsafe)
      add(
        'fixture-only-value',
        actual,
        'The observed value resolves to local literal data without a production call on this path. The assertion may only repeat its fixture; type checks are a separate contract.',
      );
  }
  return findings;
}

export function checkFixtureLayout(
  source: ts.Node,
  related: { file: string; code: string }[],
): Finding[] {
  const selectors = new Set<string>();
  let measuresLayout = false;
  walk(source, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ['getComputedStyle'].includes(node.expression.text)
    )
      measuresLayout = true;
    if (
      ts.isPropertyAccessExpression(node) &&
      ['getBoundingClientRect', 'boundingBox', 'scrollWidth', 'clientWidth'].includes(
        node.name.text,
      )
    )
      measuresLayout = true;
    if (ts.isStringLiteralLike(node)) selectors.add(node.text);
  });
  if (!measuresLayout) return [];
  const findings: Finding[] = [];
  for (const fixture of related) {
    if (
      !fixture.file.endsWith('.svelte') ||
      !/(?:^|\/)(?:__tests__|test|tests)\//.test(fixture.file)
    )
      continue;
    let tree: unknown;
    try {
      tree = parse(fixture.code, { modern: true });
    } catch {
      continue;
    }
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      const element = value as {
        type?: string;
        start?: number;
        end?: number;
        attributes?: { type: string; name: string; start: number; end: number; value: unknown }[];
      };
      if (element.type === 'RegularElement') {
        const attrs = element.attributes ?? [];
        const matched = attrs.find((attr) => {
          if (
            attr.type !== 'Attribute' ||
            !Array.isArray(attr.value) ||
            attr.value.length !== 1 ||
            attr.value[0]?.type !== 'Text'
          )
            return false;
          const value = attr.value[0].data;
          return (
            selectors.has(`[${attr.name}="${value}"]`) || selectors.has(`[${attr.name}='${value}']`)
          );
        });
        const layout = attrs.find(
          (attr) =>
            attr.name === 'class' &&
            /\b(?:m[trblxy]?|p[trblxy]?|gap|h|w)-/.test(fixture.code.slice(attr.start, attr.end)),
        );
        if (matched && layout)
          findings.push({
            rule: 'fixture-owned-layout',
            certainty: 'review',
            file: fixture.file,
            line: fixture.code.slice(0, layout.start).split('\n').length,
            code: fixture.code.slice(layout.start, layout.end),
            message:
              'This measured element and its layout classes are authored in a test fixture. Check that the assertion observes production behavior rather than spacing imposed by the fixture.',
          });
      }
      for (const [key, child] of Object.entries(value))
        if (key !== 'loc') {
          if (Array.isArray(child)) child.forEach(visit);
          else visit(child);
        }
    };
    visit(tree);
  }
  return findings;
}
