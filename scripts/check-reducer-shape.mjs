import ts from 'typescript';

const REDUCER_PATH = /^src\/store\/(?:main|renderer)\/slices\/.+\/[^/]+-slice\.ts$/;
const CREATE_REDUCER_MODULE = '@augmentcode/themis/utils/store/create-reducer';

function normalize(filePath) {
  return filePath.split('\\').join('/').replace(/^\.\//, '');
}

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function lineFor(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function factoryBindings(source) {
  const identifiers = new Set();
  const namespaces = new Set();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== CREATE_REDUCER_MODULE
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        if ((binding.propertyName?.text ?? binding.name.text) === 'createReducer') {
          identifiers.add(binding.name.text);
        }
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    }
  }
  const isFactoryReference = (node) =>
    (ts.isIdentifier(node) && identifiers.has(node.text)) ||
    (ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaces.has(node.expression.text) &&
      node.name.text === 'createReducer');
  let changed = true;
  while (changed) {
    changed = false;
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          isFactoryReference(declaration.initializer) &&
          !identifiers.has(declaration.name.text)
        ) {
          identifiers.add(declaration.name.text);
          changed = true;
        }
      }
    }
  }
  return isFactoryReference;
}

function directExportedReducer(call) {
  const declaration = call.parent;
  if (
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer !== call ||
    !ts.isIdentifier(declaration.name)
  ) {
    return undefined;
  }
  const declarationList = declaration.parent;
  const statement = declarationList.parent;
  if (
    !ts.isVariableDeclarationList(declarationList) ||
    !(declarationList.flags & ts.NodeFlags.Const) ||
    !ts.isVariableStatement(statement) ||
    !hasModifier(statement, ts.SyntaxKind.ExportKeyword)
  ) {
    return undefined;
  }
  return { name: declaration.name.text, declaration };
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

export function inspectReducerShape(files) {
  const violations = [];
  let reducerCount = 0;
  let registrationCount = 0;
  for (const file of files) {
    const filePath = normalize(file.path);
    if (!REDUCER_PATH.test(filePath)) continue;
    const source = ts.createSourceFile(filePath, file.content, ts.ScriptTarget.Latest, true);
    const diagnostic = source.parseDiagnostics[0];
    if (diagnostic) {
      const line = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
      violations.push(`${filePath}:${line}: TypeScript parse failure`);
      continue;
    }
    const isFactoryReference = factoryBindings(source);
    const reducers = new Map();
    visit(source, (node) => {
      if (!ts.isCallExpression(node) || !isFactoryReference(node.expression)) return;
      const reducer = directExportedReducer(node);
      if (!reducer) {
        violations.push(
          `${filePath}:${lineFor(source, node)}: createReducer result must be a direct exported const`,
        );
        return;
      }
      reducers.set(reducer.name, reducer.declaration);
      reducerCount++;
    });
    visit(source, (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'with' &&
        ts.isIdentifier(node.expression.expression)
      ) {
        const reducerName = node.expression.expression.text;
        const declaration = reducers.get(reducerName);
        if (!declaration) return;
        if (!ts.isExpressionStatement(node.parent)) {
          violations.push(
            `${filePath}:${lineFor(source, node)}: ${reducerName}.with(...) must be a standalone expression statement`,
          );
        } else if (node.getStart(source) < declaration.end) {
          violations.push(
            `${filePath}:${lineFor(source, node)}: ${reducerName}.with(...) must appear after the reducer export`,
          );
        } else {
          registrationCount++;
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        ts.isIdentifier(node.left) &&
        reducers.has(node.left.text)
      ) {
        violations.push(
          `${filePath}:${lineFor(source, node)}: exported reducer ${node.left.text} must not be reassigned`,
        );
      }
    });
  }
  return { violations, reducerCount, registrationCount };
}
