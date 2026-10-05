/** Shortest input (after normalization) that triggers a GitHub user search. */
export const GITHUB_USER_QUERY_MIN_LENGTH = 2;

/** Trim and drop a leading `@` so `@octo` and `octo` are the same search. */
export function normalizeGithubUserQuery(raw: string): string {
  return raw.trim().replace(/^@/, '');
}
