import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  findObjectLiterals,
  lineOf,
  ownProperty,
  parseErrors,
  parseSource,
  propertyValue,
  stringValue,
  ts,
  unwrapExpression,
} from './source-ast-lib.mjs';

// The application menu shows the chords the renderer owns (tab navigation, pane
// creation) without registering them as native accelerators: a registered chord
// fires in the main process before the renderer can route it to the focused editor
// or terminal. Mod+Shift+W and the PageUp/PageDown pair stay free for the renderer
// too, so Close Window carries no accelerator and no item claims those chords.
export const SCRIPT_PATH = 'scripts/check-menu-accelerators.mjs';
export const MENU_SOURCE = 'src/main/index.ts';

// Menu items shown with a chord the renderer owns: message key → accelerator.
export const RENDERER_OWNED_ACCELERATORS = Object.freeze({
  menu_new_agent: 'CmdOrCtrl+Alt+A',
  menu_new_note: 'CmdOrCtrl+Alt+N',
  menu_new_terminal: 'CmdOrCtrl+Alt+T',
  menu_new_browser: 'CmdOrCtrl+Alt+B',
  menu_select_previous_tab: 'CmdOrCtrl+[',
  menu_select_next_tab: 'CmdOrCtrl+]',
});

// Menu items that must not carry any accelerator.
export const UNACCELERATED_ITEMS = Object.freeze(['menu_close_window']);

// Chords no menu item may claim, so the renderer keeps them.
export const FORBIDDEN_ACCELERATORS = Object.freeze([
  'CmdOrCtrl+Shift+W',
  'CmdOrCtrl+PageUp',
  'CmdOrCtrl+PageDown',
]);

// The message key of a `label: m.<key>(…)` item, or null.
function labelKey(item) {
  const label = unwrapExpression(propertyValue(item, 'label'));
  if (!label || !ts.isCallExpression(label)) return null;
  const callee = label.expression;
  return ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'm'
    ? callee.name.text
    : null;
}

// The chord expressions an accelerator value can take: both branches of a conditional.
function acceleratorLeaves(value) {
  const expression = unwrapExpression(value);
  if (ts.isConditionalExpression(expression)) {
    return [...acceleratorLeaves(expression.whenTrue), ...acceleratorLeaves(expression.whenFalse)];
  }
  return [expression];
}

// Every `accelerator:` property with its item and value: `{ item, property, value }`.
const acceleratorProperties = (source) =>
  findObjectLiterals(source, 'accelerator').map((item) => ({
    item,
    property: ownProperty(item, 'accelerator'),
    value: propertyValue(item, 'accelerator'),
  }));

// Every `label: m.<key>()` menu item: `{ key, accelerator, readable, registersAccelerator,
// line }`. `accelerator` is the chord, the source text of a non-literal value, or null;
// `readable` is false for a non-literal value.
export function findMenuItems(content) {
  const source = parseSource(content, MENU_SOURCE);
  return findObjectLiterals(source, 'label').flatMap((item) => {
    const key = labelKey(item);
    if (!key) return [];
    const value = propertyValue(item, 'accelerator');
    const chord = stringValue(value);
    const registers = unwrapExpression(propertyValue(item, 'registerAccelerator'));
    return [
      {
        key,
        accelerator: chord ?? value?.getText() ?? null,
        readable: !value || chord !== null,
        registersAccelerator: registers?.kind !== ts.SyntaxKind.FalseKeyword,
        line: lineOf(ownProperty(item, 'label')),
      },
    ];
  });
}

// Every literal chord an `accelerator:` declares, whatever item declares it (a role-only
// item has no `label: m.<key>()`, so `key` is null): `{ key, accelerator, line }`.
export function findAccelerators(content) {
  return acceleratorProperties(parseSource(content, MENU_SOURCE)).flatMap(
    ({ item, property, value }) =>
      (value ? acceleratorLeaves(value) : [])
        .filter((leaf) => stringValue(leaf) !== null)
        .map((leaf) => ({
          key: labelKey(item),
          accelerator: stringValue(leaf),
          line: lineOf(property),
        })),
  );
}

// Accelerators the check cannot read: a chord that is not a string literal (or a
// conditional of them) could claim a renderer-owned chord unseen. `{ key, value, line }`.
export function findUnreadableAccelerators(content) {
  return acceleratorProperties(parseSource(content, MENU_SOURCE)).flatMap(
    ({ item, property, value }) => {
      const unreadable = value
        ? acceleratorLeaves(value).some((leaf) => stringValue(leaf) === null)
        : true;
      return unreadable
        ? [
            {
              key: labelKey(item),
              value: value?.getText() ?? 'accelerator',
              line: lineOf(property),
            },
          ]
        : [];
    },
  );
}

// Problems with the menu source, one message per violated rule.
export function checkMenuAccelerators(content) {
  const errors = parseErrors(parseSource(content, MENU_SOURCE));
  if (errors.length) {
    return errors.map(({ line, message }) => `${MENU_SOURCE}:${line} cannot parse: ${message}`);
  }
  const items = findMenuItems(content);
  const problems = [];
  const at = (item) => `${MENU_SOURCE}:${item.line} (${item.key ?? 'unlabelled item'})`;
  for (const [key, accelerator] of Object.entries(RENDERER_OWNED_ACCELERATORS)) {
    const item = items.find((candidate) => candidate.key === key);
    if (!item) {
      problems.push(`missing menu item \`${key}\` (expected accelerator ${accelerator})`);
      continue;
    }
    if (item.readable && item.accelerator !== accelerator) {
      problems.push(`${at(item)} shows ${item.accelerator ?? 'no chord'}, expected ${accelerator}`);
    }
    if (item.registersAccelerator) {
      problems.push(`${at(item)} must set \`registerAccelerator: false\``);
    }
  }
  for (const key of UNACCELERATED_ITEMS) {
    const matching = items.filter((candidate) => candidate.key === key);
    if (matching.length === 0) {
      problems.push(`missing menu item \`${key}\` (expected without an accelerator)`);
      continue;
    }
    for (const item of matching) {
      if (item.accelerator !== null) {
        problems.push(`${at(item)} must not carry an accelerator (has ${item.accelerator})`);
      }
    }
  }
  for (const declared of findAccelerators(content)) {
    if (FORBIDDEN_ACCELERATORS.includes(declared.accelerator)) {
      problems.push(`${at(declared)} claims ${declared.accelerator}, which the renderer owns`);
    }
  }
  for (const unreadable of findUnreadableAccelerators(content)) {
    problems.push(
      `${at(unreadable)} cannot read the accelerator \`${unreadable.value}\`; ` +
        'write each chord as a string literal',
    );
  }
  return problems;
}

export function readMenuSource(root) {
  return fs.readFileSync(path.join(root, MENU_SOURCE), 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkMenuAccelerators(readMenuSource(process.cwd()));
  if (problems.length) {
    console.error(
      [
        `Renderer-owned menu accelerator check failed in ${MENU_SOURCE}:`,
        ...problems.map((problem) => `  ${problem}`),
        '',
        'Chords the renderer routes (tab navigation, pane creation) are shown in the menu',
        'with `registerAccelerator: false`; Close Window and the PageUp/PageDown chords stay',
        `unregistered. The rules live in ${SCRIPT_PATH}.`,
      ].join('\n'),
    );
    process.exit(1);
  }
  console.log('menu accelerator check passed: renderer-owned chords are shown, not registered.');
}
