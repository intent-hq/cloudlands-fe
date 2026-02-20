declare module 'file-icon' {
  export interface FileIconOptions {
    size?: number;
  }

  export function fileIconToBuffer(
    appNameOrBundleId: string,
    options?: FileIconOptions
  ): Promise<Uint8Array>;

  export function fileIconToFile(
    appNameOrBundleId: string,
    options?: FileIconOptions & { destination: string }
  ): Promise<void>;
}
