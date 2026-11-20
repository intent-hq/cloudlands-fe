import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Every app settings schema entry in the `labs` category needs a switch in
// Settings → Labs. A Labs flag without one can only be changed by asking the assistant
// for a settings proposal, so a user who never turned it on cannot reach the feature
// or find out why: the "E2B cloud machines" flag hid Add cloud in Settings → Machines
// (cloudlands-fe#4811, #4826). A switch matches an entry when its `set` dispatches the
// action creator named by the entry's `redux-action` apply plan, imported from that
// action's slice module (`userPreferences/setX` → `setX` from `…/user-preferences-slice`).
// A switch with a `when` gate counts only when the gate is one of SHOWN_SWITCH_GATES.
// The reverse holds too: every Labs switch needs a labs schema entry, so the assistant
// can read and propose the setting it changes.
export const SCRIPT_PATH = 'scripts/check-labs-settings-toggles.mjs';
export const SCHEMA_SOURCE = 'src/shared/app-settings-schema.ts';
export const LABS_PAGE_SOURCE = 'src/lib/components/settings/LabsSettings.svelte';

// Labs schema entries that deliberately have no switch: schema path → one-line reason.
// Stale entries (no such labs entry, or one that now has a switch) fail the check.
export const HIDDEN_LABS_SETTINGS = Object.freeze({});

// `when: () => <gate>` values that still show the switch to the users the setting is
// for (the setting's description names the platform limit, e.g. "Desktop app only").
export const SHOWN_SWITCH_GATES = Object.freeze(['desktop']);

// Labs switches that deliberately have no labs schema entry: switch `id` → one-line
// reason. Stale entries (no such switch, or one that now has an entry) fail the check.
export const UNLISTED_LABS_SWITCHES = Object.freeze({
  'labs-browser-pages-in-main':
    'saved by the Electron main process and applied after a restart, so settings proposals cannot read or change it (cloudlands-fe#4828)',
});

const LABS_CATEGORY_PATTERN = /category:\s*(['"`])labs\1/g;
const SWITCH_KIND_PATTERN = /kind:\s*(['"`])switch\1/g;
const PATH_PATTERN = /\bpath:\s*(['"`])([^'"`]+)\1/;
const APPLY_PATTERN = /\bapply:/;
const APPLY_KIND_PATTERN = /\bkind:\s*(['"`])([^'"`]+)\1/;
const ACTION_PATTERN = /\baction:\s*(['"`])([^'"`]+)\1/;
const DISPATCH_PATTERN = /dispatch\(\s*([A-Za-z_$][\w$]*)\s*\(/g;
const SCRIPT_BLOCK_PATTERN = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
const WHEN_PATTERN = /\bwhen:/;
const SHOWN_WHEN_PATTERN = /\bwhen:\s*\(\)\s*=>\s*([\w$]+)\s*(?:,|$)/m;
const IMPORT_PATTERN = /\bimport\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g;

const sliceModuleOf = (action) =>
  `${action
    .slice(0, action.indexOf('/'))
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-slice`;
const moduleName = (specifier) =>
  specifier.slice(specifier.lastIndexOf('/') + 1).replace(/\.[cm]?[jt]s$/, '');

// Local name → module specifier for every named import in a script block.
function namedImports(script) {
  const imports = new Map();
  for (const [, names, , specifier] of script.matchAll(IMPORT_PATTERN)) {
    for (const name of names.split(',')) {
      const local = name
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .pop();
      if (local) imports.set(local, specifier);
    }
  }
  return imports;
}

const lineOf = (content, index) => content.slice(0, index).split('\n').length;

// Every `{ … }` span in TypeScript source, skipping strings, template text and comments.
function objectSpans(text) {
  const spans = [];
  const open = [];
  let i = 0;
  const skipTemplateExpression = () => {
    let depth = 1;
    i += 2;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
      i += 1;
    }
  };
  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end;
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (char === "'" || char === '"' || char === '`') {
      i += 1;
      while (i < text.length && text[i] !== char) {
        if (text[i] === '\\') i += 2;
        else if (char === '`' && text[i] === '$' && text[i + 1] === '{') skipTemplateExpression();
        else i += 1;
      }
      i += 1;
    } else {
      if (char === '{') open.push(i);
      else if (char === '}' && open.length) spans.push({ start: open.pop(), end: i });
      i += 1;
    }
  }
  return spans;
}

const innermostSpan = (spans, index) =>
  spans
    .filter((span) => span.start < index && index < span.end)
    .reduce((best, span) => (!best || span.start > best.start ? span : best), null);

// The object's own text with nested objects blanked out (same length, so indexes hold).
function ownProperties(text, spans, object) {
  let own = text.slice(object.start, object.end + 1);
  for (const span of spans) {
    if (span.start > object.start && span.end < object.end) {
      const from = span.start - object.start;
      const to = span.end - object.start + 1;
      own = own.slice(0, from) + ' '.repeat(to - from) + own.slice(to);
    }
  }
  return own;
}

// Every `category: 'labs'` schema entry: `{ path, applyKind, action, actionCreator, line }`.
// A match outside any object (the scanner lost track of the source) has a null `path`.
export function findLabsSettings(schemaText) {
  const spans = objectSpans(schemaText);
  const settings = [];
  for (const match of schemaText.matchAll(LABS_CATEGORY_PATTERN)) {
    const entry = innermostSpan(spans, match.index);
    if (!entry) {
      settings.push({
        path: null,
        applyKind: null,
        action: null,
        actionCreator: null,
        sliceModule: null,
        line: lineOf(schemaText, match.index),
      });
      continue;
    }
    const own = ownProperties(schemaText, spans, entry);
    const pathMatch = PATH_PATTERN.exec(own);
    const applyMatch = APPLY_PATTERN.exec(own);
    const applyAt = applyMatch ? entry.start + applyMatch.index + applyMatch[0].length : -1;
    const applyGap = applyMatch ? /^\s*(?=\{)/.exec(schemaText.slice(applyAt)) : null;
    const applyStart = applyGap ? applyAt + applyGap[0].length : -1;
    const apply = spans.find((span) => span.start === applyStart) ?? null;
    const applyText = apply ? schemaText.slice(apply.start, apply.end + 1) : '';
    const action = ACTION_PATTERN.exec(applyText)?.[2] ?? null;
    settings.push({
      path: pathMatch?.[2] ?? null,
      applyKind: APPLY_KIND_PATTERN.exec(applyText)?.[2] ?? null,
      action,
      actionCreator: action ? action.slice(action.lastIndexOf('/') + 1) : null,
      sliceModule: action?.includes('/') ? sliceModuleOf(action) : null,
      line: lineOf(schemaText, entry.start + (pathMatch?.index ?? 0)),
    });
  }
  return settings;
}

const ID_PATTERN = /\bid:\s*(['"`])([^'"`]+)\1/;
const ANY_KIND_PATTERN = /\bkind:\s*([^,}\s]+)/g;
const LITERAL_PATTERN = /^(['"`])[^'"`]*\1$/;

// Page `kind:` values that are not string literals (`kind: SWITCH_KIND`): the switch
// scan reads literals only, so these would hide a switch. `{ value, line }`.
export function findUnreadableKinds(pageText) {
  const unreadable = [];
  for (const [, script, offset] of scriptBlocks(pageText)) {
    for (const match of script.matchAll(ANY_KIND_PATTERN)) {
      if (!LITERAL_PATTERN.test(match[1])) {
        unreadable.push({ value: match[1], line: lineOf(pageText, offset + match.index) });
      }
    }
  }
  return unreadable;
}

// `[block, script, offset of the script text in the page]` for every script block.
const scriptBlocks = (pageText) =>
  [...pageText.matchAll(SCRIPT_BLOCK_PATTERN)].map((block) => [
    block[0],
    block[1],
    block.index + block[0].indexOf('>') + 1,
  ]);

const isShown = (own) => {
  if (!WHEN_PATTERN.test(own)) return true;
  const gate = SHOWN_WHEN_PATTERN.exec(own)?.[1];
  return gate !== undefined && SHOWN_SWITCH_GATES.includes(gate);
};

// Every `kind: 'switch'` entry in the Labs page's script blocks:
// `{ id, shown, actions: [{ creator, specifier }], line }` (`specifier` is null when the
// creator is not a named import).
export function findLabsSwitches(pageText) {
  const blocks = scriptBlocks(pageText).map(([, script, offset]) => ({ script, offset }));
  const imports = new Map(blocks.flatMap(({ script }) => [...namedImports(script)]));
  const switches = [];
  for (const { script, offset } of blocks) {
    const spans = objectSpans(script);
    for (const match of script.matchAll(SWITCH_KIND_PATTERN)) {
      const entry = innermostSpan(spans, match.index);
      if (!entry) continue;
      const own = ownProperties(script, spans, entry);
      const actions = [...script.slice(entry.start, entry.end + 1).matchAll(DISPATCH_PATTERN)].map(
        ([, creator]) => ({ creator, specifier: imports.get(creator) ?? null }),
      );
      switches.push({
        id: ID_PATTERN.exec(own)?.[2] ?? null,
        shown: isShown(own),
        actions,
        line: lineOf(pageText, offset + entry.start),
      });
    }
  }
  return switches;
}

const dispatchesSetting = (labsSwitch, setting) =>
  labsSwitch.actions.some(
    ({ creator, specifier }) =>
      creator === setting.actionCreator &&
      specifier !== null &&
      moduleName(specifier) === setting.sliceModule,
  );

// Problems with the Labs schema entries and their switches, one message per violation.
export function checkLabsSettingsToggles(
  { schema, page },
  { hidden = HIDDEN_LABS_SETTINGS, unlisted = UNLISTED_LABS_SWITCHES } = {},
) {
  const problems = [];
  const settings = findLabsSettings(schema);
  const switches = findLabsSwitches(page);
  const shownSwitches = switches.filter((labsSwitch) => labsSwitch.shown);
  if (switches.length === 0) {
    problems.push(
      `found no switch entries in ${LABS_PAGE_SOURCE}; update the parser in ${SCRIPT_PATH}`,
    );
  }
  const labsPaths = new Set();
  const withSwitch = new Set();
  for (const setting of settings) {
    const at = `${SCHEMA_SOURCE}:${setting.line}`;
    if (!setting.path) {
      problems.push(
        `${at} cannot read the labs entry (no enclosing object or \`path\`); ` +
          `update the parser in ${SCRIPT_PATH}`,
      );
      continue;
    }
    labsPaths.add(setting.path);
    if (setting.applyKind !== 'redux-action' || !setting.actionCreator) {
      if (!Object.hasOwn(hidden, setting.path)) {
        problems.push(
          `${at} ${setting.path} applies via ${setting.applyKind ?? 'an unreadable plan'}; ` +
            'use a redux-action apply plan that a Labs switch dispatches',
        );
      }
      continue;
    }
    if (shownSwitches.some((labsSwitch) => dispatchesSetting(labsSwitch, setting))) {
      withSwitch.add(setting.path);
    } else if (!Object.hasOwn(hidden, setting.path)) {
      problems.push(
        `${at} ${setting.path} has no switch in Settings → Labs ` +
          `(expected a shown switch in ${LABS_PAGE_SOURCE} whose set dispatches ` +
          `${setting.actionCreator} imported from a ${setting.sliceModule} module)`,
      );
    }
  }
  for (const [settingPath, reason] of Object.entries(hidden)) {
    const entry = `HIDDEN_LABS_SETTINGS['${settingPath}']`;
    if (!labsPaths.has(settingPath)) {
      problems.push(`${entry} is stale: ${settingPath} is not a labs schema entry`);
    } else if (withSwitch.has(settingPath)) {
      problems.push(`${entry} is stale: ${settingPath} has a switch in Settings → Labs`);
    } else if (typeof reason !== 'string' || !reason.trim()) {
      problems.push(`${entry} needs a reason why the setting stays hidden`);
    }
  }
  for (const { value, line } of findUnreadableKinds(page)) {
    problems.push(
      `${LABS_PAGE_SOURCE}:${line} cannot read the kind \`${value}\`; write the entry kind as a string literal`,
    );
  }
  const listedSwitches = new Set();
  const matchable = settings.filter((setting) => setting.path && setting.actionCreator);
  for (const labsSwitch of switches) {
    const name = labsSwitch.id ?? 'without an id';
    if (matchable.some((setting) => dispatchesSetting(labsSwitch, setting))) {
      listedSwitches.add(labsSwitch.id);
    } else if (!labsSwitch.id || !Object.hasOwn(unlisted, labsSwitch.id)) {
      problems.push(
        `${LABS_PAGE_SOURCE}:${labsSwitch.line} switch ${name} has no labs schema entry ` +
          `(expected a \`category: 'labs'\` entry in ${SCHEMA_SOURCE} whose redux-action it dispatches)`,
      );
    }
  }
  const switchIds = new Set(switches.map((labsSwitch) => labsSwitch.id));
  for (const [id, reason] of Object.entries(unlisted)) {
    const entry = `UNLISTED_LABS_SWITCHES['${id}']`;
    if (!switchIds.has(id)) {
      problems.push(`${entry} is stale: there is no such switch in ${LABS_PAGE_SOURCE}`);
    } else if (listedSwitches.has(id)) {
      problems.push(`${entry} is stale: ${id} has a labs schema entry`);
    } else if (typeof reason !== 'string' || !reason.trim()) {
      problems.push(`${entry} needs a reason why the switch has no schema entry`);
    }
  }
  return problems;
}

export function readSources(root) {
  return {
    schema: fs.readFileSync(path.join(root, SCHEMA_SOURCE), 'utf8'),
    page: fs.readFileSync(path.join(root, LABS_PAGE_SOURCE), 'utf8'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkLabsSettingsToggles(readSources(process.cwd()));
  if (problems.length) {
    console.error(
      [
        'Labs settings toggle check failed:',
        ...problems.map((problem) => `  ${problem}`),
        '',
        `Every \`category: 'labs'\` entry in ${SCHEMA_SOURCE} needs a switch in`,
        `${LABS_PAGE_SOURCE}; without one, users cannot turn the feature on or find out`,
        'why it is missing (cloudlands-fe#4811). Every Labs switch also needs a labs schema',
        'entry, so the assistant can read and propose it. Add the switch or entry, or add a',
        `HIDDEN_LABS_SETTINGS / UNLISTED_LABS_SWITCHES entry with a one-line reason in ${SCRIPT_PATH}.`,
      ].join('\n'),
    );
    process.exit(1);
  }
  console.log('Labs settings toggle check passed: every labs setting has a Labs switch.');
}
