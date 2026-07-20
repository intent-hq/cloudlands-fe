#!/bin/bash
set -e

for threadId in PRRT_kwDOTIOFBc6SIQeI PRRT_kwDOTIOFBc6SIQeQ PRRT_kwDOTIOFBc6SIQeU PRRT_kwDOTIOFBc6SIQeY; do
  echo "Resolving $threadId..."
  gh api graphql -F threadId="$threadId" -f query='
    mutation($threadId: ID!) {
      resolveReviewThread(input: {threadId: $threadId}) {
        thread {
          isResolved
        }
      }
    }
  '
done

echo "All new threads resolved!"
