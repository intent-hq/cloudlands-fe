<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { getHeadingsFromEditor, scrollToHeading, type Heading } from '$lib/utils/tiptap';
  import { onDestroy } from 'svelte';

  interface Props {
    editor: Editor;
  }

  let { editor }: Props = $props();

  let headings = $derived(getHeadingsFromEditor(editor));
  let activeHeadingId = $state<string | null>(null);
  let observer: IntersectionObserver | null = null;

  // Click handler to scroll to heading
  function handleHeadingClick(heading: Heading) {
    scrollToHeading(editor, heading);
    // Don't set activeHeadingId here - let the observer handle it
  }

  // Set up intersection observer to track visible headings
  function setupScrollTracking() {
    if (!editor || !editor.view) return;

    // Clean up existing observer
    if (observer) {
      observer.disconnect();
    }

    // Find the scrollable container
    const editorElement = editor.view.dom;
    const findScrollableParent = (element: Element): Element | null => {
      let parent = element.parentElement;
      while (parent) {
        const style = window.getComputedStyle(parent);
        const overflow = style.overflow + style.overflowY;
        if (overflow.includes('auto') || overflow.includes('scroll')) {
          return parent;
        }
        parent = parent.parentElement;
      }
      return null;
    };

    const scrollableContainer = findScrollableParent(editorElement);
    const rootElement = scrollableContainer || null;

    // Create intersection observer
    observer = new IntersectionObserver(
      (entries) => {
        // Find the most visible heading
        let mostVisibleEntry: IntersectionObserverEntry | undefined = undefined;
        let maxRatio = 0;

        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio;
            mostVisibleEntry = entry;
          }
        }

        // If we have a visible heading, update the active ID
        if (mostVisibleEntry) {
          const headingElement = mostVisibleEntry.target as HTMLElement;

          // Find the heading in our list
          const matchingHeading = headings.find((h) => {
            // Match by ID if available, otherwise by text content
            if (headingElement.id) {
              return h.id === headingElement.id;
            }
            return h.text === headingElement.textContent?.trim();
          });

          if (matchingHeading) {
            activeHeadingId = matchingHeading.id;
          }
        } else {
          // If no headings are visible, find the closest one above the viewport
          const visibleHeadings = entries
            .filter((entry) => entry.boundingClientRect.top < 100)
            .sort((a, b) => b.boundingClientRect.top - a.boundingClientRect.top);

          if (visibleHeadings.length > 0) {
            const headingElement = visibleHeadings[0].target as HTMLElement;
            const matchingHeading = headings.find((h) => {
              if (headingElement.id) {
                return h.id === headingElement.id;
              }
              return h.text === headingElement.textContent?.trim();
            });

            if (matchingHeading) {
              activeHeadingId = matchingHeading.id;
            }
          }
        }
      },
      {
        root: rootElement,
        rootMargin: '-10% 0px -70% 0px', // Adjust to consider headings near the top as active
        threshold: [0, 0.25, 0.5, 0.75, 1.0],
      },
    );

    // Observe all heading elements in the editor
    const headingElements = editorElement.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headingElements.forEach((heading) => {
      observer!.observe(heading);
    });
  }

  // Set up observer when component mounts and editor changes
  $effect(() => {
    if (editor && headings.length > 0) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        setupScrollTracking();
      }, 100);
    }

    return () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    };
  });

  onDestroy(() => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  });
</script>

<!-- Table of Contents Container -->
{#if headings.length > 0}
  <nav
    class="toc-container top-7 sticky h-0 w-0 left-0 z-50 flex group/toc overflow-visible"
    aria-label="Table of Contents"
  >
    <!-- Tick Marks -->
    <div class="flex flex-col gap-1.5 p-2 h-fit">
      {#each headings as heading (heading.id)}
        <button
          type="button"
          class="w-1 h-0.5 rounded-full cursor-pointer hover:w-4 {heading.level === 1 &&
          heading.id !== activeHeadingId
            ? 'w-2 opacity-40 bg-foreground'
            : ''} {heading.level === 2 && heading.id !== activeHeadingId
            ? 'opacity-20 bg-foreground'
            : 'opacity-10 bg-foreground'} {heading.id === activeHeadingId
            ? 'bg-primary opacity-60 w-2'
            : ''}"
          onclick={() => handleHeadingClick(heading)}
          title={heading.text}
          aria-label={`Jump to ${heading.text}`}
        ></button>
      {/each}
    </div>

    <!-- Expanded Panel -->
    <div
      class="absolute -top-2 left-0 bg-background/95 backdrop-blur-sm shadow-sm min-w-[100px] max-w-[250px] max-h-[80vh] overflow-y-auto opacity-0 group-hover/toc:opacity-100 pointer-events-none group-hover/toc:pointer-events-auto transform -translate-x-2 group-hover/toc:translate-x-0 transition-all duration-200"
      role="region"
      aria-label="Table of Contents Panel"
    >
      <div class="p-2">
        <!-- <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Table of Contents
          </h3> -->
        <nav class="space-y-px">
          {#each headings as heading (heading.id)}
            <button
              type="button"
              class="toc-item w-full text-left hover:text-foreground cursor-pointer p-0 text-xs truncate block px-2 py-0.5 {heading.level ===
              1
                ? 'font-medium'
                : ''} {heading.level === 1 && heading.id === activeHeadingId
                ? ''
                : heading.level === 1
                  ? ''
                  : heading.level === 2 && heading.id === activeHeadingId
                    ? ''
                    : 'text-muted-foreground'} {heading.id === activeHeadingId
                ? 'bg-primary/10'
                : ''} {heading.level === 2 ? 'pl-6' : ''}"
              onclick={() => handleHeadingClick(heading)}
            >
              {heading.text}
            </button>
          {/each}
        </nav>
      </div>
    </div>
  </nav>
{/if}
