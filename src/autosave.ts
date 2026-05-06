// Crash-recovery autosave. Snapshots all open tabs into a single JSON file in
// AppData and removes it on graceful exit. On next launch, App.tsx checks for
// the file and offers recovery via RecoveryDialog.

import {
  writeTextFile,
  readTextFile,
  mkdir,
  remove,
  exists,
  BaseDirectory,
} from '@tauri-apps/plugin-fs';
import { useStore } from './store';
import type { ProjectData } from './store';

const AUTOSAVE_DIR = 'autosave';
const AUTOSAVE_FILE = 'autosave/state.json';
const DEBOUNCE_MS = 2000;
const FORMAT_VERSION = 1;

export interface RecoveryTab {
  tabId: string;
  title: string;
  filePath: string | null;
  isDirty: boolean;
  data: ProjectData;
}

export interface RecoveryFile {
  version: number;
  savedAt: number;
  tabs: RecoveryTab[];
}

let debounceHandle: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let started = false;
let writing = false;

function snapshotAllTabs(): RecoveryTab[] {
  const s = useStore.getState();
  const result: RecoveryTab[] = [];
  for (const tab of s.tabs) {
    if (tab.id === s.activeTabId) {
      result.push({
        tabId: tab.id,
        title: tab.title,
        filePath: s.currentFilePath,
        isDirty: s.isDirty,
        data: {
          nodes: s.nodes,
          dataTypes: s.dataTypes,
          poolTypes: s.poolTypes,
          edges: s.edges,
          projectType: s.projectType,
          inspectorWidth: s.inspectorWidth,
        },
      });
    } else if (tab.snapshot) {
      const snap = tab.snapshot;
      result.push({
        tabId: tab.id,
        title: tab.title,
        filePath: snap.currentFilePath,
        isDirty: snap.isDirty,
        data: {
          nodes: snap.nodes,
          dataTypes: snap.dataTypes,
          poolTypes: snap.poolTypes,
          edges: snap.edges,
          projectType: snap.projectType,
          inspectorWidth: snap.inspectorWidth,
        },
      });
    }
  }
  return result;
}

async function ensureDir(): Promise<void> {
  try {
    await mkdir(AUTOSAVE_DIR, {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    });
  } catch {
    // already exists or non-fatal — write will surface real errors
  }
}

async function flush(): Promise<void> {
  if (writing) return;
  writing = true;
  try {
    const tabs = snapshotAllTabs();
    const anyDirty = tabs.some((t) => t.isDirty);
    if (!anyDirty) {
      // Nothing worth recovering — clear any stale autosave from earlier in
      // this session so we don't show a phantom recovery dialog next launch.
      await clearAutosave();
      return;
    }
    await ensureDir();
    const payload: RecoveryFile = {
      version: FORMAT_VERSION,
      savedAt: Date.now(),
      tabs,
    };
    await writeTextFile(AUTOSAVE_FILE, JSON.stringify(payload), {
      baseDir: BaseDirectory.AppData,
    });
  } catch (err) {
    console.error('autosave flush failed', err);
  } finally {
    writing = false;
  }
}

function scheduleFlush(): void {
  if (debounceHandle) clearTimeout(debounceHandle);
  debounceHandle = setTimeout(() => {
    debounceHandle = null;
    void flush();
  }, DEBOUNCE_MS);
}

export function startAutosave(): void {
  if (started) return;
  started = true;
  // zustand v5 subscribe with selector — fire only when persistable state
  // (the per-tab data) changes. Camera, selection, hover etc. don't matter.
  unsubscribe = useStore.subscribe((s, prev) => {
    if (
      s.nodes !== prev.nodes ||
      s.edges !== prev.edges ||
      s.dataTypes !== prev.dataTypes ||
      s.poolTypes !== prev.poolTypes ||
      s.tabs !== prev.tabs ||
      s.activeTabId !== prev.activeTabId ||
      s.isDirty !== prev.isDirty ||
      s.currentFilePath !== prev.currentFilePath
    ) {
      scheduleFlush();
    }
  });
}

export async function flushNow(): Promise<void> {
  if (debounceHandle) {
    clearTimeout(debounceHandle);
    debounceHandle = null;
  }
  await flush();
}

export function stopAutosave(): void {
  if (debounceHandle) {
    clearTimeout(debounceHandle);
    debounceHandle = null;
  }
  unsubscribe?.();
  unsubscribe = null;
  started = false;
}

export async function clearAutosave(): Promise<void> {
  try {
    const present = await exists(AUTOSAVE_FILE, {
      baseDir: BaseDirectory.AppData,
    });
    if (present) {
      await remove(AUTOSAVE_FILE, { baseDir: BaseDirectory.AppData });
    }
  } catch (err) {
    console.error('clearAutosave failed', err);
  }
}

export async function loadRecovery(): Promise<RecoveryFile | null> {
  try {
    const present = await exists(AUTOSAVE_FILE, {
      baseDir: BaseDirectory.AppData,
    });
    if (!present) return null;
    const raw = await readTextFile(AUTOSAVE_FILE, {
      baseDir: BaseDirectory.AppData,
    });
    const parsed = JSON.parse(raw) as RecoveryFile;
    if (!parsed || !Array.isArray(parsed.tabs)) return null;
    const dirty = parsed.tabs.filter((t) => t && t.isDirty);
    if (dirty.length === 0) return null;
    return { ...parsed, tabs: dirty };
  } catch (err) {
    console.error('loadRecovery failed', err);
    return null;
  }
}
