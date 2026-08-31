/**
 * Rune-backed nullable source for the QuestionWizard teardown crash repro
 * (QuestionWizard.test.ts). Lives in a `.svelte.ts` module so `$state`
 * compiles; a get-accessor `draftKey` prop reading this box makes every prop
 * read re-evaluate against the current (possibly null) value — like
 * ChatPanel's `$derived` `pendingQuestions` — and nulling `current` marks the
 * prop derived dirty so a teardown-time read re-executes instead of serving
 * the cached value.
 */
export function createNullableMessageSource(messageId: string): {
  current: { messageId: string } | null;
} {
  let current = $state<{ messageId: string } | null>({ messageId });
  return {
    get current() {
      return current;
    },
    set current(value) {
      current = value;
    },
  };
}
