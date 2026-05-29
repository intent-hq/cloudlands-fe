import fs from 'node:fs';
import path from 'node:path';

const MESSAGE = 'Svelte components must not fetch or load async domain data directly. Dispatch through the configured Store instance (store.dispatch(action)) and read the result through Redux selectors instead; keep API/client/provider calls in sagas or service layers, not components.';

const SAFE_AWAITED_IDENTIFIER_NAMES = new Set([
  'tick',
  'settled',
  'sleep',
  'delay',
]);

const DOMAIN_DATA_METHOD_NAMES = new Set([
  'fetch',
  'get',
  'invoke',
  'list',
  'load',
  'query',
  'read',
  'request',
  'search',
]);

const DOMAIN_IMPORT_SOURCE_PATTERN = /(?:^|[./-])(?:api|apis|client|clients|provider|providers|service|services|repository|repositories|sdk|ipc)(?:[./-]|$)/i;
const DOMAIN_API_IMPORT_SOURCE_PATTERN = /(?:^|[./-])(?:api|apis|client|clients|provider|providers|repository|repositories|sdk)(?:[./-]|$)/i;
const DOMAIN_API_OBJECT_NAME_PATTERN = /(?:api|client|provider|repository|repositories|sdk)$/i;
const DOMAIN_DATA_OBJECT_NAME_PATTERN = /(?:service|source|sources|system|electronAPI|ipc)$/i;
const DOMAIN_LOADER_NAME_PATTERN = /^(?:fetch|load|get|list|read|query|search|request|invoke)(?:[A-Z0-9_]|$)/;
const LOCAL_IMPORT_SOURCE_PATTERN = /^(?:\.{1,2}\/|\$lib\/|\$features\/|\$shared\/)/;
const STORE_IMPORT_SOURCE_PATTERN = /^\$lib\/store\//;
const WRAPPER_IMPORT_SOURCE_PATTERN = /(?:^|[./-])(?:commands?|electron|ipc)(?:[./-]|$)|choose-parent-folder|patch-block-commands|rtk-settings-commands/i;
const ASYNC_WRAPPER_SOURCE_TEXT_PATTERN = /(?:window\.)?electronAPI\??\.invoke|(?:^|[^\w$])invoke\s*\(|(?:^|[^\w$])fetch\s*\(|IPC_CHANNELS|(?:SETTINGS|SYSTEM|DIALOG|TERMINAL)_CHANNELS/;

function unwrapExpression(node) {
  let current = node;

  while (current) {
    switch (current.type) {
      case 'ChainExpression':
        current = current.expression;
        break;
      case 'TSAsExpression':
      case 'TSTypeAssertion':
      case 'TSNonNullExpression':
      case 'ParenthesizedExpression':
        current = current.expression;
        break;
      default:
        return current;
    }
  }

  return current;
}

function getStaticPropertyName(node) {
  const unwrapped = unwrapExpression(node);

  if (unwrapped?.type !== 'MemberExpression') {
    return null;
  }

  const property = unwrapExpression(unwrapped.property);
  if (!unwrapped.computed && property?.type === 'Identifier') {
    return property.name;
  }

  if (property?.type === 'Literal' && typeof property.value === 'string') {
    return property.value;
  }

  return null;
}

function getRootIdentifierName(node) {
  let current = unwrapExpression(node);

  while (current?.type === 'MemberExpression') {
    current = unwrapExpression(current.object);
  }

  return current?.type === 'Identifier' ? current.name : null;
}

function getObjectHintName(node) {
  const unwrapped = unwrapExpression(node);

  if (unwrapped?.type === 'Identifier') {
    return unwrapped.name;
  }

  return getStaticPropertyName(unwrapped);
}

function getFilename(context) {
  if (typeof context.getFilename === 'function') {
    return context.getFilename();
  }

  return context.filename;
}

function isLocalWrapperImportSource(source) {
  return typeof source === 'string'
    && LOCAL_IMPORT_SOURCE_PATTERN.test(source)
    && !STORE_IMPORT_SOURCE_PATTERN.test(source);
}

function resolveImportBase(filename, source) {
  if (!filename || filename.startsWith('<') || !isLocalWrapperImportSource(source)) {
    return null;
  }

  if (source.startsWith('.')) {
    return path.resolve(path.dirname(filename), source);
  }

  const aliases = {
    '$lib/': 'src/lib/',
    '$features/': 'src/features/',
    '$shared/': 'src/shared/',
  };

  for (const [alias, target] of Object.entries(aliases)) {
    if (source.startsWith(alias)) {
      return path.resolve(process.cwd(), target, source.slice(alias.length));
    }
  }

  return null;
}

function readImportSourceText(context, source) {
  const basePath = resolveImportBase(getFilename(context), source);
  if (!basePath) return null;

  const candidates = path.extname(basePath)
    ? [basePath]
    : ['.ts', '.js', '.svelte'].map((extension) => `${basePath}${extension}`);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate, 'utf8');
      }
    } catch {
      return null;
    }
  }

  return null;
}

function isModuleScriptElement(node) {
  return node.startTag?.attributes?.some(
    (attribute) => attribute.type === 'SvelteAttribute'
      && (
        attribute.key?.name === 'module'
        || (
          attribute.key?.name === 'context'
          && attribute.value?.some((value) => value.type === 'SvelteLiteral' && value.value === 'module')
        )
      ),
  ) ?? false;
}

function isInSvelteComponentInstance(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'SvelteScriptElement') {
      return !isModuleScriptElement(current);
    }

    if (current.type === 'Program') {
      return true;
    }
  }

  return true;
}

function getAwaitedCall(node) {
  const unwrapped = unwrapExpression(node);

  if (unwrapped?.type === 'CallExpression') {
    return unwrapped;
  }

  if (unwrapped?.type === 'MemberExpression' && unwrapped.object?.type === 'CallExpression') {
    return unwrapped.object;
  }

  return null;
}

function isGlobalFetchCall(node) {
  const callee = unwrapExpression(node.callee);

  if (callee?.type === 'Identifier') {
    return callee.name === 'fetch';
  }

  if (callee?.type !== 'MemberExpression' || getStaticPropertyName(callee) !== 'fetch') {
    return false;
  }

  const rootName = getRootIdentifierName(callee.object);
  return rootName === 'window' || rootName === 'globalThis' || rootName === 'self';
}

function isDomainMemberCall(callee, domainImportNames, domainApiImportNames) {
  if (callee.type !== 'MemberExpression') {
    return false;
  }

  const methodName = getStaticPropertyName(callee);
  const objectName = getObjectHintName(callee.object);
  const rootName = getRootIdentifierName(callee.object);

  if (
    domainApiImportNames.has(rootName)
    || DOMAIN_API_OBJECT_NAME_PATTERN.test(objectName ?? '')
    || DOMAIN_API_OBJECT_NAME_PATTERN.test(rootName ?? '')
  ) {
    return true;
  }

  if (!DOMAIN_DATA_METHOD_NAMES.has(methodName)) {
    return false;
  }

  return domainImportNames.has(rootName)
    || DOMAIN_DATA_OBJECT_NAME_PATTERN.test(objectName ?? '')
    || DOMAIN_DATA_OBJECT_NAME_PATTERN.test(rootName ?? '')
    || methodName === 'invoke';
}

function isDomainDataCall(node, domainImportNames, domainApiImportNames) {
  const callee = unwrapExpression(node.callee);

  if (callee?.type === 'Identifier') {
    return domainImportNames.has(callee.name);
  }

  if (callee?.type === 'MemberExpression') {
    return isDomainMemberCall(callee, domainImportNames, domainApiImportNames);
  }

  return false;
}

function isAwaitedStandaloneLoaderCall(node, domainImportNames) {
  const callee = unwrapExpression(node.callee);

  if (callee?.type !== 'Identifier') {
    return false;
  }

  if (SAFE_AWAITED_IDENTIFIER_NAMES.has(callee.name) || domainImportNames.has(callee.name)) {
    return false;
  }

  return DOMAIN_LOADER_NAME_PATTERN.test(callee.name);
}

function isDomainImportSource(source) {
  return typeof source === 'string' && DOMAIN_IMPORT_SOURCE_PATTERN.test(source);
}

function isImportedAsyncWrapperCall(callee, asyncWrapperImportNames) {
  const unwrapped = unwrapExpression(callee);

  if (unwrapped?.type === 'Identifier') {
    return asyncWrapperImportNames.has(unwrapped.name);
  }

  if (unwrapped?.type === 'MemberExpression') {
    return asyncWrapperImportNames.has(getRootIdentifierName(unwrapped));
  }

  return false;
}

function isAsyncWrapperImportSource(context, source) {
  if (!isLocalWrapperImportSource(source)) {
    return false;
  }

  if (WRAPPER_IMPORT_SOURCE_PATTERN.test(source)) {
    return true;
  }

  const sourceText = readImportSourceText(context, source);
  return Boolean(sourceText && ASYNC_WRAPPER_SOURCE_TEXT_PATTERN.test(sourceText));
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow direct async domain data fetching in Svelte components',
    },
    schema: [],
    messages: {
      noComponentAsyncDataFetch: MESSAGE,
    },
  },

  create(context) {
    const domainImportNames = new Set();
    const domainApiImportNames = new Set();
    const asyncWrapperImportNames = new Set();

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        const isDomainSource = isDomainImportSource(source);
        const isAsyncWrapperSource = isAsyncWrapperImportSource(context, source);

        if (!isDomainSource && !isAsyncWrapperSource) return;

        for (const specifier of node.specifiers) {
          if (specifier.importKind === 'type') {
            continue;
          }

          if (isDomainSource) {
            domainImportNames.add(specifier.local.name);
          }

          if (isAsyncWrapperSource) {
            asyncWrapperImportNames.add(specifier.local.name);
          }

          if (DOMAIN_API_IMPORT_SOURCE_PATTERN.test(source)) {
            domainApiImportNames.add(specifier.local.name);
          }
        }
      },

      CallExpression(node) {
        if (!isInSvelteComponentInstance(node)) {
          return;
        }

        if (
          isGlobalFetchCall(node)
          || isImportedAsyncWrapperCall(node.callee, asyncWrapperImportNames)
          || isDomainDataCall(node, domainImportNames, domainApiImportNames)
        ) {
          context.report({ node, messageId: 'noComponentAsyncDataFetch' });
        }
      },

      AwaitExpression(node) {
        if (!isInSvelteComponentInstance(node)) {
          return;
        }

        const call = getAwaitedCall(node.argument);
        if (!call || isGlobalFetchCall(call)) {
          return;
        }

        if (isAwaitedStandaloneLoaderCall(call, domainImportNames)) {
          context.report({ node: call, messageId: 'noComponentAsyncDataFetch' });
        }
      },
    };
  },
};