---
name: settings-copy
description: >-
  Write or edit Settings page copy: one-sentence row descriptions, extra detail
  behind an info tooltip, no em dashes, no filler. Use when adding or changing a
  setting's label, description or note.
triggers:
  - settings copy
  - setting description
  - settings explanation
  - add a setting
---

# Settings Copy

Settings rows are scanned, not read. Each row gets a short label and at most one
sentence of explanation. Anything else goes behind an info tooltip or is cut.

## Rules

1. **One sentence per description.** A setting row's `description` (or
   `_description` / `Note` message) is a single sentence. Join two short ideas
   with a comma or "and"; do not chain clauses with semicolons to dodge the rule.
2. **Detail goes in an info tooltip.** If the sentence cannot stay accurate
   alone, keep the essential part in `description` and move the rest to `info`.
   Do not drop facts the user needs (data kept or deleted, restart needed,
   permission required).
3. **No em dashes.** Use a comma, colon or period. This applies to every locale.
4. **No AI tells.** Cut "Please", "simply", "easily", "seamless", "leverage",
   "robust", "ensure", "allows you to", "helps you", and stacked parentheticals.
   Prefer "Couldn't save rules. Try again." over "Failed to save rules. Please
   try again."
5. **No internal names.** Do not show API calls (`ws.agent.create`), wire paths
   or flag names unless the user types them (env vars like `CODEX_HOME` are fine).
6. **Lead with the effect.** Say what turning it on does, then the condition:
   "Archive workspaces idle for the days below, which stops their agents and
   hooks."
7. **Readouts are not sentences.** Show a live value such as `Current: {value}`
   on its own line above the description, not inside it.

Confirm dialogs, error toasts and multi-step sign-in flows may use more than one
sentence; keep them short anyway.

## Info tooltip

`SettingsFieldRow` takes an `info` string and renders an info button after the
description, with the text as its tooltip and accessible name.

- Schema rows (`defineSettings`): add `info` next to `description` on the entry.
- Direct rows: pass `info={m.some_key_info()}` to `<SettingsFieldRow>`.
- Agent features: add `info: () => m.…_info()` in `agent-feature-definitions.ts`.

Name the message `<same prefix>_info`. Tests that check the detail should query
the info button (`[data-field-info]` or its accessible name), not body text.

## Messages and locales

- Edit `messages/en.json`, then every other `messages/*.json`. A new key needs a
  real translation in each locale; a value equal to English needs an entry in
  `scripts/i18n-equal-allowlist.json` (add one line, keep the file's format).
- Keep `{param}` placeholders identical across locales.
- Run `pnpm run generate:i18n` and `pnpm run lint:i18n-completeness`.
- For copy-only changes, do not add tests. If a test quoted the old text, switch
  it to the `m.*()` message function instead of pasting the new wording.

## Check before you finish

Scan for multi-sentence descriptions and em dashes:

```bash
python3 - <<'EOF'
import json, re
d = json.load(open('messages/en.json'))
for k, v in d.items():
    if not k.startswith('settings_') or k.endswith('_info'):
        continue
    if '—' in v:
        print('em dash:', k)
    if re.search(r'(_description|Note|_hint|Hint)', k) and \
       len(re.split(r'(?<=[.!?])\s+(?=[A-Z0-9{])', v.strip())) > 1:
        print('multi-sentence:', k)
EOF
```

Then take a screenshot of the changed tab and check the tooltip renders.
