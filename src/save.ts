export type SaveResult = 'saved' | 'downloaded';

/**
 * Saves a Blob to disk. Uses the native "Save As" picker (File System Access API) when the
 * browser supports it (desktop Chrome/Edge, some Android Chrome versions); otherwise falls
 * back to a standard browser download (works everywhere, including iOS Safari).
 */
export async function saveVideoBlob(blob: Blob, suggestedName: string, extension: string): Promise<SaveResult> {
  const w = window as unknown as {
    showSaveFilePicker?: (options: unknown) => Promise<{
      createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
    }>;
  };

  const mime = extension === 'mp4' ? 'video/mp4' : 'video/webm';
  const description = extension === 'mp4' ? 'MP4 video' : 'WebM video';

  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: [{ description, accept: { [mime]: [`.${extension}`] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err; // user cancelled the dialog
      // Any other failure (e.g. unsupported in this context): fall back to a plain download.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}
