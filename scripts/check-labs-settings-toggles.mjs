import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Every app settings schema entry in the `labs` category needs a switch in
// Settings → Labs. A Labs flag without one can only be changed by asking the assistant
// for a settings proposal, so a user who never turned it on cannot reach the feature
// or find out why: the "E2B cloud machines" flag hid Add cloud in Settings → Machines
// (cloudlands-fe#4811, #4826). A switch matches an entry when its `set` dispatches the
// action creator named by the entry's `redux-action` apply plan.
export const SCRIPT_PATH = 'scripts/check-labs-settings-toggles.mjs';
export const SCHEMA_SOURCE = 'src/shared/app-settings-schema.ts';
export const LABS_PAGE_SOURCE = 'src/lib/components/settings/LabsSettings.svelte';

// Labs schema entries that deliberately have no switch: schema path → one-line reason.
// Stale entries (no such labs entry, or one that now has a switch) fail the check.
export const HIDDEN_LABS_SETTINGS = Object.freeze({});

const LABS_CATEGORY_PATTERN = /category:\s*(['"`])labs\1/g;
const SWITCH_KIND_PATTERN = /kind:\s*(['"`])switch\1/g;
const PATH_PATTERN = /\bpath:\s*(['"`])([^'"`]+)\1/;
const APPLY_PATTERN = /\bapply:/;
const APPLY_KIND_PATTERN = /\bkind:\s*(['"`])([^'"`]+)\1/;
const ACTION_PATTERN = /\baction:\s*(['"`])([^'"`]+)\1/;
const DISPATCH_PATTERN = /dispatch\(\s*([A-Za-z_$][\w$]*)\s*\(/g;
const SCRIPT_BLOCK_PATTERN = /<script\b[^>]*>([\s\S]*?)<\/script>/;

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

// Every `category: 'labs'` schema entry: `{ path, applyKind, actionCreator, line }`.
export function findLabsSettings(schemaText) {
  const spans = objectSpans(schemaText);
  const settings = [];
  for (const match of schemaText.matchAll(LABS_CATEGORY_PATTERN)) {
    const entry = innermostSpan(spans, match.index);
    if (!entry) continue;
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
      actionCreator: action ? action.slice(action.lastIndexOf('/') + 1) : null,
      line: lineOf(schemaText, entry.start + (pathMatch?.index ?? 0)),
    });
  }
  return settings;
}

// Action creators dispatched by the `kind: 'switch'` entries of the Labs page.
export function findLabsSwitchActions(pageText) {
  const script = SCRIPT_BLOCK_PATTERN.exec(pageText)?.[1] ?? '';
  const spans = objectSpans(script);
  const actions = new Set();
  for (const match of script.matchAll(SWITCH_KIND_PATTERN)) {
    const entry = innermostSpan(spans, match.index);
    if (!entry) continue;
    for (const dispatch of script.slice(entry.start, entry.end + 1).matchAll(DISPATCH_PATTERN)) {
      actions.add(dispatch[1]);
    }
  }
  return actions;
}

// Problems with the Labs schema entries and their switches, one message per violation.
export function checkLabsSettingsToggles({ schema, page }, hidden = HIDDEN_LABS_SETTINGS) {
  const problems = [];
  const settings = findLabsSettings(schema);
  const switchActions = findLabsSwitchActions(page);
  if (switchActions.size === 0) {
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
        `${at} labs entry has no readable \`path\`; update the parser in ${SCRIPT_PATH}`,
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
    if (switchActions.has(setting.actionCreator)) {
      withSwitch.add(setting.path);
    } else if (!Object.hasOwn(hidden, setting.path)) {
      problems.push(
        `${at} ${setting.path} has no switch in Settings → Labs ` +
          `(expected a switch in ${LABS_PAGE_SOURCE} whose set dispatches ${setting.actionCreator})`,
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
        'why it is missing (cloudlands-fe#4811). Add the switch, or add a',
        `HIDDEN_LABS_SETTINGS entry with a one-line reason in ${SCRIPT_PATH}.`,
      ].join('\n'),
    );
    process.exit(1);
  }
  console.log('Labs settings toggle check passed: every labs setting has a Labs switch.');
}
