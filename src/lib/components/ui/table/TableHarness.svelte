<script lang="ts">
  import * as Table from './index';
</script>

<Table.Root aria-label="Workspace usage">
  <Table.Header
    ><Table.Row><Table.Head>Workspace</Table.Head><Table.Head>Tokens</Table.Head></Table.Row
    ></Table.Header
  >
  <Table.Body>
    <Table.Row><Table.Cell>Alpha</Table.Cell><Table.Cell>42</Table.Cell></Table.Row>
    <Table.Row data-state="selected"
      ><Table.Cell>Beta</Table.Cell><Table.Cell>84</Table.Cell></Table.Row
    >
  </Table.Body>
</Table.Root>
