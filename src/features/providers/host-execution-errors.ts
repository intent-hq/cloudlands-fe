import { executionAuthorizationSchema } from '$shared/types/host-execution';
import { m } from '$shared/paraglide/messages.js';

/** Only a daemon-classified diagnostic changes recovery; never inspect raw error prose. */
export function hostExecutionAuthorizationMessage(diagnostic: unknown): string | null {
  const parsed = executionAuthorizationSchema.safeParse(diagnostic);
  if (!parsed.success) return null;
  const { resource, reason, recovery } = parsed.data;
  // i18n-ignore (product/protocol names)
  const label = resource === 'ai' ? 'AI' : 'Git';
  const message =
    reason === 'missing'
      ? m.hostExecution_missingAuthorization_description({ resource: label })
      : reason === 'insufficient-scope'
        ? m.hostExecution_insufficientScope_description({ resource: label })
        : m.hostExecution_rejectedAuthorization_description({ resource: label });
  return recovery.setting
    ? `${message} ${m.hostExecution_disabledHelper_description({ setting: recovery.setting })}`
    : message;
}
