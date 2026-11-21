import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  findObjectLiterals,
  lineOf,
  namedImports,
  ownProperty,
  parseErrors,
  parseSource,
  propertyValue,
  stringValue,
  ts,
  unwrapExpression,
  walk,
} from './source-ast-lib.mjs';

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

const sliceModuleOf = (action) =>
  `${action
    .slice(0, action.indexOf('/'))
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-slice`;
const moduleName = (specifier) =>
  specifier.slice(specifier.lastIndexOf('/') + 1).replace(/\.[cm]?[jt]s$/, '');

// `{ value, line }` for every `name:` property under `root` whose value is not a string
// literal: the scan reads literals only, so such a property would hide an entry.
function unreadableProperties(root, name) {
  return findObjectLiterals(root, name).flatMap((object) => {
    const value = propertyValue(object, name);
    if (value && stringValue(value) !== null) return [];
    return [{ value: value?.getText() ?? name, line: lineOf(ownProperty(object, name)) }];
  });
}

// Every `category: 'labs'` schema entry: `{ path, applyKind, action, actionCreator,
// sliceModule, line }`. `path` is null when the entry has no literal `path`.
export function findLabsSettings(schemaText) {
  const source = parseSource(schemaText, SCHEMA_SOURCE);
  return findObjectLiterals(source, 'category')
    .filter((entry) => stringValue(propertyValue(entry, 'category')) === 'labs')
    .map((entry) => {
      const apply = unwrapExpression(propertyValue(entry, 'apply'));
      const plan = apply && ts.isObjectLiteralExpression(apply) ? apply : null;
      const action = plan ? stringValue(propertyValue(plan, 'action')) : null;
      return {
        path: stringValue(propertyValue(entry, 'path')),
        applyKind: plan ? stringValue(propertyValue(plan, 'kind')) : null,
        action,
        actionCreator: action ? action.slice(action.lastIndexOf('/') + 1) : null,
        sliceModule: action?.includes('/') ? sliceModuleOf(action) : null,
        line: lineOf(ownProperty(entry, 'path') ?? entry),
      };
    });
}

// Page `kind:` values that are not string literals (`kind: SWITCH_KIND`): the switch
// scan reads literals only, so these would hide a switch. `{ value, line }`.
export const findUnreadableKinds = (pageText) =>
  unreadableProperties(parseSource(pageText, LABS_PAGE_SOURCE), 'kind');

// The action creators a switch dispatches: `dispatch(creator(…))` / `x.dispatch(creator(…))`.
function dispatchedCreators(entry) {
  const creators = [];
  walk(entry, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression;
    const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
    const [argument] = node.arguments;
    if (
      ts.isIdentifier(name) &&
      name.text === 'dispatch' &&
      argument &&
      ts.isCallExpression(argument) &&
      ts.isIdentifier(argument.expression)
    ) {
      creators.push(argument.expression.text);
    }
  });
  return creators;
}

// A switch without `when` is shown; with one, only `when: () => <gate>` for a gate in
// SHOWN_SWITCH_GATES.
function isShown(entry) {
  if (!ownProperty(entry, 'when')) return true;
  const when = unwrapExpression(propertyValue(entry, 'when'));
  if (!when || !ts.isArrowFunction(when) || when.parameters.length) return false;
  const gate = unwrapExpression(when.body);
  return ts.isIdentifier(gate) && SHOWN_SWITCH_GATES.includes(gate.text);
}

// Every `kind: 'switch'` entry in the Labs page's script blocks:
// `{ id, shown, actions: [{ creator, specifier }], line }` (`specifier` is null when the
// creator is not a named import).
export function findLabsSwitches(pageText) {
  const source = parseSource(pageText, LABS_PAGE_SOURCE);
  const imports = namedImports(source);
  return findObjectLiterals(source, 'kind')
    .filter((entry) => stringValue(propertyValue(entry, 'kind')) === 'switch')
    .map((entry) => ({
      id: stringValue(propertyValue(entry, 'id')),
      shown: isShown(entry),
      actions: dispatchedCreators(entry).map((creator) => ({
        creator,
        specifier: imports.get(creator) ?? null,
      })),
      line: lineOf(entry),
    }));
}

// Problems that keep the check from reading a source: syntax errors and, in the schema,
// a non-literal `category`.
function unreadableSources({ schema, page }) {
  const schemaSource = parseSource(schema, SCHEMA_SOURCE);
  const pageSource = parseSource(page, LABS_PAGE_SOURCE);
  return [
    ...parseErrors(schemaSource).map(
      ({ line, message }) => `${SCHEMA_SOURCE}:${line} cannot parse: ${message}`,
    ),
    ...parseErrors(pageSource).map(
      ({ line, message }) => `${LABS_PAGE_SOURCE}:${line} cannot parse: ${message}`,
    ),
    ...unreadableProperties(schemaSource, 'category').map(
      ({ value, line }) =>
        `${SCHEMA_SOURCE}:${line} cannot read the category \`${value}\`; write it as a string literal`,
    ),
  ];
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
  const problems = unreadableSources({ schema, page });
  if (problems.length) return problems;
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
        `${at} cannot read the labs entry (no string literal \`path\`); ` +
          'write the path as a string literal',
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
