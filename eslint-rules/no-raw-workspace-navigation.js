// In-app navigation to `/workspace/<id>` shows the workspace page but never adds
// the workspace to the tab strip; only boot-time routing in `+layout.svelte`
// opens the routed workspace's tab. Every caller that jumped to a workspace had
// to remember a separate `openWorkspaceTab` dispatch, and each miss shipped as
// "the page switches but the tab bar doesn't show the workspace": notification
// clicks (cloudlands-fe#3850), intent links (#3781), Home double-click (#3567),
// then git/agent toasts, the command palette, workspace links and proposals.
//
// `openAndShowWorkspace` / `showWorkspaceSaga` in
// `src/lib/utils/show-workspace.ts` navigate and then open the tab. This
// rule flags a hand-written `goto(...)`, `navigateToRoute(...)`, injected
// `navigate(...)` / `deps.navigate(...)` (the hardware encoder and action
// keys once jumped this way) or saga `call(goto | navigateToRoute, ...)` whose
// route is built from a `/workspace/` template or string concatenation (either
// branch of a ternary counts). Constant routes such as '/workspace/new' are
// not workspace jumps and pass. A route held in a variable is not traced.
//
// Navigation that deliberately must not open a tab (tab-close fallbacks whose
// target tab is already open, creation flows whose tab the initialization saga
// opens) uses `eslint-disable-next-line intent/no-raw-workspace-navigation --
// <reason>`.

const NAVIGATORS = new Set(['goto', 'navigateToRoute', 'navigate']);
const WORKSPACE_PREFIX = '/workspace/';

const WRAPPER_TYPES = new Set([
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'ParenthesizedExpression',
]);

function unwrap(node) {
  let current = node;
  while (current && WRAPPER_TYPES.has(current.type)) current = current.expression;
  return current;
}

function leftmostOperand(node) {
  let current = unwrap(node);
  while (current?.type === 'BinaryExpression' && current.operator === '+') {
    current = unwrap(current.left);
  }
  return current;
}

/** True when `node` builds a dynamic `/workspace/...` route. */
function isDynamicWorkspaceRoute(node) {
  const route = unwrap(node);
  if (!route) return false;
  if (route.type === 'ConditionalExpression') {
    return isDynamicWorkspaceRoute(route.consequent) || isDynamicWorkspaceRoute(route.alternate);
  }
  if (route.type === 'TemplateLiteral') {
    const head = route.quasis[0]?.value.cooked ?? '';
    return route.expressions.length > 0 && head.startsWith(WORKSPACE_PREFIX);
  }
  if (route.type === 'BinaryExpression' && route.operator === '+') {
    const head = leftmostOperand(route);
    return (
      head?.type === 'Literal' &&
      typeof head.value === 'string' &&
      head.value.startsWith(WORKSPACE_PREFIX)
    );
  }
  return false;
}

/**
 * The navigator name of a `goto`, `navigate`, `deps.navigate` or
 * `(deps.navigate ?? navigateToRoute)` callee, else null.
 */
function navigatorName(node) {
  const callee = unwrap(node);
  if (callee?.type === 'Identifier') return NAVIGATORS.has(callee.name) ? callee.name : null;
  if (callee?.type === 'LogicalExpression') {
    return navigatorName(callee.left) ?? navigatorName(callee.right);
  }
  if (
    callee?.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    NAVIGATORS.has(callee.property.name)
  ) {
    return callee.property.name;
  }
  return null;
}

/** The route argument of a navigation call, or null when `node` is not one. */
function navigationRoute(node) {
  const callee = unwrap(node.callee);
  const direct = navigatorName(callee);
  if (direct) return { navigator: direct, route: node.arguments[0] };
  if (callee?.type === 'Identifier' && callee.name === 'call') {
    const wrapped = navigatorName(node.arguments[0]);
    if (wrapped) return { navigator: wrapped, route: node.arguments[1] };
  }
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hand-written navigation to a workspace route; use openAndShowWorkspace so the workspace tab opens too.',
    },
    schema: [],
    messages: {
      rawWorkspaceNavigation:
        '`{{navigator}}` to a `/workspace/` route shows the page but never opens the workspace tab ' +
        '(cloudlands-fe#3850). Use `openAndShowWorkspace(id, { query })` (or `showWorkspaceSaga` in a saga) ' +
        'from `$lib/utils/show-workspace`, which navigates and then opens the tab.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const match = navigationRoute(node);
        if (!match || !isDynamicWorkspaceRoute(match.route)) return;
        context.report({
          node,
          messageId: 'rawWorkspaceNavigation',
          data: { navigator: match.navigator },
        });
      },
    };
  },
};
