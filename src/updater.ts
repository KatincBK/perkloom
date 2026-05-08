// Auto-update wiring around tauri-plugin-updater. Two entry points:
// - checkSilently(): called on startup; failures are swallowed (offline,
//   server down, etc. shouldn't bother the user). On success, surfaces a
//   toast with version + an action to install.
// - checkInteractive(): called from the menu; always shows feedback,
//   including "you're up to date" and any errors.

import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useStore } from './store';
import { flushNow } from './autosave';

let checking = false;
let pendingUpdate: Update | null = null;

async function runCheck(): Promise<Update | null> {
  if (checking) return null;
  checking = true;
  try {
    const update = await check();
    pendingUpdate = update;
    return update;
  } finally {
    checking = false;
  }
}

async function installAndRelaunch(update: Update): Promise<void> {
  const { addToast } = useStore.getState();
  addToast(`Güncelleme indiriliyor (${update.version})...`, 'info');
  try {
    await update.downloadAndInstall();
    // Persist any in-flight edits before the process restarts.
    try {
      await flushNow();
    } catch {
      // ignore — recovery file will catch unsaved work on next launch
    }
    await relaunch();
  } catch (err) {
    console.error('update install failed', err);
    addToast(`Güncelleme yüklenemedi: ${String(err)}`, 'error');
  }
}

export async function checkSilently(): Promise<void> {
  try {
    const update = await runCheck();
    if (!update) return;
    const { addToast } = useStore.getState();
    addToast(
      `Yeni sürüm mevcut: ${update.version}. Yüklemek için Görünüm → Güncellemeleri Kontrol Et.`,
      'info',
    );
  } catch (err) {
    console.error('silent update check failed', err);
  }
}

export async function checkInteractive(): Promise<void> {
  const { addToast } = useStore.getState();
  try {
    const update = pendingUpdate ?? (await runCheck());
    if (!update) {
      addToast('Zaten en son sürümü kullanıyorsunuz.', 'info');
      return;
    }
    await installAndRelaunch(update);
  } catch (err) {
    console.error('interactive update check failed', err);
    addToast(`Güncelleme kontrolü başarısız: ${String(err)}`, 'error');
  }
}
