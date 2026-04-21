import { invoke } from '@tauri-apps/api/core';
import { useStore, ProjectData } from './store';
import { parseImportedJson } from './importJson';
import { addRecentFile } from './recentFiles';

export async function loadProjectFilePath(path: string): Promise<void> {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const lower = path.toLowerCase();
  const isJson = lower.endsWith('.json');
  const isPerkloom = lower.endsWith('.perkloom');
  if (!isJson && !isPerkloom) {
    useStore.getState().addToast(
      `Desteklenmeyen dosya türü: ${fileName}`,
      'error',
    );
    return;
  }
  try {
    const text = await invoke<string>('read_project_file', { path });
    if (isJson) {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (err) {
        useStore.getState().addToast(
          `JSON ayrıştırılamadı: ${(err as Error).message}`,
          'error',
        );
        return;
      }
      const result = parseImportedJson(raw);
      if ('error' in result) {
        useStore.getState().addToast(`Import başarısız: ${result.error}`, 'error');
        return;
      }
      useStore.getState().openInNewTab(result.data, null, fileName);
      if (result.suggestedLayout) {
        useStore.getState().autoLayout(result.suggestedLayout);
      }
      useStore.getState().setIsDirty(true);
      const kindLabel = result.kind === 'readable' ? 'readable export' : 'genel JSON';
      if (result.warnings.length > 0) {
        for (const w of result.warnings) console.warn('[import]', w);
        useStore.getState().addToast(
          `Import tamam (${kindLabel}), ${result.warnings.length} uyarı — detay için konsola bakın`,
          'info',
        );
      } else {
        useStore.getState().addToast(`Import tamam (${kindLabel}): ${fileName}`, 'success');
      }
      return;
    }

    const data = JSON.parse(text) as ProjectData;
    useStore.getState().openInNewTab(data, path, fileName);
    addRecentFile(path);
    useStore.getState().addToast(`Opened ${fileName}`, 'success');
  } catch (err) {
    useStore.getState().addToast(`Open failed: ${err}`, 'error');
  }
}
