<script lang="ts">
  import SizeProvider from '../SizeProvider.svelte';
  import { CopyInput } from '../copy-input';
  import { FileInput } from '../file-input';
  import { Input } from '../input';
  import { Label } from '../label';
  import { Textarea } from '../textarea';
  import InputGroup from './input-group.svelte';
</script>

<SizeProvider size="compact">
  <Label for="compact-input">Compact label</Label>
  <Input id="compact-input" />
  <Textarea aria-label="Compact textarea" />
  <FileInput id="compact-file" label="Choose compact file" />
  <InputGroup><Input aria-label="Compact group" /></InputGroup>
  <CopyInput value="compact" />
</SizeProvider>
