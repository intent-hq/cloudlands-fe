// Functional callers of the production clipboard, file and image controls.
// i18n-ignore (deterministic internal catalog example content)
import { useEffect, useRef, useState } from 'react';
import { Form } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { CopyInput } from '@/components/ui/copy-input';
import { FileInput, type FileInputHandle } from '@/components/ui/file-input';
import { Input } from '@/components/ui/input';
import { PrincipalAvatar } from '@/components/ui/principal-avatar';

const clipboardText = 'Catalog clipboard example';

export function NativeClipboardExample() {
  const [buttonCopies, setButtonCopies] = useState(0);
  const [inputCopies, setInputCopies] = useState(0);
  const [clipboard, setClipboard] = useState('');
  const [readError, setReadError] = useState('');
  return (
    <section
      className="grid gap-4"
      data-functional-example="native-clipboard"
      aria-label="Native clipboard example"
    >
      <h2>Native clipboard</h2>
      <CopyButton
        text={clipboardText}
        label="Copy example text"
        copiedLabel="Example text copied"
        onCopy={() => setButtonCopies((count) => count + 1)}
      />
      <CopyInput
        value={clipboardText}
        label="Example clipboard value"
        variant="button"
        onCopy={() => setInputCopies((count) => count + 1)}
      />
      <Input aria-label="Paste clipboard here" />
      <Button
        variant="outline"
        onClick={async () => {
          setReadError('');
          try {
            setClipboard(await navigator.clipboard.readText());
          } catch (error) {
            setReadError(error instanceof Error ? error.message : String(error));
          }
        }}
      >
        Read clipboard
      </Button>
      <output aria-label="Copy button count">{buttonCopies}</output>
      <output aria-label="Copy input count">{inputCopies}</output>
      <output aria-label="Read clipboard text">{clipboard}</output>
      <output aria-label="Clipboard read error">{readError}</output>
    </section>
  );
}

export function NativeFileExample() {
  const root = useRef<HTMLElement>(null);
  const picker = useRef<FileInputHandle>(null);
  const [files, setFiles] = useState<FileList>();
  const [changes, setChanges] = useState(0);
  const [cancels, setCancels] = useState(0);
  useEffect(() => {
    // Observe real chooser cancellation; no synthetic FileList or cancel events.
    const node = root.current;
    const onCancel = () => setCancels((count) => count + 1);
    node?.addEventListener('cancel', onCancel, true);
    return () => node?.removeEventListener('cancel', onCancel, true);
  }, []);
  return (
    <section
      ref={root}
      className="grid gap-4"
      data-functional-example="native-file"
      aria-label="Native file example"
    >
      <h2>Native file chooser</h2>
      <Form aria-label="Native file form" onSubmit={() => {}}>
        <FileInput
          ref={picker}
          id="catalog-native-files"
          name="exampleFiles"
          label="Choose example files"
          multiple
          files={files}
          onFilesChange={(next) => {
            setFiles(next);
            setChanges((count) => count + 1);
          }}
        />
        <Button type="reset" variant="outline">
          Reset files
        </Button>
      </Form>
      <Button variant="outline" onClick={() => picker.current?.openPicker()}>
        Open file picker through ref
      </Button>
      <p>
        Choose files through the browser dialog. Cancel or select the same files again to observe
        the native cancel event.
      </p>
      <output aria-label="Selected example files">
        {JSON.stringify(
          Array.from(files ?? [], (file) => ({
            name: file.name,
            size: file.size,
            type: file.type,
          })),
        )}
      </output>
      <output aria-label="File change count">{changes}</output>
      <output aria-label="File cancel count">{cancels}</output>
    </section>
  );
}

// A real image decode failure and a self-contained valid image avoid network timing.
const invalidAvatar = 'data:image/png;base64,aW52YWxpZA==';
const validAvatar = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><text x="3" y="19">A</text></svg>')}`;

export function NativeAvatarExample() {
  const [url, setUrl] = useState<string | null>(invalidAvatar);
  return (
    <section
      className="grid gap-4"
      data-functional-example="native-avatar"
      aria-label="Avatar recovery example"
    >
      <h2>Avatar image recovery</h2>
      <PrincipalAvatar avatarUrl={url} label="Ada" testid="recovery-avatar" />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setUrl(validAvatar)}>Restore avatar image</Button>
        <Button variant="outline" onClick={() => setUrl(invalidAvatar)}>
          Break avatar image
        </Button>
        <Button variant="outline" onClick={() => setUrl(null)}>
          Clear avatar image
        </Button>
      </div>
      <output aria-label="Avatar source">
        {url === invalidAvatar ? 'invalid' : url === validAvatar ? 'valid' : 'none'}
      </output>
    </section>
  );
}
