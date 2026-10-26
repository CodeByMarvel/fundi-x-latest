import type { FileStore } from '../src/storage/files';

/**
 * R2 stand-in for tests. Links are "memory://put/<key>"; `upload` plays
 * the phone sending bytes to one.
 */
export function memoryFiles() {
  const objects = new Map<string, { bytes: number; contentType: string | null }>();
  const store: FileStore = {
    name: 'r2',
    bucket: 'memory',
    uploadUrl: async key => `memory://put/${key}`,
    downloadUrl: async key => `memory://get/${key}`,
    head: async key => objects.get(key) ?? null,
    put: async (key, body, contentType) => {
      objects.set(key, { bytes: typeof body === 'string' ? body.length : body.byteLength, contentType });
    },
    delete: async key => {
      objects.delete(key);
    },
  };
  /** What a phone does with an upload link. */
  const upload = (url: string, bytes: number, contentType: string | null) => {
    objects.set(url.replace('memory://put/', ''), { bytes, contentType });
  };
  return { store, objects, upload };
}
