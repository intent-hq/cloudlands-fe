<script lang="ts">
  import * as Card from './index';
</script>

<Card.Root aria-label="Editorial card">
  <Card.Header>
    <Card.Title>A deliberately long editorial card title that wraps cleanly</Card.Title>
    <Card.Description>Supporting metadata stays compact and readable.</Card.Description>
    <Card.Action><a href="#manage-card">Manage</a></Card.Action>
  </Card.Header>
  <Card.Content>Card content uses the canonical raised surface and quiet boundary.</Card.Content>
  <Card.Footer>Updated moments ago</Card.Footer>
</Card.Root>

<Card.Root aria-label="Inert card" inert>
  <Card.Content>No configuration is available for this intentionally inert surface.</Card.Content>
</Card.Root>
