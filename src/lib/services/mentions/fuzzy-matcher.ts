/**
 * VS Code-style fuzzy matching algorithm
 * Provides fast, accurate fuzzy matching with relevance scoring
 */

export interface FuzzyMatchResult {
  score: number;
  matches: number[]; // indices of matched characters
}

/**
 * Performs VS Code-style fuzzy matching on a string
 * Returns a score (0-1) and the indices of matched characters
 *
 * Algorithm:
 * 1. All query characters must appear in order in the target string
 * 2. Consecutive matches score higher (bonus for adjacent characters)
 * 3. Matches at word boundaries score higher
 * 4. Matches at the start of the string score higher
 * 5. Shorter overall match spans score higher
 *
 * @param query - The search query (e.g., "fmsy")
 * @param target - The string to search in (e.g., "FileManagementSystem")
 * @returns FuzzyMatchResult with score and match indices, or null if no match
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatchResult | null {
  if (!query || !target) {
    return null;
  }

  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  // Quick check: all query characters must exist in target
  let queryIdx = 0;
  for (let i = 0; i < targetLower.length && queryIdx < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIdx]) {
      queryIdx++;
    }
  }
  if (queryIdx !== queryLower.length) {
    return null; // No match
  }

  // Find the best match by trying to match greedily
  const matches = findBestMatch(queryLower, targetLower);
  if (!matches) {
    return null;
  }

  // Calculate score based on match quality
  const score = calculateScore(queryLower, targetLower, matches);

  return { score, matches };
}

/**
 * Find the best match indices for query characters in target
 * Uses a greedy approach with lookahead for better results
 */
function findBestMatch(query: string, target: string): number[] | null {
  const matches: number[] = [];
  let targetIdx = 0;

  for (let queryIdx = 0; queryIdx < query.length; queryIdx++) {
    const char = query[queryIdx];
    let found = false;

    // Try to find the character, preferring word boundaries and consecutive matches
    for (let i = targetIdx; i < target.length; i++) {
      if (target[i] === char) {
        matches.push(i);
        targetIdx = i + 1;
        found = true;
        break;
      }
    }

    if (!found) {
      return null;
    }
  }

  return matches;
}

/**
 * Calculate a relevance score for the match
 * Score factors (in order of importance):
 * 1. All characters matched (required)
 * 2. Consecutive character matches (bonus)
 * 3. Match at word boundaries (bonus)
 * 4. Match at start of string (bonus)
 * 5. Shorter match span (bonus)
 */
function calculateScore(query: string, target: string, matches: number[]): number {
  let score = 0;

  // Base score for having a match
  score += 1;

  // Bonus for consecutive matches
  let consecutiveBonus = 0;
  for (let i = 1; i < matches.length; i++) {
    if (matches[i] === matches[i - 1] + 1) {
      consecutiveBonus += 0.1; // Bonus for each consecutive match
    }
  }
  score += consecutiveBonus;

  // Bonus for word boundary matches
  let wordBoundaryBonus = 0;
  for (const matchIdx of matches) {
    if (matchIdx === 0 || isWordBoundary(target, matchIdx)) {
      wordBoundaryBonus += 0.15;
    }
  }
  score += wordBoundaryBonus;

  // Bonus for starting at the beginning
  if (matches[0] === 0) {
    score += 0.2;
  }

  // Penalty for long match spans (prefer tighter matches)
  const matchSpan = matches[matches.length - 1] - matches[0];
  const spanPenalty = (matchSpan / target.length) * 0.3;
  score -= spanPenalty;

  // Normalize score to 0-1 range
  const maxScore = 2.5;
  return Math.min(score / maxScore, 1);
}

/**
 * Check if a position is at a word boundary
 * Word boundaries are: uppercase letters, after non-alphanumeric, after underscore
 */
function isWordBoundary(str: string, idx: number): boolean {
  if (idx === 0) return true;

  const char = str[idx];
  const prevChar = str[idx - 1];

  // Uppercase letter after lowercase (camelCase boundary)
  if (char === char.toUpperCase() && prevChar === prevChar.toLowerCase()) {
    return true;
  }

  // After non-alphanumeric character (word separator)
  if (!/[a-z0-9]/i.test(prevChar)) {
    return true;
  }

  return false;
}

/**
 * Path-aware fuzzy matching for file paths
 * Matches query segments against path segments (e.g., "routes/svelte" matches "src/routes/shared/+page.svelte")
 *
 * Algorithm:
 * 1. If query doesn't contain "/", delegate to regular fuzzyMatch (backward compatible)
 * 2. Split query and target path on "/" into segments
 * 3. Match query segments against target segments in order (segments can be skipped)
 * 4. Last query segment also matches against file extension (e.g., "svelte" matches ".svelte")
 * 5. Score based on: segment match quality, consecutive segments, exact matches, filename match
 *
 * @param query - The search query (e.g., "routes/svelte")
 * @param targetPath - The file path to search in (e.g., "src/routes/shared/+page.svelte")
 * @returns FuzzyMatchResult with score and match indices, or null if no match
 */
export function pathFuzzyMatch(query: string, targetPath: string): FuzzyMatchResult | null {
  if (!query || !targetPath) {
    return null;
  }

  // If query doesn't contain "/", delegate to regular fuzzyMatch
  if (!query.includes('/')) {
    return fuzzyMatch(query, targetPath);
  }

  // Split into segments, filtering out empty ones
  const querySegments = query.split('/').filter((s) => s.length > 0);
  const pathSegments = targetPath.split('/').filter((s) => s.length > 0);

  if (querySegments.length === 0 || pathSegments.length === 0) {
    return null;
  }

  // Try to match query segments against path segments
  const matchResult = matchPathSegments(querySegments, pathSegments);
  if (!matchResult) {
    return null;
  }

  // Calculate score based on match quality
  const score = calculatePathScore(querySegments, pathSegments, matchResult);

  return { score, matches: [] }; // matches array not used for path matching
}

/**
 * Match query segments against path segments in order
 * Returns indices of matched path segments, or null if no match
 */
function matchPathSegments(
  querySegments: string[],
  pathSegments: string[],
): number[] | null {
  const matchedIndices: number[] = [];
  let pathIdx = 0;

  for (let queryIdx = 0; queryIdx < querySegments.length; queryIdx++) {
    const querySegment = querySegments[queryIdx];
    let found = false;

    // For the last query segment, also try matching against file extension
    const isLastSegment = queryIdx === querySegments.length - 1;

    // Try to find a matching path segment
    for (let i = pathIdx; i < pathSegments.length; i++) {
      const pathSegment = pathSegments[i];

      // Try fuzzy match against the segment
      if (fuzzyMatch(querySegment, pathSegment)) {
        matchedIndices.push(i);
        pathIdx = i + 1;
        found = true;
        break;
      }

      // For last segment, also try matching against file extension
      if (isLastSegment) {
        const lastSegmentWithoutExt = pathSegment.split('.')[0];
        const extension = pathSegment.includes('.') ? pathSegment.split('.').pop() : '';

        // Try matching against extension
        if (extension && fuzzyMatch(querySegment, extension)) {
          matchedIndices.push(i);
          pathIdx = i + 1;
          found = true;
          break;
        }

        // Try matching against filename without extension
        if (lastSegmentWithoutExt && fuzzyMatch(querySegment, lastSegmentWithoutExt)) {
          matchedIndices.push(i);
          pathIdx = i + 1;
          found = true;
          break;
        }
      }
    }

    if (!found) {
      return null;
    }
  }

  return matchedIndices;
}

/**
 * Calculate score for path matching
 * Factors: segment match quality, consecutive segments, exact matches, filename match
 */
function calculatePathScore(
  querySegments: string[],
  pathSegments: string[],
  matchedIndices: number[],
): number {
  let score = 0;

  // Base score for having a match
  score += 1;

  // Bonus for each matched segment
  score += matchedIndices.length * 0.2;

  // Bonus for consecutive matched segments (no gaps)
  let consecutiveBonus = 0;
  for (let i = 1; i < matchedIndices.length; i++) {
    if (matchedIndices[i] === matchedIndices[i - 1] + 1) {
      consecutiveBonus += 0.15;
    }
  }
  score += consecutiveBonus;

  // Bonus for matching the last path segment (filename)
  if (matchedIndices.length > 0 && matchedIndices[matchedIndices.length - 1] === pathSegments.length - 1) {
    score += 0.3;
  }

  // Bonus for exact segment matches
  for (let i = 0; i < querySegments.length && i < matchedIndices.length; i++) {
    const querySegment = querySegments[i];
    const pathSegment = pathSegments[matchedIndices[i]];

    if (querySegment.toLowerCase() === pathSegment.toLowerCase()) {
      score += 0.2;
    }
  }

  // Normalize score to 0-1 range
  const maxScore = 3;
  return Math.min(score / maxScore, 1);
}

/**
 * Filter and score an array of candidates
 * Returns candidates sorted by relevance score (highest first)
 */
export function fuzzyFilterAndScore<T>(
  query: string,
  candidates: T[],
  textExtractor: (item: T) => string,
): Array<T & { score: number }> {
  if (!query) {
    // Return all candidates with neutral score
    return candidates.map((item) => ({
      ...item,
      score: 0.5,
    }));
  }

  const results: Array<T & { score: number }> = [];

  for (const candidate of candidates) {
    const text = textExtractor(candidate);
    const match = fuzzyMatch(query, text);

    if (match) {
      results.push({
        ...candidate,
        score: match.score,
      });
    }
  }

  // Sort by score (highest first)
  results.sort((a, b) => b.score - a.score);

  return results;
}
