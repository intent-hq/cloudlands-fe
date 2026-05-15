# Component Integration

## 7. Component Integration

```svelte
<script lang="ts">
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { selectItems, selectIsLoading } from '$lib/store/slices/my-slice/my-slice-selectors';
  import { fetchItems, removeItem } from '$lib/store/slices/my-slice/my-slice-slice';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';

  // ✅ At component init — these use getContext() internally
  const dispatch = getDispatch();
  const items$ = selectItems();
  const isLoading$ = selectIsLoading();

  // ✅ Event handler — use .select() for one-time reads
  function handleDelete(id: string) {
    const currentItems = selectItems.select(getReduxStore().getState());
    if (currentItems.length > 1) {
      dispatch(removeItem(id));
    }
  }
</script>

{#if $isLoading$}
  <Loading />
{:else}
  {#each $items$ as item}
    <ItemRow {item} onDelete={() => handleDelete(item.id)} />
  {/each}
{/if}
```

**Component rules:**

- ✅ `getDispatch()` and `selectFoo()` at top-level script (component init)
- ✅ Use `$selectorResult$` in templates for reactive updates
- ✅ Use `.select(getReduxStore().getState())` in handlers
- ❌ NEVER call `selectFoo()` or `getDispatch()` inside handlers/callbacks/async
- ❌ NEVER create wrapper hooks around dispatch — dispatch actions directly
