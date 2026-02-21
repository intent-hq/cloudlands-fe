# Mention System Test Page

A standalone, browser-only test page for the mention system at `/test-mentions`.

## Purpose

This page demonstrates all mention system states and interactions without requiring IPC/Electron dependencies. It's useful for:

- Testing mention UI components in isolation
- Verifying keyboard and mouse interactions
- Debugging mention rendering and preview panels
- Developing new mention types
- QA testing without full app setup

## Features

### Mock Data

All mention types are represented with realistic mock data:

- **Files**: 2 examples with paths and language metadata
- **Folders**: 2 examples with file counts
- **Notes**: 2 examples with preview content
- **Tasks**: 3 examples with different statuses
- **Personalities**: 2 examples
- **Rules**: 2 examples

### Interactive Controls

- **Show/Hide Menu**: Toggle mention menu visibility
- **Show/Hide Preview**: Toggle preview panel
- **Search**: Filter mentions by text
- **Type Filter**: Filter by specific mention type
- **Test States**: Quick buttons for edge cases

### Testing Capabilities

- Empty query state
- Search results
- All mention types
- Preview panel
- Keyboard navigation (arrows, enter, escape)
- Mouse interactions
- Empty state (no results)
- Selection handling

## Usage

1. Start the dev server:

   ```bash
   pnpm dev:renderer
   ```

2. Navigate to: http://localhost:5177/test-mentions

3. Use the controls panel to test different states

4. Check browser console for any errors

## Implementation

The page is completely standalone:

- No IPC dependencies
- No workspace or file system access
- All data mocked in the component
- Uses existing `EnhancedMentionList` component
- Can run in any browser

## Files

- `+page.svelte` - Main test page component
- `README.md` - This file

## Related Components

- `$lib/components/chat/input/EnhancedMentionList.svelte` - Main mention dropdown UI
- `$lib/services/mentions/types.ts` - Mention type definitions
- `$lib/services/mentions/mention-system.ts` - Mention system service
