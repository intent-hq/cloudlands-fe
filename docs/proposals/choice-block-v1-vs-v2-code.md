# Choice Block: V1 vs V2 Code Comparison

## Node Definition

### V1 (Atomic)
```typescript
export const ChoiceBlock = Node.create({
  name: "choiceBlock",
  group: "block",
  atom: true,  // ❌ Cannot have content inside

  addAttributes() {
    return {
      question: { default: "" },
      options: { default: [] }  // ❌ Text in attributes
    };
  },

  addNodeView() {
    return SvelteNodeViewRenderer(ChoiceBlockNodeView);
  }
});
```

### V2 (Non-Atomic)
```typescript
// Three separate nodes instead of one

export const ChoiceBlock = Node.create({
  name: "choiceBlock",
  group: "block",
  content: "choiceQuestion choiceOption+",  // ✅ Has content
  isolating: true
  // No NodeView - default rendering
});

export const ChoiceQuestion = Node.create({
  name: "choiceQuestion",
  content: "paragraph"  // ✅ Editable text
  // No NodeView - default rendering
});

export const ChoiceOption = Node.create({
  name: "choiceOption",
  content: "paragraph",  // ✅ Editable text

  addAttributes() {
    return {
      selected: { default: false }  // ✅ Only boolean in attributes
    };
  },

  addNodeView() {
    return SvelteNodeViewRenderer(ChoiceOptionNodeView);
  }
});
```

## Markdown Parsing

### V1 (Simple)
```typescript
// Returns single div with JSON attributes
return `<div
  data-type="choice-block"
  data-question="${escapeHtml(question)}"
  data-options="${escapeHtml(JSON.stringify(options))}"
></div>`;
```

### V2 (Nested)
```typescript
// Returns nested HTML structure
const questionHtml = `<div data-type="choice-question"><p>${escapeHtml(question)}</p></div>`;

const optionsHtml = options.map(opt => `
  <div data-type="choice-option" data-selected="${opt.selected}">
    <p>${escapeHtml(opt.text)}</p>
  </div>
`).join('\n');

return `<div data-type="choice-block">
  ${questionHtml}
  ${optionsHtml}
</div>`;
```

## Markdown Serialization

### V1 (Simple)
```typescript
// Read from attributes
const question = el.getAttribute("data-question") || "";
const optionsJson = el.getAttribute("data-options") || "[]";
const options = JSON.parse(optionsJson);

const optionLines = options.map(opt =>
  `(${opt.selected ? 'x' : ' '}) ${opt.text}`
).join("\n");

return "```choice\n" + question + "\n" + optionLines + "\n```";
```

### V2 (Traverse DOM)
```typescript
// Traverse nested structure
const questionEl = el.querySelector('[data-type="choice-question"]');
const question = questionEl?.textContent || "";

const optionEls = el.querySelectorAll('[data-type="choice-option"]');
const optionLines = Array.from(optionEls).map(optEl => {
  const selected = optEl.getAttribute('data-selected') === 'true';
  const text = optEl.textContent || "";
  return `(${selected ? 'x' : ' '}) ${text}`;
}).join("\n");

return "```choice\n" + question + "\n" + optionLines + "\n```";
```

## Svelte NodeView

### V1 (Manages Everything)
```svelte
<script>
  // ❌ Text in reactive state from attributes
  let options = $derived(optimistic.get("options") ?? reactiveNode.value.attrs.options);

  // ❌ Input field for editing
  function handleTextBlur(event, optionId) {
    const newText = event.target.value;
    const updatedOptions = options.map(opt => ({
      ...opt,
      text: opt.id === optionId ? newText : opt.text
    }));
    updateNodeAttributes(editor, getPos, reactiveNode.value, { options: updatedOptions });
  }
</script>

<NodeViewWrapper>
  <div class="question">{question}</div>
  {#each options as option}
    <div onclick={() => handleSelect(option.id)}>
      <span>{option.selected ? '●' : '○'}</span>
      <!-- ❌ Input field loses focus on every keystroke -->
      <input value={option.text} onblur={(e) => handleTextBlur(e, option.id)} />
    </div>
  {/each}
</NodeViewWrapper>
```

### V2 (Only Manages Selection)
```svelte
<script>
  // ✅ Only selection state in attributes
  let selected = $derived(reactiveNode.value.attrs.selected);

  // ✅ Text editing handled by TipTap via contentDOM
  function handleSelect() {
    // Find parent and update all siblings
    const parentPos = /* find parent */;
    const parent = editor.state.doc.nodeAt(parentPos);

    const tr = editor.state.tr;
    parent.forEach((child, offset) => {
      if (child.type.name === 'choiceOption') {
        const childPos = parentPos + offset + 1;
        tr.setNodeMarkup(childPos, null, {
          selected: childPos === getPos()
        });
      }
    });
    editor.view.dispatch(tr);
  }
</script>

<!-- ✅ Only used for ONE option, not the whole block -->
<NodeViewWrapper as="div" class="choice-option">
  <button onclick={handleSelect}>
    {selected ? '●' : '○'}
  </button>
  <!-- ✅ TipTap manages editing - no focus loss! -->
  <NodeViewContent class="choice-option-text" />
</NodeViewWrapper>
```

## Key Differences Summary

| Aspect | V1 (Atomic) | V2 (Non-Atomic) |
|--------|-------------|-----------------|
| **Node count** | 1 node | 3 nodes |
| **Text storage** | Attributes | Nested paragraphs |
| **Editing** | Input fields | contentDOM |
| **Focus loss** | ❌ Yes | ✅ No |
| **Parsing** | Simple (flat) | Complex (nested) |
| **Serialization** | Simple (attributes) | Complex (traverse DOM) |
| **NodeView** | Manages everything | Only selection UI |
| **Complexity** | Lower | Higher |
| **UX** | Poor (focus loss) | Good (native editing) |
