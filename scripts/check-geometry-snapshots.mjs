import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const retiredIdentifiers = new Set([
  'defineGeometrySnapshotSuite',
  'SANDBOX_GEOMETRY_UPDATE',
  'SANDBOX_GEOMETRY_UPDATE_ALLOW_NON_LINUX',
]);
const retiredModule = /(?:^|\/)geometry-snapshot(?:\.[cm]?[jt]s)?$/;
const testPath =
  /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:test|tests|__tests__|e2e|playwright)\/)/;
const measurementMethods = new Set([
  'getBoundingClientRect',
  'getClientRects',
  'boundingBox',
  'getBBox',
  'getComputedStyle',
]);
const measurementProperties =
  /^(?:(?:offset|client)(?:Width|Height|Top|Left)|scroll(?:Width|Height))$/;
const geometryProperty =
  /^(?:width|height|top|left|right|bottom|x|y|inlineSize|blockSize|gap|padding|margin|fontSize|lineHeight)|(?:Width|Height|Widths|Heights)$/;
const equalityMatchers = new Set([
  'toBe',
  'toEqual',
  'toStrictEqual',
  'toMatchObject',
  'toBeCloseTo',
]);

function unwrap(node) {
  while (
    node &&
    (ts.isAwaitExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node))
  )
    node = node.expression;
  return node;
}

function memberName(node) {
  node = unwrap(node);
  if (!node) return undefined;
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression))
    return node.argumentExpression.text;
  return undefined;
}

function geometryBaselineViolations(file, source) {
  if (!testPath.test(file)) return [];
  const definitions = new Map();
  const importedBaselines = new Set();
  const parameterInputs = new Map();
  function define(name, value, declaration, field) {
    let scope = declaration.parent;
    while (scope && !ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
    const existing = definitions.get(name) ?? [];
    existing.push({ value, scope, field });
    definitions.set(name, existing);
  }
  function collect(node) {
    if (
      ts.isCallExpression(node) &&
      /^(?:map|flatMap)$/.test(memberName(node.expression) ?? '') &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const callback = node.arguments[0];
      if (
        callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        callback.parameters[0]
      )
        parameterInputs.set(callback.parameters[0], node.expression.expression);
    }
    if (
      ts.isImportDeclaration(node) &&
      /\.json$|baseline|golden|snapshot|(?:^|\/)tokens?(?:[./-]|$)/i.test(node.moduleSpecifier.text)
    ) {
      if (node.importClause?.name) importedBaselines.add(node.importClause.name.text);
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) importedBaselines.add(bindings.name.text);
      else if (bindings)
        for (const binding of bindings.elements) importedBaselines.add(binding.name.text);
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) define(node.name.text, node.initializer, node);
      else
        for (const binding of node.name.elements) {
          if (binding.name && ts.isIdentifier(binding.name))
            define(
              binding.name.text,
              node.initializer,
              node,
              ts.isObjectBindingPattern(node.name)
                ? (binding.propertyName?.text ?? binding.name.text)
                : undefined,
            );
        }
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body)
      define(node.name.text, node.body, node);
    ts.forEachChild(node, collect);
  }
  collect(source);

  function valuesFor(node) {
    let scope = node.parent;
    const candidates = definitions.get(node.text) ?? [];
    while (scope) {
      const local = candidates.filter((entry) => entry.scope === scope);
      if (local.length)
        return local.flatMap(({ value, field }) => {
          const selected = field && fields(value, field);
          return selected?.length ? selected : [value];
        });
      if (ts.isFunctionLike(scope)) {
        const parameter = scope.parameters.find(
          (part) => ts.isIdentifier(part.name) && part.name.text === node.text,
        );
        if (parameter)
          return parameterInputs.has(parameter) ? [parameterInputs.get(parameter)] : [];
      }
      scope = scope.parent;
    }
    return [];
  }
  function fields(node, name, seen = new Set()) {
    if (!node || seen.has(node)) return [];
    seen.add(node);
    node = unwrap(node);
    if (ts.isIdentifier(node)) return valuesFor(node).flatMap((value) => fields(value, name, seen));
    if (ts.isObjectLiteralExpression(node))
      return node.properties.flatMap((property) => {
        if (ts.isSpreadAssignment(property)) return fields(property.expression, name, seen);
        const key =
          property.name && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
            ? property.name.text
            : undefined;
        if (key !== name) return [];
        return ts.isPropertyAssignment(property)
          ? [property.initializer]
          : ts.isShorthandPropertyAssignment(property)
            ? [property.name]
            : [];
      });
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      return fields(node.expression, memberName(node), seen).flatMap((value) =>
        fields(value, name, seen),
      );
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
      return fields(node.body, name, seen);
    if (ts.isCallExpression(node)) {
      if (
        memberName(node.expression) === 'toJSON' &&
        ts.isPropertyAccessExpression(node.expression)
      )
        return fields(node.expression.expression, name, seen);
      if (/^(?:evaluate|evaluateAll)$/.test(memberName(node.expression) ?? ''))
        return fields(node.arguments[0], name, seen);
      if (ts.isIdentifier(node.expression))
        return valuesFor(node.expression).flatMap((value) => fields(value, name, seen));
    }
    if (ts.isBlock(node)) {
      const values = [];
      function returned(part) {
        if (ts.isReturnStatement(part)) values.push(...fields(part.expression, name, seen));
        else if (!ts.isFunctionLike(part)) ts.forEachChild(part, returned);
      }
      ts.forEachChild(node, returned);
      return values;
    }
    return [];
  }
  function inspect(node, predicate, seen = new Set(), dimensionsOnly = false) {
    if (!node || seen.has(node)) return false;
    seen.add(node);
    node = unwrap(node);
    if (
      dimensionsOnly &&
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.MinusToken &&
      runtimeDelta(node)
    )
      return false;
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const selected = fields(node.expression, memberName(node));
      if (selected.length)
        return selected.some((value) => inspect(value, predicate, seen, dimensionsOnly));
    }
    if (predicate(node)) return true;
    if (ts.isCallExpression(node)) {
      const method = memberName(node.expression);
      if (method === 'toJSON' && ts.isPropertyAccessExpression(node.expression))
        return inspect(node.expression.expression, predicate, seen, dimensionsOnly);
      if (/^(?:evaluate|evaluateAll)$/.test(method ?? ''))
        return inspect(node.arguments[0], predicate, seen, dimensionsOnly);
      if (/^(?:map|flatMap)$/.test(method ?? ''))
        return inspect(node.arguments[0], predicate, seen, dimensionsOnly);
      if (method === 'from' && node.arguments.length > 1)
        return inspect(node.arguments[1], predicate, seen, dimensionsOnly);
      if (ts.isIdentifier(node.expression) && valuesFor(node.expression).length)
        return valuesFor(node.expression).some((value) =>
          inspect(value, predicate, seen, dimensionsOnly),
        );
      if (
        !/^(?:abs|round|ceil|floor|min|max|parseFloat|parseInt|Number|String|all|map|flatMap|reduce|filter|freeze|values|entries|from|parse)$/.test(
          method ?? '',
        )
      )
        return false;
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        inspect(node.expression.expression, predicate, seen, dimensionsOnly)
      )
        return true;
      return node.arguments.some((argument) => inspect(argument, predicate, seen, dimensionsOnly));
    }
    if (ts.isBlock(node)) {
      function returned(part) {
        if (ts.isReturnStatement(part))
          return inspect(part.expression, predicate, seen, dimensionsOnly);
        if (ts.isFunctionLike(part)) return false;
        return ts.forEachChild(part, returned) ?? false;
      }
      return ts.forEachChild(node, returned) ?? false;
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
      return inspect(node.body, predicate, seen, dimensionsOnly);
    if (ts.isPropertyAssignment(node))
      return inspect(node.initializer, predicate, seen, dimensionsOnly);
    if (ts.isIdentifier(node)) {
      return valuesFor(node).some((value) => inspect(value, predicate, seen, dimensionsOnly));
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (dimensionsOnly && !geometryProperty.test(memberName(node) ?? '')) return false;
      return inspect(node.expression, predicate, seen, dimensionsOnly);
    }
    return (
      ts.forEachChild(node, (child) => inspect(child, predicate, seen, dimensionsOnly)) ?? false
    );
  }
  function measured(node) {
    return inspect(
      node,
      (part) =>
        (ts.isCallExpression(part) && measurementMethods.has(memberName(part.expression))) ||
        ((ts.isPropertyAccessExpression(part) || ts.isElementAccessExpression(part)) &&
          measurementProperties.test(memberName(part) ?? '')),
    );
  }
  function observations(node, seen = new Set()) {
    if (!node || seen.has(node)) return [];
    seen.add(node);
    node = unwrap(node);
    if (ts.isIdentifier(node)) return valuesFor(node).flatMap((value) => observations(value, seen));
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      return observations(node.expression, seen).map((value) => `${value}.${memberName(node)}`);
    if (ts.isCallExpression(node) && measured(node))
      return [node.getText(source).replace(/\s+/g, '')];
    return [];
  }
  function runtimeDelta(node) {
    const before = observations(node.left);
    const after = observations(node.right);
    return (
      before.length > 0 &&
      after.length === before.length &&
      before.every((value) => after.includes(value))
    );
  }
  function fixedNumbers(node) {
    node = node && unwrap(node);
    if (
      node &&
      ts.isBinaryExpression(node) &&
      ![
        ts.SyntaxKind.PlusToken,
        ts.SyntaxKind.MinusToken,
        ts.SyntaxKind.AsteriskToken,
        ts.SyntaxKind.SlashToken,
        ts.SyntaxKind.PercentToken,
        ts.SyntaxKind.AsteriskAsteriskToken,
      ].includes(node.operatorToken.kind)
    )
      return false;
    return inspect(
      node,
      (part) =>
        (ts.isNumericLiteral(part) && Number(part.text) !== 0) ||
        (ts.isStringLiteralLike(part) &&
          /(?:^|\s)-?(?:[1-9]\d*(?:\.\d+)?|0\.\d+)(?:px|rem|em|%)(?:$|\s)/.test(part.text)) ||
        (ts.isIdentifier(part) && importedBaselines.has(part.text)) ||
        (ts.isCallExpression(part) &&
          /^(?:readFile|readFileSync|json)$/.test(memberName(part.expression) ?? '')),
    );
  }
  function geometry(node) {
    return inspect(
      node,
      (part) => {
        if (ts.isCallExpression(part) && measurementMethods.has(memberName(part.expression)))
          return true;
        const member = memberName(part);
        return (
          ((ts.isPropertyAccessExpression(part) || ts.isElementAccessExpression(part)) &&
            measurementProperties.test(member ?? '')) ||
          (geometryProperty.test(member ?? '') && measured(part.expression))
        );
      },
      new Set(),
      true,
    );
  }
  function fixedDifference(node) {
    function visit(part) {
      if (
        ts.isBinaryExpression(part) &&
        part.operatorToken.kind === ts.SyntaxKind.MinusToken &&
        ((geometry(part.left) && !measured(part.right) && fixedNumbers(part.right)) ||
          (geometry(part.right) && !measured(part.left) && fixedNumbers(part.left)))
      )
        return true;
      return ts.forEachChild(part, visit) ?? false;
    }
    return visit(node);
  }
  function fixedBaseline(actual, expected, seen = new Set()) {
    if (!expected || seen.has(expected)) return false;
    seen.add(expected);
    expected = unwrap(expected);
    if (ts.isIdentifier(expected) && valuesFor(expected).length)
      return valuesFor(expected).some((value) => fixedBaseline(actual, value, seen));
    if (ts.isObjectLiteralExpression(expected))
      return expected.properties.some((property) => {
        if (!ts.isPropertyAssignment(property)) return false;
        const name = property.name.text;
        const selected = fields(actual, name);
        return selected.length
          ? selected.some((value) => fixedBaseline(value, property.initializer, seen))
          : (geometryProperty.test(name ?? '') || measurementProperties.test(name ?? '')) &&
              geometry(actual) &&
              fixedNumbers(property.initializer);
      });
    if (ts.isArrayLiteralExpression(expected))
      return expected.elements.some((element) => fixedBaseline(actual, element, new Set(seen)));
    return geometry(actual) && !measured(expected) && fixedNumbers(expected);
  }
  function fixedRange(actual, expected, method) {
    if (measured(expected) || !fixedNumbers(expected)) return false;
    function numericConstant(node, seen = new Set()) {
      if (!node || seen.has(node)) return undefined;
      seen.add(node);
      node = unwrap(node);
      if (ts.isNumericLiteral(node)) return Number(node.text);
      if (ts.isIdentifier(node)) {
        const values = valuesFor(node);
        return values.length === 1 ? numericConstant(values[0], seen) : undefined;
      }
      if (ts.isBinaryExpression(node)) {
        const left = numericConstant(node.left, new Set(seen));
        const right = numericConstant(node.right, new Set(seen));
        if (left === undefined || right === undefined) return undefined;
        switch (node.operatorToken.kind) {
          case ts.SyntaxKind.PlusToken:
            return left + right;
          case ts.SyntaxKind.MinusToken:
            return left - right;
          case ts.SyntaxKind.AsteriskToken:
            return left * right;
          case ts.SyntaxKind.SlashToken:
            return left / right;
        }
      }
      return undefined;
    }
    const value = numericConstant(expected);
    if (value === undefined) return false;
    if (
      inspect(
        actual,
        (part) =>
          (ts.isPropertyAccessExpression(part) || ts.isElementAccessExpression(part)) &&
          /^scroll(?:Top|Left|Width|Height)$/.test(memberName(part) ?? ''),
      )
    )
      return false;
    const difference = (part) =>
      ts.isBinaryExpression(part) &&
      part.operatorToken.kind === ts.SyntaxKind.MinusToken &&
      (measured(part.left) || measured(part.right));
    const span = (part) => {
      if (!difference(part)) return false;
      const edges = [memberName(part.left), memberName(part.right)];
      return (
        (edges.some((edge) => /^(?:left|x)$/.test(edge ?? '')) && edges.includes('right')) ||
        (edges.some((edge) => /^(?:top|y)$/.test(edge ?? '')) && edges.includes('bottom'))
      );
    };
    if (inspect(actual, difference) && (value <= 1 || !inspect(actual, span))) return false;
    if (
      /GreaterThanOrEqual$/.test(method) &&
      value === 24 &&
      inspect(
        actual,
        (part) =>
          (ts.isPropertyAccessExpression(part) || ts.isElementAccessExpression(part)) &&
          /^(?:(?:client|offset)?(?:width|height))$/i.test(memberName(part) ?? '') &&
          measured(part),
      )
    )
      return false;
    return true;
  }
  function fixedRelational(node) {
    if (!ts.isBinaryExpression(node)) return false;
    const method = new Map([
      [ts.SyntaxKind.LessThanToken, 'toBeLessThan'],
      [ts.SyntaxKind.LessThanEqualsToken, 'toBeLessThanOrEqual'],
      [ts.SyntaxKind.GreaterThanToken, 'toBeGreaterThan'],
      [ts.SyntaxKind.GreaterThanEqualsToken, 'toBeGreaterThanOrEqual'],
    ]).get(node.operatorToken.kind);
    if (!method) return false;
    const reverse = method.includes('Less')
      ? method.replace('Less', 'Greater')
      : method.replace('Greater', 'Less');
    return (
      (geometry(node.left) && fixedRange(node.left, node.right, method)) ||
      (geometry(node.right) && fixedRange(node.right, node.left, reverse))
    );
  }
  const hits = [];
  function report(node) {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    hits.push(
      `${file}:${line + 1}: DOM geometry must not be compared with fixed or generated appearance baselines`,
    );
  }
  function visit(node) {
    if (
      ts.isBinaryExpression(node) &&
      [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken].includes(
        node.operatorToken.kind,
      )
    ) {
      if (
        (geometry(node.left) && !measured(node.right) && fixedNumbers(node.right)) ||
        (geometry(node.right) && !measured(node.left) && fixedNumbers(node.left))
      )
        report(node);
    }
    if (ts.isCallExpression(node)) {
      const method = memberName(node.expression);
      if (
        method === 'toHaveCSS' &&
        node.arguments.length >= 2 &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        /^(?:(?:min-|max-)?(?:width|height)|(?:padding|margin|inset)(?:-.+)?|(?:row-|column-)?gap|top|right|bottom|left|(?:border(?:-[a-z]+)*|outline)-(?:width|radius|offset)|font-size|line-height)$/.test(
          node.arguments[0].text,
        ) &&
        fixedNumbers(node.arguments[1])
      )
        report(node);
      if (
        equalityMatchers.has(method) ||
        /^(?:toBeTruthy|toBeFalsy)$/.test(method ?? '') ||
        /^toBe(?:Less|Greater)Than(?:OrEqual)?$/.test(method ?? '') ||
        /^(?:toMatchSnapshot|toMatchInlineSnapshot)$/.test(method ?? '')
      ) {
        const expression = unwrap(node.expression);
        let assertion = unwrap(expression.expression);
        while (
          assertion &&
          (ts.isPropertyAccessExpression(assertion) || ts.isElementAccessExpression(assertion))
        )
          assertion = assertion.expression;
        if (assertion && ts.isCallExpression(assertion)) {
          const actual = assertion.arguments[0];
          const expected = node.arguments[0];
          if (
            actual &&
            geometry(actual) &&
            (inspect(actual, fixedRelational) ||
              /^(?:toMatchSnapshot|toMatchInlineSnapshot)$/.test(method ?? '') ||
              (/^toBe(?:Less|Greater)Than(?:OrEqual)?$/.test(method ?? '') &&
                ((fixedDifference(actual) && !measured(expected) && fixedNumbers(expected)) ||
                  fixedRange(actual, expected, method))) ||
              (equalityMatchers.has(method) && fixedBaseline(actual, expected)) ||
              (!measured(expected) &&
                /baseline|golden|snapshot/i.test(expected?.getText(source) ?? '')))
          ) {
            report(node);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return hits;
}

function sourceViolations(file, content) {
  if (
    !/defineGeometrySnapshotSuite|SANDBOX_GEOMETRY_UPDATE|geometry-snapshot|toHaveCSS|getBoundingClientRect|getClientRects|boundingBox|getBBox|getComputedStyle|(?:offset|client|scroll)(?:Width|Height|Top|Left)/.test(
      content,
    )
  )
    return [];
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const hits = geometryBaselineViolations(file, source);
  function visit(node) {
    const retiredIdentifier = ts.isIdentifier(node) && retiredIdentifiers.has(node.text);
    const retiredString =
      ts.isStringLiteral(node) &&
      ((ts.isElementAccessExpression(node.parent) && retiredIdentifiers.has(node.text)) ||
        ((ts.isImportDeclaration(node.parent) ||
          ts.isExportDeclaration(node.parent) ||
          ts.isCallExpression(node.parent)) &&
          retiredModule.test(node.text)));
    if (retiredIdentifier || retiredString) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      hits.push(`${file}:${line + 1}: retired geometry snapshot API or regeneration hook`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return hits;
}

function checkGeometrySnapshots(root) {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  ).split('\0');
  const hits = [];
  for (const file of new Set(files.filter(Boolean))) {
    const absolute = path.join(root, file);
    if (!existsSync(absolute)) continue;
    if (
      /(?:^|\/)(?:__geometry__|(?:geometry|layout|dom)[-_]baselines)(?:\/|$)|\.(?:geometry|layout-baseline)\.json$|(?:^|\/)geometry-snapshot\.[cm]?[jt]s$/.test(
        file,
      )
    ) {
      hits.push(`${file}: saved geometry baselines and snapshot helpers are prohibited`);
      continue;
    }
    if (/\.[cm]?[jt]sx?$/.test(file)) {
      hits.push(...sourceViolations(file, readFileSync(absolute, 'utf8')));
    }
    if (path.basename(file) === 'package.json') {
      const { scripts = {} } = JSON.parse(readFileSync(absolute, 'utf8'));
      for (const [name, command] of Object.entries(scripts)) {
        if (
          name === 'sandbox:geometry:update' ||
          /SANDBOX_GEOMETRY_UPDATE|sandbox:geometry:update|--grep\s+['"]geometry snapshot/.test(
            command,
          )
        ) {
          hits.push(`${file}: ${name} restores geometry snapshot regeneration`);
        }
      }
    }
  }
  return hits;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hits = checkGeometrySnapshots(process.cwd());
  if (hits.length) {
    console.error(hits.join('\n'));
    console.error(
      'Remove DOM appearance baselines, including inline constants. Test behavior and use manual screenshots/probes. No exemptions.',
    );
    process.exitCode = 1;
  } else {
    console.log(
      'Geometry baseline ban passed: no stored snapshots or fixed DOM measurement baselines.',
    );
  }
}
