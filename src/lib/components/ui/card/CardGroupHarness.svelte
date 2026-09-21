<script lang="ts">
  import * as Card from './index';
  import { Button } from '$lib/components/ui/button';
  let columns = $state(2);
</script>

<Button onclick={() => (columns = columns === 2 ? 1 : 2)}>Change layout</Button>
<Card.Group {columns} aria-label="Card collection">
  <Card.Root aria-label="First card"
    ><Card.Header><Card.Title>First</Card.Title></Card.Header><Card.Content
      >Shared work</Card.Content
    ></Card.Root
  >
  <Card.Root aria-label="Second card"
    ><Card.Header><Card.Title>Second</Card.Title></Card.Header><Card.Content>Next step</Card.Content
    ></Card.Root
  >
</Card.Group>
