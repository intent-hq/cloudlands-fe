#!/bin/bash
set -e

for threadId in PRRT_kwDOTIOFBc6SIKZD PRRT_kwDOTIOFBc6SIKZE PRRT_kwDOTIOFBc6SIKZG PRRT_kwDOTIOFBc6SIKZL PRRT_kwDOTIOFBc6SIKZQ PRRT_kwDOTIOFBc6SIKZT; do
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

echo "All threads resolved!"
