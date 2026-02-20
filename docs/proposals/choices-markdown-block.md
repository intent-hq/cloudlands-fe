# TipTap Choice Block Extension - Technical Specification

## ⚠️ V2 Architecture (Non-Atomic with Nested Content)

**Status**: This document describes V2 architecture using non-atomic nodes with nested editable content.

**V1 (Deprecated)**: The initial spike used atomic nodes with text in attributes. This caused focus loss on every keystroke because updating attributes triggers ProseMirror transactions that re-render the entire node. V1 is being replaced with V2.

## Overview

This specification describes a custom TipTap extension that renders interactive multiple-choice questions within a document. The extension supports markdown round-tripping, allowing agents to pose questions to users and users to select and edit options inline.

**Key Architectural Decision**: Uses **non-atomic nodes with nested content** (like TaskItem) instead of atomic nodes with attributes. This allows TipTap to manage editable content directly via `contentDOM`, preventing focus loss during editing.

## Use Case

In spec-driven development workflows, AI agents pose multiple-choice questions to users in markdown format. This extension provides an interactive UI for users to:
1. Select an option by clicking
2. Edit option text inline to add clarifications or modifications
3. Have their selections and edits round-trip cleanly back to markdown for agent consumption

## Markdown Syntax

The extension uses fenced code blocks with the `choice` language identifier:

```choice
Which approach should we take?
( ) Option A: Use REST API
(x) Option B: Use tRPC
( ) Option C: Use GraphQL
```

**Syntax Rules:**
- First line is the question text
- Subsequent lines are options in format: `(marker) option text`
- `( )` indicates an unselected option
- `(x)` indicates the selected option
- Only one option can be selected at a time (radio button behavior)
- Option text is plain text (no rich formatting within options)

## Node Structure (V2 - Non-Atomic)

### Node Hierarchy

```
choiceBlock (container)
├── choiceQuestion (question text - editable)
│   └── paragraph (contains text)
└── choiceOption (repeatable - one per option)
    ├── selected: boolean (attribute)
    └── paragraph (option text - editable)
```

### Node Definitions

#### `choiceBlock` Node
```typescript
{
  name: 'choiceBlock',
  group: 'block',
  content: 'choiceQuestion choiceOption+',  // Question + 1 or more options
  isolating: true,  // Prevents content from being merged with surrounding blocks

  parseHTML() {
    return [{ tag: 'div[data-type="choice-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'choice-block' })];
  }
}
```

#### `choiceQuestion` Node
```typescript
{
  name: 'choiceQuestion',
  content: 'paragraph',  // Contains editable text

  parseHTML() {
    return [{ tag: 'div[data-type="choice-question"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'choice-question' })];
  }
}
```

#### `choiceOption` Node
```typescript
{
  name: 'choiceOption',
  content: 'paragraph',  // Contains editable text

  addAttributes() {
    return {
      selected: {
        default: false,
        parseHTML: element => element.getAttribute('data-selected') === 'true',
        renderHTML: attributes => ({
          'data-selected': attributes.selected
        })
      }
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="choice-option"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'choice-option' })];
  }
}
```

### Why Non-Atomic?

**Problem with V1 (Atomic)**:
- Option text stored in node attributes
- Every keystroke updates attributes → ProseMirror transaction → full node re-render → **focus loss**
- Workarounds (blur-based editing, debouncing) provide poor UX

**Solution with V2 (Non-Atomic)**:
- Option text lives in nested `paragraph` nodes with `contentDOM`
- TipTap manages editing directly (like TaskItem does)
- No re-renders during typing → **focus maintained**
- Proper cursor positioning, selection, undo/redo

## V2 Implementation Challenges

### Challenge 1: Markdown Parsing Complexity ⚠️ HIGH

**Problem**: Markdown is flat text, but V2 uses nested ProseMirror nodes.

**V1 Approach** (simple):
```javascript
// Parse markdown → create single node with attributes
{ type: 'choiceBlock', attrs: { question: '...', options: [...] } }
```

**V2 Approach** (complex):
```javascript
// Parse markdown → create nested node structure
{
  type: 'choiceBlock',
  content: [
    { type: 'choiceQuestion', content: [{ type: 'paragraph', content: [...] }] },
    { type: 'choiceOption', attrs: { selected: false }, content: [{ type: 'paragraph', content: [...] }] },
    { type: 'choiceOption', attrs: { selected: true }, content: [{ type: 'paragraph', content: [...] }] }
  ]
}
```

**Solution Strategy**:
- Extend `addChoiceBlockSupport()` in `tiptap-choice-block-extension.ts`
- Instead of returning a single `<div>` with attributes, return nested HTML structure
- Let TipTap's HTML parser convert to ProseMirror nodes
- **Key**: Must generate HTML that matches the `parseHTML()` rules of all three node types

**Example HTML Output**:
```html
<div data-type="choice-block">
  <div data-type="choice-question">
    <p>Which approach should we take?</p>
  </div>
  <div data-type="choice-option" data-selected="false">
    <p>Option A: Use REST API</p>
  </div>
  <div data-type="choice-option" data-selected="true">
    <p>Option B: Use tRPC</p>
  </div>
</div>
```

### Challenge 2: Markdown Serialization Complexity ⚠️ MEDIUM

**Problem**: Must traverse nested node structure to extract text.

**V1 Approach** (simple):
```javascript
// Attributes already contain all data
const question = node.attrs.question;
const options = node.attrs.options.map(opt => `(${opt.selected ? 'x' : ' '}) ${opt.text}`);
```

**V2 Approach** (complex):
```javascript
// Must traverse child nodes to extract text
const questionNode = node.content.child(0);  // choiceQuestion
const questionText = questionNode.textContent;

const options = [];
for (let i = 1; i < node.content.childCount; i++) {
  const optionNode = node.content.child(i);  // choiceOption
  const selected = optionNode.attrs.selected;
  const text = optionNode.textContent;
  options.push(`(${selected ? 'x' : ' '}) ${text}`);
}
```

**Solution Strategy**:
- Update `convertElement()` in `markdown-processor.ts`
- Add logic to handle `data-type="choice-block"` elements
- Recursively extract text from nested `choice-question` and `choice-option` elements
- **Key**: Must handle case where paragraph might contain formatting (though spec says plain text only)

### Challenge 3: Selection Behavior with contentDOM ⚠️ HIGH

**Problem**: When option text is editable via `contentDOM`, clicking to select becomes ambiguous.

**V1 Approach**:
- Input field has `onclick={handleInputClick}` to stop propagation
- Clicking outside input selects the option

**V2 Approach**:
- The entire option content is editable (no separate input field)
- Clicking anywhere in the option focuses the text for editing
- **How do we select an option without clicking the text?**

**Possible Solutions**:
1. **Radio button approach** (recommended):
   - Add explicit radio button/indicator that's clickable
   - Clicking indicator selects option
   - Clicking text focuses for editing
   - Similar to how TaskItem checkbox works

2. **Click-outside-text approach**:
   - Add padding/margin around text
   - Clicking padding selects option
   - Clicking text focuses for editing
   - Fragile UX, easy to mis-click

3. **Keyboard shortcut**:
   - Click text to edit
   - Press Cmd+Enter to select option
   - Not discoverable, requires documentation

**Recommended**: Option 1 with explicit radio button indicator.

### Challenge 4: NodeView with Multiple contentDOM Areas ⚠️ MEDIUM

**Problem**: A single NodeView can only have ONE `contentDOM` area.

**V1 Approach**:
- No `contentDOM` (atom node)
- Svelte component manages all UI

**V2 Approach**:
- `choiceBlock` NodeView needs to render:
  - Question area (contentDOM for choiceQuestion)
  - Multiple option areas (contentDOM for each choiceOption)
- **But NodeView only supports one contentDOM!**

**Solution Strategy**:
- **Don't use NodeView for `choiceBlock`** - let TipTap render it normally
- **Use NodeView only for `choiceOption`** to add the radio button indicator
- The question and option text are rendered by TipTap's default rendering
- NodeView wraps each option to add interactive selection UI

**Architecture**:
```typescript
// choiceBlock - NO NodeView (default rendering)
export const ChoiceBlock = Node.create({
  name: 'choiceBlock',
  content: 'choiceQuestion choiceOption+',
  // No addNodeView()
});

// choiceQuestion - NO NodeView (default rendering)
export const ChoiceQuestion = Node.create({
  name: 'choiceQuestion',
  content: 'paragraph',
  // No addNodeView()
});

// choiceOption - YES NodeView (adds radio button)
export const ChoiceOption = Node.create({
  name: 'choiceOption',
  content: 'paragraph',

  addNodeView() {
    return SvelteNodeViewRenderer(ChoiceOptionNodeView);
  }
});
```

**ChoiceOptionNodeView.svelte**:
```svelte
<NodeViewWrapper as="div" class="choice-option">
  <button onclick={handleSelect}>
    {selected ? '●' : '○'}
  </button>
  <NodeViewContent class="choice-option-text" />
</NodeViewWrapper>
```

### Challenge 5: Ensuring Only One Option Selected ⚠️ MEDIUM

**Problem**: With nested nodes, how do we enforce mutual exclusion?

**V1 Approach**:
- All options in single array attribute
- Easy to map and set only one `selected: true`

**V2 Approach**:
- Options are separate sibling nodes
- Selecting one option needs to deselect all siblings
- Must traverse parent's children to update all options

**Solution Strategy**:
- In `ChoiceOptionNodeView`, when user clicks to select:
  1. Get parent `choiceBlock` node position
  2. Traverse all `choiceOption` children
  3. Create transaction that updates all options:
     - Set clicked option to `selected: true`
     - Set all other options to `selected: false`
  4. Apply transaction

**Code Pattern** (similar to TaskItem status updates):
```typescript
function handleSelect() {
  const pos = getPos();
  const parentPos = /* find parent choiceBlock */;
  const parent = editor.state.doc.nodeAt(parentPos);

  // Build transaction to update all options
  const tr = editor.state.tr;
  parent.forEach((child, offset) => {
    if (child.type.name === 'choiceOption') {
      const childPos = parentPos + offset + 1;
      tr.setNodeMarkup(childPos, null, {
        ...child.attrs,
        selected: childPos === pos  // Only this one is selected
      });
    }
  });

  editor.view.dispatch(tr);
}
```

### Challenge 6: CSS Styling with Nested Structure ⚠️ LOW

**Problem**: V1 had flat structure, V2 has nested divs.

**V1 CSS**:
```css
.choice-block-option { /* style option */ }
.choice-block-option-input { /* style input */ }
```

**V2 CSS**:
```css
div[data-type="choice-block"] { /* container */ }
div[data-type="choice-question"] { /* question */ }
div[data-type="choice-option"] { /* option */ }
div[data-type="choice-option"][data-selected="true"] { /* selected */ }
```

**Solution**: Straightforward CSS updates, not a major challenge.

### Challenge 7: Testing Complexity ⚠️ MEDIUM

**Problem**: More nodes = more test cases.

**V1 Tests**:
- Parse markdown → single node
- Serialize node → markdown
- Update attributes → check state

**V2 Tests**:
- Parse markdown → nested node structure
- Verify question node exists with correct content
- Verify option nodes exist with correct attributes
- Serialize nested structure → markdown
- Update option selection → verify siblings updated
- Test contentDOM editing (focus, typing, selection)

**Solution**: More comprehensive test suite, but follows existing patterns from TaskItem tests.

## Parsing (Markdown → ProseMirror) - V2

The parser should:

1. Recognize fenced code blocks with `lang="choice"`
2. Split the content by newlines
3. Extract the question from the first line
4. Parse subsequent lines matching the pattern: `/^\(([x ])\) (.+)$/`
5. Generate nested HTML structure:
   ```html
   <div data-type="choice-block">
     <div data-type="choice-question">
       <p>{question text}</p>
     </div>
     <div data-type="choice-option" data-selected="false">
       <p>{option text}</p>
     </div>
     <!-- more options -->
   </div>
   ```
6. Let TipTap's HTML parser convert to ProseMirror nodes

**Key Changes from V1**:
- No longer creating node attributes with option data
- Instead, creating nested HTML that TipTap will parse into nested nodes
- Each option becomes a separate `choiceOption` node with its own `paragraph` content

**Edge Cases**:
- If no option is marked with `(x)`, all options should have `data-selected="false"`
- If multiple options are marked with `(x)`, only the first should be `data-selected="true"`
- Lines that don't match the option pattern should be ignored
- Empty question text should be preserved as `<p></p>`
- Must escape HTML special characters in question and option text

## Serialization (ProseMirror → Markdown) - V2

The serializer should:

1. Detect `<div data-type="choice-block">` elements
2. Find child `<div data-type="choice-question">` and extract text content
3. Find all child `<div data-type="choice-option">` elements
4. For each option:
   - Read `data-selected` attribute
   - Extract text content from nested paragraph
   - Format as `(marker) text` where marker is `x` or space
5. Output as fenced code block:
   ```
   ```choice
   {question text}
   ( ) {option 1 text}
   (x) {option 2 text}
   ```
   ```

**Key Changes from V1**:
- Must traverse nested DOM structure to extract text
- Question text is in `choice-question > p` (not in attributes)
- Option text is in `choice-option > p` (not in attributes)
- Selected state is in `data-selected` attribute (not in options array)

**Implementation Location**:
- Update `convertElement()` function in `markdown-processor.ts`
- Add case for `data-type="choice-block"`
- Use `element.querySelector()` to find question and options
- Use `textContent` to extract plain text from paragraphs

**Important:** The round-trip should preserve user edits to option text exactly.

## UI Rendering (NodeView)

### Visual Design

The choice block should render as a card-style component:

```
┌─────────────────────────────────────────┐
│ Question text here                      │
├─────────────────────────────────────────┤
│ ○  [Option text input field        ]   │
├─────────────────────────────────────────┤
│ ●  [Selected option text field     ]   │
├─────────────────────────────────────────┤
│ ○  [Another option text field      ]   │
└─────────────────────────────────────────┘
```

### DOM Structure

```html

  {question text}


      ○ or ●





```

### Interactive Behavior

**Selection:**
- Clicking anywhere on a choice card (except the input field) selects that option
- Selection is mutually exclusive (radio button behavior)
- Selected card gets a visual highlight (add `selected` class)
- Selection indicator changes from `○` to `●`
- Selecting an option updates the node attributes to mark that option as selected and all others as unselected

**Text Editing:**
- Each option has an `<input type="text">` element
- Input should have `border: none` and `background: transparent` to blend with card
- Clicking the input field focuses it for editing (does not trigger selection)
- As the user types, the node attributes should update with the new text
- Use `input` event (not `change`) for real-time updates

**Event Handling:**
- Stop propagation on input clicks to prevent card selection
- Update node attributes using the `updateAttributes` function provided by TipTap
- When updating selection, create a new options array with all options updated accordingly
- When updating text, create a new options array with only the modified option changed

### Styling Requirements

**Container:**
- Border: 1px solid #e0e0e0
- Border radius: 8px
- Margin: 1em 0
- Overflow: hidden (for clean border radius)

**Question Header:**
- Padding: 12px 16px
- Font weight: 600
- Background: #f8f8f8
- Border bottom: 1px solid #e0e0e0

**Choice Cards:**
- Display: flex
- Align items: center
- Padding: 8px 16px
- Border bottom: 1px solid #e0e0e0 (except last card)
- Cursor: pointer
- Transition: background 0.2s
- Hover: background #f8f8f8
- Selected: background #e3f2fd

**Selection Indicator:**
- Width: 24px
- Font size: 18px
- Color: #666 (default), #1976d2 (selected)
- Flex shrink: 0

**Text Input:**
- Flex: 1
- Border: none
- Background: transparent
- Padding: 4px 8px
- Font size: 14px
- Outline: none

## Implementation Notes

### Using TipTap's Extension API

```typescript
import { Node } from '@tiptap/core';

const ChoiceBlock = Node.create({
  name: 'choiceBlock',

  group: 'block',

  atom: true,

  addAttributes() {
    return {
      question: {
        default: '',
      },
      options: {
        default: [],
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="choice-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-type': 'choice-block', ...HTMLAttributes }];
  },

  addNodeView() {
    return ({ node, editor, getPos, updateAttributes }) => {
      // Implementation here (see UI Rendering section)
    };
  },
});
```

### Markdown Integration

If using `@tiptap/extension-markdown` or a custom markdown parser/serializer:

**Parser hook:**
- Register a handler for code blocks with `lang === 'choice'`
- Parse the content and create the node

**Serializer hook:**
- Register a handler for `choiceBlock` nodes
- Serialize to the fenced block format

### State Management

- All state lives in node attributes
- Updates trigger ProseMirror transactions
- Use `updateAttributes` to modify the node
- Create new arrays/objects for immutability (don't mutate existing attributes)

### Accessibility Considerations

- Consider adding proper ARIA labels
- Radio indicators should be semantic (consider using actual radio inputs that are styled)
- Keyboard navigation should work (Tab to move between options, Space/Enter to select)

## Testing Strategy

### Round-trip Tests

Test that markdown → parse → serialize → markdown produces identical output:

```typescript
const testCases = [
  {
    markdown: '```choice\nWhich one?\n( ) A\n(x) B\n( ) C\n```',
    expected: '```choice\nWhich one?\n( ) A\n(x) B\n( ) C\n```'
  },
  // Add more test cases
];
```

### Interaction Tests

- Clicking a card selects it
- Clicking input field does not select the card
- Editing input updates the node attributes
- Only one option can be selected at a time
- Selection state persists through document save/load

### Edge Cases

- Empty question text
- No selected option
- Multiple options marked as selected (should select only first)
- Very long option text (should the input scroll or wrap?)
- Special characters in option text
- Empty option text

## Future Enhancements (Out of Scope)

- Allow question text to be editable
- Support for "no selection" state
- Add/remove options dynamically
- Rich text within options
- Multiselect (checkbox) mode
- Required/optional indicator
- Custom validation

## Dependencies

- TipTap core
- ProseMirror (included with TipTap)
- Optional: `@tiptap/extension-markdown` if using markdown integration

## File Structure

Recommended organization:

```
/extensions
  /choice-block
    index.ts              # Main extension export
    choice-block.ts       # Extension definition
    choice-block-view.ts  # NodeView implementation
    choice-block.css      # Styles
    parser.ts             # Markdown parser logic
    serializer.ts         # Markdown serializer logic
    types.ts              # TypeScript interfaces
```

## V2 Implementation Roadmap

### Phase 1: Define Node Schema (TDD)
**Goal**: Create three node types with proper content schema

**Files to Create/Modify**:
- `src/lib/components/tiptap/ChoiceBlock.ts` - Define all three nodes
- `src/lib/components/tiptap/__tests__/ChoiceBlock.test.ts` - Schema tests

**Tests**:
1. ✅ `choiceBlock` node accepts `choiceQuestion` + `choiceOption+` content
2. ✅ `choiceQuestion` node accepts `paragraph` content
3. ✅ `choiceOption` node accepts `paragraph` content
4. ✅ `choiceOption` has `selected` attribute (boolean)
5. ✅ Can create nested structure programmatically

**Challenges**: None - straightforward schema definition

### Phase 2: Update Markdown Parser (TDD)
**Goal**: Parse markdown to nested HTML structure

**Files to Modify**:
- `src/lib/utils/tiptap-choice-block-extension.ts` - Update `addChoiceBlockSupport()`
- `src/lib/utils/__tests__/choice-block-markdown.test.ts` - Update tests

**Tests**:
1. ✅ Parse markdown → nested HTML with correct structure
2. ✅ Question text appears in `<div data-type="choice-question"><p>...</p></div>`
3. ✅ Options appear in `<div data-type="choice-option" data-selected="..."><p>...</p></div>`
4. ✅ Selected option has `data-selected="true"`
5. ✅ HTML special characters are escaped

**Challenges**:
- **Challenge 1** (HIGH): Must generate nested HTML instead of flat attributes
- Need to ensure HTML structure matches `parseHTML()` rules

### Phase 3: Update Markdown Serializer (TDD)
**Goal**: Serialize nested nodes back to markdown

**Files to Modify**:
- `src/lib/utils/markdown-processor.ts` - Update `convertElement()`
- `src/lib/utils/__tests__/choice-block-markdown.test.ts` - Update tests

**Tests**:
1. ✅ Serialize nested HTML → markdown
2. ✅ Extract question text from nested structure
3. ✅ Extract option text and selected state from nested structure
4. ✅ Round-trip test: markdown → HTML → markdown (identical)

**Challenges**:
- **Challenge 2** (MEDIUM): Must traverse nested DOM to extract text
- Must handle case where paragraph might be empty

### Phase 4: Create ChoiceOption NodeView (TDD)
**Goal**: Add radio button indicator and selection behavior

**Files to Create/Modify**:
- `src/lib/components/tiptap/ChoiceOptionNodeView.svelte` - New component
- `src/lib/components/tiptap/ChoiceBlock.ts` - Add NodeView to `choiceOption`
- `src/lib/components/tiptap/__tests__/ChoiceBlock.test.ts` - NodeView tests

**Tests**:
1. ✅ Renders radio button indicator (● or ○)
2. ✅ Renders `NodeViewContent` for editable text
3. ✅ Clicking indicator selects option
4. ✅ Clicking text focuses for editing (doesn't select)
5. ✅ Selecting option deselects all siblings
6. ✅ Text editing works without focus loss

**Challenges**:
- **Challenge 3** (HIGH): Distinguish between "click to select" and "click to edit"
- **Challenge 4** (MEDIUM): NodeView only for `choiceOption`, not `choiceBlock`
- **Challenge 5** (MEDIUM): Must traverse siblings to deselect others

**Component Structure**:
```svelte
<NodeViewWrapper as="div" class="choice-option" data-selected={selected}>
  <button class="radio-indicator" onclick={handleSelect}>
    {selected ? '●' : '○'}
  </button>
  <NodeViewContent class="choice-option-text" />
</NodeViewWrapper>
```

### Phase 5: Styling and Polish
**Goal**: Make it look good and handle edge cases

**Files to Modify**:
- `src/lib/components/tiptap/ChoiceOptionNodeView.svelte` - Add styles
- CSS for `choice-block`, `choice-question`, `choice-option`

**Tasks**:
1. ✅ Style question header
2. ✅ Style option cards with hover states
3. ✅ Style selected option differently
4. ✅ Style radio button indicator
5. ✅ Ensure text is clearly editable (cursor, focus ring)
6. ✅ Handle long text (wrapping, overflow)

**Challenges**:
- **Challenge 6** (LOW): CSS updates for nested structure

### Phase 6: Integration Testing
**Goal**: Test in real editor with full workflow

**Tests**:
1. ✅ Create choice block from markdown
2. ✅ Edit question text
3. ✅ Edit option text (no focus loss!)
4. ✅ Select different options
5. ✅ Save and reload (persistence)
6. ✅ Undo/redo works correctly
7. ✅ Copy/paste works
8. ✅ Delete choice block works

**Challenges**:
- **Challenge 7** (MEDIUM): More comprehensive test suite needed

### Estimated Effort

| Phase | Complexity | Estimated Time |
|-------|-----------|----------------|
| Phase 1: Schema | Low | 1-2 hours |
| Phase 2: Parser | High | 3-4 hours |
| Phase 3: Serializer | Medium | 2-3 hours |
| Phase 4: NodeView | High | 4-6 hours |
| Phase 5: Styling | Low | 1-2 hours |
| Phase 6: Integration | Medium | 2-3 hours |
| **Total** | | **13-20 hours** |

**Note**: V1 took ~8 hours but has fundamental focus loss issue. V2 will take longer but will work correctly.

## Success Criteria (V2)

The extension is complete when:
1. ✅ It correctly parses choice block markdown into nested ProseMirror nodes
2. ✅ It renders an interactive UI with radio buttons and editable text
3. ✅ Users can select options by clicking radio buttons
4. ✅ Users can edit option text inline **without losing focus**
5. ✅ It serializes back to markdown preserving user edits
6. ✅ Round-trip tests pass (markdown → parse → serialize → markdown)
7. ✅ Selection state is properly maintained (mutual exclusion)
8. ✅ It doesn't conflict with existing TaskList extension syntax
9. ✅ Undo/redo works correctly
10. ✅ Copy/paste preserves structure
