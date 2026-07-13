# List Components

A set of reusable list components for creating consistent sidebar lists in the workspace app.

## Components

### ListContainer

A wrapper component that provides consistent spacing between list items.

**Props:**

- `spacing`: "compact" | "normal" | "relaxed" (default: "normal")
- `class`: Additional CSS classes

### ListItem

A flexible list item component with consistent height and spacing.

**Props:**

- `selected`: boolean - Whether the item is selected (e.g., checked in multi-select)
- `active`: boolean - Whether the item is currently active/focused (e.g., open file)
- `variant`: "default" | "ghost" | "subtle" - Visual style variant
- `size`: "sm" | "md" - Size of the item (affects padding, font size, min height)
- `icon`: FontAwesome icon
- `iconComponent`: Custom icon component (e.g., AuggieAvatar)
- `iconProps`: Props to pass to the icon component
- `title`: Main text content
- `subtitle`: Secondary text content
- `badge`: Text or number to show as a badge
- `badgeClass`: Custom classes for the badge
- `loading`: boolean - Shows loading spinner
- `disabled`: boolean - Disables the item
- `onclick`: Click handler

**Size configurations:**

- `sm`: 32px min height, 12px icon, smaller text
- `md`: 40px min height, 14px icon, standard text

### ListSection

A section wrapper with optional title, collapse functionality, and action button.

**Props:**

- `title`: Section title
- `icon`: Icon to show with title
- `actionIcon`: Icon for action button
- `actionLabel`: Tooltip for action button
- `onAction`: Action button click handler
- `collapsible`: boolean - Whether section can be collapsed
- `collapsed`: boolean - Current collapsed state
- `onToggleCollapse`: Collapse toggle handler

### ListEmpty

An empty state component for when there are no items.

**Props:**

- `message`: Text to display (default: "No items")
- `icon`: Optional icon to show

## Usage Examples

### Basic List

```svelte
<ListContainer spacing="compact">
  <ListItem
    icon={faStickyNote}
    title="Note 1"
    onclick={() => console.log('clicked')}
  />
  <ListItem
    icon={faStickyNote}
    title="Note 2"
    selected={true}
  />
  <ListItem
    icon={faStickyNote}
    title="Note 3"
    active={true}  // Currently open/active note
  />
</ListContainer>
```

### With Custom Icon Component

```svelte
<ListItem
  iconComponent={AuggieAvatar}
  iconProps={{ agentId: '123', size: 16 }}
  title="Agent Name"
  subtitle="Last message..."
/>
```

### Collapsible Section

```svelte
<ListSection
  title="Notes"
  icon={faStickyNote}
  actionIcon={faPlus}
  onAction={createNote}
  collapsible={true}
  collapsed={isCollapsed}
  onToggleCollapse={() => (isCollapsed = !isCollapsed)}
>
  <ListContainer>
    <!-- items -->
  </ListContainer>
</ListSection>
```

### Empty State

```svelte
{#if items.length === 0}
  <ListEmpty message="No notes yet" icon={faStickyNote} />
{:else}
  <ListContainer>
    <!-- items -->
  </ListContainer>
{/if}
```

## Migration Guide

To migrate existing sidebar lists to use these components:

1. Replace custom button elements with `ListItem`
2. Wrap lists in `ListContainer` for consistent spacing
3. Use `ListSection` for collapsible sections with titles
4. Use `ListEmpty` for empty states

### Before:

```svelte
<button
  class="flex items-center gap-1.5 w-full px-1.5 py-1 ..."
  onclick={() => onOpenNote(note.id)}
>
  <Fa icon={faStickyNote} size="12" />
  <span>{note.title}</span>
</button>
```

### After:

```svelte
<ListItem icon={faStickyNote} title={note.title} onclick={() => onOpenNote(note.id)} size="sm" />
```

## Benefits

- **Consistent spacing**: All lists have the same item height and spacing
- **Consistent hover/selected states**: Unified visual feedback
- **Flexible**: Supports icons, custom components, subtitles, badges
- **Accessible**: Proper button semantics and keyboard support
- **Maintainable**: Changes to list styling only need to be made in one place
