// Per-file view settings (snap mode, grid snap, angle snap, auto-mode length).
// Persisted in localStorage keyed by the file's absolute path so the last-used
// values are remembered the next time that file is opened. Works for both
// .perkloom and .json files; .perkloom additionally embeds these inside the
// project file (see ProjectData.viewSettings) so they travel with the file.

import type { InteractionMode } from './types';

export interface FileViewSettings {
  mode: InteractionMode;
  gridSnap: boolean;
  angleSnap: number;
  autoTargetLength: number;
}

const PREFIX = 'perkloom-filesettings:';

export function loadFileSettings(path: string): Partial<FileViewSettings> | null {
  try {
    const raw = localStorage.getItem(PREFIX + path);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Partial<FileViewSettings>;
    return null;
  } catch {
    return null;
  }
}

export function saveFileSettings(path: string, settings: FileViewSettings): void {
  try {
    localStorage.setItem(PREFIX + path, JSON.stringify(settings));
  } catch {
    // ignore quota / availability errors
  }
}
