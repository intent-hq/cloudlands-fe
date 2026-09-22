import { pathToFileURL } from 'node:url';
import { internalModuleImportPatterns } from '../eslint-rules/internal-module-import-patterns.js';

// `no-restricted-imports` compares import-source strings and never resolves
// modules, so a ban on an internal module (`$alias/...`, relative, `src/...`)
// holds only for the spelling it names: cloudlands-fe#2763 first banned
// `$features/agent/agent.client` through `paths` + `importNames`, and the
// relative, `.ts` and `import * as` forms all went through. Every internal-module
// ban in eslint.config.js is a `patterns` group built by
// eslint-rules/internal-module-import-patterns.js; this scanner loads the
// effective flat config and fails when an override regresses to a `paths`
// entry, a bare-string pattern, a partial group, a negated entry, or an
// `importNames` list. Package bans (`electron`, `child_process`,
// `@playwright/...`), SvelteKit virtual modules (`$app/*`, `$env/*`) and
// `regex` entries are out of scope.
export const HELPER_PATH = 'eslint-rules/internal-module-import-patterns.js';
export const RULE_IDS = ['no-restricted-imports', '@typescript-eslint/no-restricted-imports'];

const INTERNAL_SOURCE_PATTERN = /^(?:\.\.?\/|\/|src\/|\*\*\/)/;
const ALIAS_ROOT_PATTERN = /^(\$[^/]+)/;
const ALIAS_ENTRY_PATTERN = /^(\$[^/]+)(?:\/(.+))?$/;
const GLOB_ENTRY_PATTERN = /^\*\*\/(.+)$/;
const ALIAS_TARGET_PATTERN = /^\.\/src\/(.+?)\/?$/;
const MODULE_EXTENSION_PATTERN = /\.(?:ts|js)$/;

// A `$` root is internal only when kit.alias maps it (`$lib`, `$features`, …);
// `$app/*`, `$env/*` and `$service-worker` are SvelteKit virtual modules and
// count as packages.
export const isInternalSource = (source, aliases) => {
  if (typeof source !== 'string') return false;
  const root = ALIAS_ROOT_PATTERN.exec(source);
  return root ? aliases.has(root[1]) : INTERNAL_SOURCE_PATTERN.test(source);
};

// The `$alias` → `src/`-relative directory map from a svelte.config.js
// `kit.alias` object: `{ $lib: './src/lib' }` → `Map { '$lib' => 'lib' }`.
// Package-name aliases (`@fortawesome/...` → one file) are not import roots.
export function aliasDirectories(alias) {
  const map = new Map();
  for (const [name, target] of Object.entries(alias ?? {})) {
    const match = typeof target === 'string' ? ALIAS_TARGET_PATTERN.exec(target) : null;
    if (name.startsWith('$') && match) map.set(name, match[1]);
  }
  return map;
}

const stripExtension = (value) => value.replace(MODULE_EXTENSION_PATTERN, '');

// The `{ alias, modulePath }` a group entry names, or `null` when the entry is a
// spelling the helper never emits (relative, `/`, `src/`, an unknown alias, or a
// `**/<dir>` path outside every alias directory).
function moduleOf(entry, aliases) {
  const aliasMatch = ALIAS_ENTRY_PATTERN.exec(entry);
  if (aliasMatch) {
    const [, alias, tail] = aliasMatch;
    const directory = aliases.get(alias);
    return directory && tail ? { alias, modulePath: `${directory}/${stripExtension(tail)}` } : null;
  }
  const globMatch = GLOB_ENTRY_PATTERN.exec(entry);
  if (!globMatch) return null;
  const modulePath = stripExtension(globMatch[1]);
  let best = null;
  for (const [alias, directory] of aliases) {
    if (modulePath.startsWith(`${directory}/`) && (!best || directory.length > best[1].length)) {
      best = [alias, directory];
    }
  }
  return best ? { alias: best[0], modulePath } : null;
}

const describeEntry = (entry) => JSON.stringify(entry);

const isNegated = (entry) => typeof entry === 'string' && entry.startsWith('!');

// Violations for one `patterns` object: the group must be exactly the union of
// `internalModuleImportPatterns(alias, modulePath)` over the modules it names,
// must ban the whole module (an `importNames` list still lets `import * as m`
// reach the same binding), and must carry no negated entry (a gitignore-style
// `!…` subtracts from every earlier entry, so `!**/*.ts` or the negated alias
// spelling reopens a complete group).
function checkGroup(pattern, aliases, report) {
  const group = Array.isArray(pattern.group) ? pattern.group : [];
  const internal = group.filter((entry) => isInternalSource(entry, aliases));
  if (!internal.length) return;
  const negated = group.filter(isNegated);
  if (negated.length) {
    report(
      `{ group: [${internal.map(describeEntry).join(', ')}] }`,
      `carries negated entries [${negated.join(', ')}] that subtract spellings from an internal-module ban; a complete internalModuleImportPatterns group takes no negations`,
    );
  }
  if (Array.isArray(pattern.importNames)) {
    report(
      `{ group: [${internal.map(describeEntry).join(', ')}] }`,
      `carries importNames [${pattern.importNames.join(', ')}] on an internal module; a namespace import reaches the same binding, so ban the whole module (allowImportNames is fine)`,
    );
  }
  const modules = new Map();
  for (const entry of internal) {
    const module = moduleOf(entry, aliases);
    if (!module) {
      report(
        describeEntry(entry),
        `is not a spelling internalModuleImportPatterns emits (it needs a \`$alias/<tail>\` or \`**/<aliasDir>/<tail>\` form under a svelte.config.js kit.alias directory)`,
      );
    } else {
      modules.set(`${module.alias}\u0000${module.modulePath}`, module);
    }
  }
  const expected = new Set(
    [...modules.values()].flatMap(({ alias, modulePath }) =>
      internalModuleImportPatterns(alias, modulePath),
    ),
  );
  const present = new Set(internal);
  const missing = [...expected].filter((entry) => !present.has(entry));
  if (missing.length) {
    const calls = [...modules.values()]
      .map(({ alias, modulePath }) => `internalModuleImportPatterns('${alias}', '${modulePath}')`)
      .join(' + ');
    report(
      `{ group: [${internal.map(describeEntry).join(', ')}] }`,
      `is missing ${missing.map(describeEntry).join(', ')}; build the group from ${calls}`,
    );
  }
}

// The `{ paths, patterns }` view of one rule configuration, whatever option
// shape ESLint accepts: `['error', 'a', 'b']`, `['error', { name }, ...]`, or
// `['error', { paths, patterns }]`.
function normalizeOptions(ruleConfig) {
  const options = Array.isArray(ruleConfig) ? ruleConfig.slice(1) : [];
  const paths = [];
  const patterns = [];
  for (const option of options) {
    if (typeof option === 'string') paths.push(option);
    else if (option && typeof option === 'object') {
      if ('paths' in option || 'patterns' in option) {
        paths.push(...(option.paths ?? []));
        patterns.push(...(option.patterns ?? []));
      } else if ('name' in option) paths.push(option);
    }
  }
  return { paths, patterns };
}

// `'off'` / `0`, bare or as the head of `[severity, ...options]`: ESLint ignores
// the retained options, so there is no ban to guard.
function isDisabled(ruleConfig) {
  const severity = Array.isArray(ruleConfig) ? ruleConfig[0] : ruleConfig;
  return severity === 'off' || severity === 0;
}

const describeBlock = (block, index) =>
  Array.isArray(block.files) ? `files [${block.files.flat().join(', ')}]` : `block #${index}`;

// Every bypassable internal-module ban in a flat config array:
// `{ block, rule, entry, reason }` per violation.
export function checkRestrictedImportSpellings(config, aliases) {
  const violations = [];
  config.forEach((block, index) => {
    for (const rule of RULE_IDS) {
      const ruleConfig = block?.rules?.[rule];
      if (ruleConfig === undefined || isDisabled(ruleConfig)) continue;
      const blockLabel = describeBlock(block, index);
      const report = (entry, reason) => violations.push({ block: blockLabel, rule, entry, reason });
      const { paths, patterns } = normalizeOptions(ruleConfig);
      for (const entry of paths) {
        const name = typeof entry === 'string' ? entry : entry?.name;
        if (isInternalSource(name, aliases)) {
          report(
            `paths entry ${describeEntry(name)}`,
            'bans one spelling of an internal module; use a patterns group built by internalModuleImportPatterns',
          );
        }
      }
      for (const pattern of patterns) {
        if (typeof pattern === 'string') {
          if (isInternalSource(pattern, aliases)) {
            report(
              `patterns entry ${describeEntry(pattern)}`,
              'is a bare string; use a { group } built by internalModuleImportPatterns',
            );
          }
        } else if (pattern && typeof pattern === 'object') checkGroup(pattern, aliases, report);
      }
    }
  });
  return violations;
}

export const formatViolation = ({ block, rule, entry, reason }) =>
  `${block} › ${rule}: ${entry} ${reason} (${HELPER_PATH})`;

// The effective inputs: the flat config array and the `kit.alias` map.
export async function loadInputs(root = process.cwd()) {
  const [{ default: config }, { default: svelteConfig }] = await Promise.all([
    import(pathToFileURL(`${root}/eslint.config.js`).href),
    import(pathToFileURL(`${root}/svelte.config.js`).href),
  ]);
  return { config, aliases: aliasDirectories(svelteConfig?.kit?.alias) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { config, aliases } = await loadInputs();
  const violations = checkRestrictedImportSpellings(config, aliases);
  if (violations.length) {
    console.error(
      [
        `Bypassable internal-module import ban${violations.length === 1 ? '' : 's'} in eslint.config.js:`,
        ...violations.map((violation) => `  ${formatViolation(violation)}`),
        '',
        `\`no-restricted-imports\` matches source strings, so an internal module must be banned by the exact covering set from ${HELPER_PATH} (cloudlands-fe#2763).`,
      ].join('\n'),
    );
    process.exit(1);
  }
  console.log(
    'restricted-import spellings check passed: every internal-module ban is a complete patterns group.',
  );
}
