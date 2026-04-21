import { exists } from '@tauri-apps/plugin-fs';

export interface RecentFile {
  path: string;
  name: string;
  lastOpened: number;
  missing?: boolean;
}

const KEY = 'perkloom-recent-files';
const MAX_RECENT = 12;

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function read(): RecentFile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((r) => r && typeof r.path === 'string');
  } catch {
    return [];
  }
}

function write(list: RecentFile[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // ignore storage errors
  }
}

export function addRecentFile(path: string): void {
  const list = read().filter((r) => r.path !== path);
  list.unshift({ path, name: baseName(path), lastOpened: Date.now() });
  write(list.slice(0, MAX_RECENT));
}

export function removeRecentFile(path: string): void {
  write(read().filter((r) => r.path !== path));
}

export async function getRecentFiles(): Promise<RecentFile[]> {
  const list = read();
  const checked = await Promise.all(
    list.map(async (r) => {
      try {
        const ok = await exists(r.path);
        return { ...r, missing: !ok };
      } catch {
        return { ...r, missing: true };
      }
    }),
  );
  return checked;
}
