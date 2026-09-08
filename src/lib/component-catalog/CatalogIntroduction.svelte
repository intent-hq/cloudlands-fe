<script lang="ts">
  import { catalogEntries } from './catalog';
  import { catalogShowcaseEntries, catalogSystemEntries } from './catalog-navigation';
</script>

<article class="introduction" data-testid="catalog-introduction">
  <header>
    <p class="eyebrow">Showcase</p>
    <h1>Intent design system</h1>
    <p>
      Components, patterns, and interaction rules for building focused interfaces with a shared
      visual language.
    </p>
  </header>

  <section>
    <h2>Start exploring</h2>
    <div class="link-grid">
      {#each catalogSystemEntries as entry (entry.slug)}
        <a href={entry.href}
          ><strong>{entry.name}</strong><span>System guidance and live specimens.</span></a
        >
      {/each}
    </div>
  </section>

  <section>
    <h2>Showcase</h2>
    <div class="link-list">
      {#each catalogShowcaseEntries.slice(1) as entry (entry.slug)}
        <a href={entry.href}>{entry.name}<span aria-hidden="true">→</span></a>
      {/each}
    </div>
  </section>

  <section>
    <h2>{catalogEntries.length} components</h2>
    <div class="component-cloud">
      {#each catalogEntries as entry (entry.slug)}
        <a href={`/sandbox/${entry.slug}`}>{entry.name}</a>
      {/each}
    </div>
  </section>
</article>

<style>
  .introduction {
    display: grid;
    width: 100%;
    min-width: 0;
    gap: 3.5rem;
    padding: 7rem 1.5rem;
  }

  header > p:last-child {
    max-width: 34rem;
  }

  .eyebrow {
    margin-bottom: 0.75rem;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
  }

  h1 {
    font-size: 2.25rem;
    font-weight: 400;
    letter-spacing: -0.04em;
  }

  header > p:last-child {
    margin-top: 0.75rem;
    color: hsl(var(--muted-foreground));
    line-height: 1.65;
  }

  h2 {
    margin-bottom: 1rem;
    font-size: 1rem;
    font-weight: 500;
  }

  .link-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .link-grid a {
    display: grid;
    gap: 0.375rem;
    padding: 1rem;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    transition: background-color var(--spring-fast) var(--spring-fast-ease);
  }

  .link-grid a:hover {
    background: var(--hover);
  }

  .link-grid span {
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
  }

  .link-list,
  .component-cloud {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .link-list a,
  .component-cloud a {
    border-radius: var(--radius-small);
    background: hsl(var(--muted));
    padding: 0.375rem 0.625rem;
    font-size: var(--text-caption-size);
  }

  .link-list a {
    display: flex;
    justify-content: space-between;
    min-width: 9rem;
  }

  @media (max-width: 560px) {
    .link-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
