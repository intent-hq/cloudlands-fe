import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

const LABEL_PATTERN = /label:\s*m\.(\w+)\(\)/g;
const ACCELERATOR_PATTERN = /accelerator:\s*(['"`])([^'"`]*)\1/;
const REGISTER_PATTERN = /registerAccelerator:\s*false\b/;

// The `{ … }` object literal enclosing `index`: walk back to the unmatched `{`, then
// forward to its `}`. Menu items never nest another object with a `label:` key, so
// the innermost enclosing object is the item.
function enclosingObject(text, index) {
  let depth = 0;
  let start = -1;
  for (let i = index; i >= 0; i -= 1) {
    const char = text[i];
    if (char === '}') depth += 1;
    else if (char === '{') {
      if (depth === 0) {
        start = i;
        break;
      }
      depth -= 1;
    }
  }
  if (start === -1) return null;
  depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Every `label: m.<key>()` menu item: `{ key, accelerator, registersAccelerator, line }`.
export function findMenuItems(content) {
  const items = [];
  for (const match of content.matchAll(LABEL_PATTERN)) {
    const item = enclosingObject(content, match.index);
    if (!item) continue;
    items.push({
      key: match[1],
      accelerator: ACCELERATOR_PATTERN.exec(item)?.[2] ?? null,
      registersAccelerator: !REGISTER_PATTERN.test(item),
      line: content.slice(0, match.index).split('\n').length,
    });
  }
  return items;
}

// Problems with the menu source, one message per violated rule.
export function checkMenuAccelerators(content) {
  const items = findMenuItems(content);
  const problems = [];
  const at = (item) => `${MENU_SOURCE}:${item.line} (${item.key})`;
  for (const [key, accelerator] of Object.entries(RENDERER_OWNED_ACCELERATORS)) {
    const item = items.find((candidate) => candidate.key === key);
    if (!item) {
      problems.push(`missing menu item \`${key}\` (expected accelerator ${accelerator})`);
      continue;
    }
    if (item.accelerator !== accelerator) {
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
  for (const item of items) {
    if (item.accelerator !== null && FORBIDDEN_ACCELERATORS.includes(item.accelerator)) {
      problems.push(`${at(item)} claims ${item.accelerator}, which the renderer owns`);
    }
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
