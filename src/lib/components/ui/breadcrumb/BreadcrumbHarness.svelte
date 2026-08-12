<script lang="ts">
  import * as Breadcrumb from './index';
</script>

<div class="max-w-64" data-testid="breadcrumb-boundary">
  <Breadcrumb.Root aria-label="Project path">
    <Breadcrumb.List>
      <Breadcrumb.Item><Breadcrumb.Link href="/projects">Projects</Breadcrumb.Link></Breadcrumb.Item
      >
      <Breadcrumb.Separator />
      <Breadcrumb.Item><Breadcrumb.Ellipsis data-testid="breadcrumb-ellipsis" /></Breadcrumb.Item>
      <Breadcrumb.Separator />
      <Breadcrumb.Item>
        <Breadcrumb.Link href="/projects/cloudlands">Cloudlands workspace</Breadcrumb.Link>
      </Breadcrumb.Item>
      <Breadcrumb.Separator />
      <Breadcrumb.Item>
        <Breadcrumb.Page>Navigation and help component documentation</Breadcrumb.Page>
      </Breadcrumb.Item>
    </Breadcrumb.List>
  </Breadcrumb.Root>
</div>
