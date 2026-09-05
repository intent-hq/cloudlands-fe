<script lang="ts">
  import * as Card from './index';

  let activations = $state(0);
</script>

<Card.Root aria-label="Editorial card">
  <Card.Header>
    <Card.Title>A deliberately long editorial card title that wraps cleanly</Card.Title>
  </Card.Header>
  <Card.Content>Card content uses the canonical raised surface and quiet boundary.</Card.Content>
</Card.Root>

<Card.Root
  aria-label="Interactive card"
  interactive
  role="button"
  tabindex={0}
  onclick={() => (activations += 1)}
>
  <Card.Content>Interactive cards lift on hover and collapse on press.</Card.Content>
</Card.Root>

<output aria-label="Card activations">{activations}</output>

<Card.Root aria-label="Inert card" inert>
  <Card.Content>No configuration is available for this intentionally inert surface.</Card.Content>
</Card.Root>
