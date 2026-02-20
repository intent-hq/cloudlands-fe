# Testing Checklist for Panel System Refactoring

## Automated Verification

- ✅ **TypeScript Compilation** - No errors reported by IDE diagnostics
- ✅ **Build Process** - `npm run build` completes successfully
- ✅ **Type Checking** - `npm run check` passes without errors

## Manual Testing Required

### Tab Type Registry

- [ ] **Browser Tab**
  - [ ] Open a browser tab
  - [ ] Navigate to different URLs
  - [ ] Verify URL updates in tab title
  - [ ] Test browser controls (back, forward, refresh)

- [ ] **Terminal Tab**
  - [ ] Open a terminal tab
  - [ ] Run commands
  - [ ] Verify terminal output displays correctly
  - [ ] Test terminal link clicking (should open in browser panel)

- [ ] **Code Review Tab**
  - [ ] Open a code review tab
  - [ ] Verify diff display works
  - [ ] Test file navigation

- [ ] **Agent Overview Tab**
  - [ ] Open agent overview
  - [ ] Verify agent list displays
  - [ ] Test agent selection

- [ ] **Legacy Tab Types** (via LegacyTabTypeWrapper)
  - [ ] Agent tab - Open agent chat, send messages
  - [ ] Note tab - Create/edit notes, test version history
  - [ ] File tab - Open files, edit content, save changes
  - [ ] Diff tab - View file diffs
  - [ ] Changes tab - View workspace changes
  - [ ] Local changes tab
  - [ ] Chat changes tab
  - [ ] Activity tab
  - [ ] Activity changes tab
  - [ ] Settings tab (if implemented)
  - [ ] Overview tab (if implemented)

### Tab Icons and Labels

- [ ] **Icon Display**
  - [ ] Verify correct icon shows for each tab type in tab bar
  - [ ] Verify correct icon shows in panel header breadcrumbs
  - [ ] Test icon display when switching between tabs

- [ ] **Category Labels**
  - [ ] Verify correct category label for each tab type
  - [ ] Test breadcrumb display in panel header

### Sidebar Integration

- [ ] **Reveal in Sidebar**
  - [ ] Right-click on browser tab → "Reveal in Sidebar"
  - [ ] Right-click on terminal tab → "Reveal in Sidebar"
  - [ ] Right-click on code review tab → "Reveal in Sidebar"
  - [ ] Verify correct sidebar tab is selected

### Tab Renaming

- [ ] **Renameable Tabs**
  - [ ] Try renaming browser tab (should work)
  - [ ] Try renaming terminal tab (should work)
  - [ ] Try renaming agent tab (should NOT work)
  - [ ] Try renaming note tab (should NOT work)

### Panel Layout Operations

- [ ] **Tab Management**
  - [ ] Open multiple tabs in a panel
  - [ ] Switch between tabs
  - [ ] Close tabs
  - [ ] Reorder tabs by dragging

- [ ] **Panel Splits**
  - [ ] Split panel horizontally
  - [ ] Split panel vertically
  - [ ] Resize split panels
  - [ ] Close split panels

- [ ] **Focus Management**
  - [ ] Click on different panels
  - [ ] Verify focused panel has correct styling
  - [ ] Test keyboard navigation between panels

### Link Handling (Not Migrated Yet)

The unified link handler has been created but not yet integrated. Current link handling should still work:

- [ ] **Terminal Links**
  - [ ] Click HTTP/HTTPS link in terminal
  - [ ] Verify it opens in browser panel (not external browser)

- [ ] **Editor Links**
  - [ ] Click intent:// link in note editor
  - [ ] Verify it navigates to the linked note
  - [ ] Click HTTP/HTTPS link in note editor
  - [ ] Verify it opens in external browser

- [ ] **Markdown Viewer Links**
  - [ ] Click intent:// link in chat
  - [ ] Verify it navigates to the linked note
  - [ ] Click HTTP/HTTPS link in chat
  - [ ] Verify it opens in external browser

### Header Actions

- [ ] **Agent Tab Actions**
  - [ ] Verify agent-specific actions appear in header
  - [ ] Test specialist name display
  - [ ] Test "Delegated by" subtitle

- [ ] **Note Tab Actions**
  - [ ] Verify note actions appear in header
  - [ ] Test version history toggle
  - [ ] Test note editing

- [ ] **File Tab Actions**
  - [ ] Verify file actions appear in header
  - [ ] Test file save
  - [ ] Test file reload

- [ ] **Browser Tab Actions**
  - [ ] Verify browser actions appear in header
  - [ ] Test "Open in External Browser"

### Persistence

- [ ] **Layout Persistence**
  - [ ] Create a complex layout with multiple panels and tabs
  - [ ] Reload the app
  - [ ] Verify layout is restored correctly
  - [ ] Verify all tabs are restored with correct content

## Known Issues

None reported. All TypeScript compilation passes without errors.

## Future Testing (After Migration)

Once the unified link handler is integrated:
- Test all link types open in correct location
- Test Cmd+Click for "open in new window" (when implemented)
- Test link handling consistency across all components
