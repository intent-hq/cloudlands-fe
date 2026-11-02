import { disableDirectives, namesRule } from './lib/disable-directives.js';

/**
 * Requires an `eslint-disable*` directive that turns off one of the configured rules to
 * cover a single line and to give its reason after `--`:
 *
 *   // eslint-disable-next-line intent/no-fixed-wait-timeout-in-tests -- real daemon RPC
 *   { timeout: 35_000 }, // eslint-disable-line intent/no-fixed-wait-timeout-in-tests -- ...
 *
 * Some rules accept "disable this rule on that line with a reason" as their sanctioned
 * escape hatch. ESLint core cannot require the reason, and a directive cannot be
 * reported by the rule it turns off, so this separate rule checks it. A file- or
 * block-wide `eslint-disable`, and a directive that names no rule (it turns off every
 * rule), are reported too: they would silence later findings no one has reviewed.
 *
 * Options: `{ rules: ['intent/<rule>', ...] }`, the rules whose directives are checked.
 */

const MESSAGES = {
  missingReason:
    'Give the reason for turning off {{rule}} after `--` on this directive, e.g. ' +
    '`// eslint-disable-line {{rule}} -- <why this case is deliberate>`.',
  notLineScoped:
    'Turn off {{rule}} only on the line that needs it, with `eslint-disable-line` or ' +
    '`eslint-disable-next-line` and a reason after `--`; a block-wide `eslint-disable` ' +
    'hides later findings.',
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a reason, and a single-line scope, on directives that turn off the configured rules',
    },
    schema: [
      {
        type: 'object',
        properties: {
          rules: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
        },
        required: ['rules'],
        additionalProperties: false,
      },
    ],
    messages: MESSAGES,
  },

  create(context) {
    const rules = context.options[0]?.rules ?? [];
    return {
      Program() {
        for (const directive of disableDirectives(context.sourceCode)) {
          if (directive.kind === 'enable') continue;
          for (const rule of rules) {
            const ruleName = rule.includes('/') ? rule.slice(rule.indexOf('/') + 1) : rule;
            if (!namesRule(directive, ruleName)) continue;
            const lineScoped =
              directive.rules !== null &&
              (directive.kind === 'disable-line' || directive.kind === 'disable-next-line');
            if (!lineScoped) {
              context.report({
                loc: directive.comment.loc,
                messageId: 'notLineScoped',
                data: { rule },
              });
            } else if (!directive.reason) {
              context.report({
                loc: directive.comment.loc,
                messageId: 'missingReason',
                data: { rule },
              });
            }
          }
        }
      },
    };
  },
};
