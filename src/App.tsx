import { useEffect, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import MenuBar from './components/MenuBar';
import Canvas from './components/Canvas';
import Inspector from './components/Inspector';
import Minimap from './components/Minimap';
import StartScreen from './components/StartScreen';
import Toasts from './components/Toasts';
import TabBar from './components/TabBar';
import ErrorBoundary from './components/ErrorBoundary';
import RecoveryDialog from './components/RecoveryDialog';
import SnapshotPanel from './components/SnapshotPanel';
import { useStore } from './store';
import { loadProjectFilePath } from './loadProjectFile';
import {
  flushNow,
  loadRecovery,
  startAutosave,
  type RecoveryFile,
} from './autosave';
import './App.css';

export default function App() {
  const startScreenOpen = useStore((s) => s.startScreenOpen);
  const snapshotPanelOpen = useStore((s) => s.snapshotPanelOpen);
  const [dragOver, setDragOver] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryFile | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);

  // Check for crash-recovery autosave on first mount, *before* starting the
  // autosave subscription so we don't overwrite the file with empty state.
  useEffect(() => {
    let cancelled = false;
    loadRecovery()
      .then((data) => {
        if (cancelled) return;
        setRecovery(data);
        setRecoveryChecked(true);
      })
      .catch(() => {
        if (!cancelled) setRecoveryChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Start autosave once recovery has been resolved (either applied or
  // dismissed). Also wire a final flush on window close so the latest edits
  // make it to disk if the user crashes/quits between debounce ticks.
  useEffect(() => {
    if (!recoveryChecked || recovery) return;
    startAutosave();
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const win = getCurrentWindow();
    win
      .onCloseRequested(async (event) => {
        // Take ownership of the close: prevent the wrapper's auto-destroy so
        // a hung flush can't trap the window open, then race the flush
        // against a short timeout and destroy ourselves no matter what.
        event.preventDefault();
        await Promise.race([
          flushNow().catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
        try {
          await win.destroy();
        } catch (err) {
          console.error('window destroy failed', err);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) => console.error('onCloseRequested listen failed', err));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [recoveryChecked, recovery]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === 'over') {
          setDragOver(true);
        } else if (p.type === 'leave') {
          setDragOver(false);
        } else if (p.type === 'drop') {
          setDragOver(false);
          const paths = p.paths.filter((path) => {
            const lower = path.toLowerCase();
            return lower.endsWith('.json') || lower.endsWith('.perkloom');
          });
          if (paths.length === 0) {
            if (p.paths.length > 0) {
              useStore
                .getState()
                .addToast('Sadece .json veya .perkloom dosyaları açılabilir', 'error');
            }
            return;
          }
          (async () => {
            for (const path of paths) {
              await loadProjectFilePath(path);
            }
          })();
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) => console.error('drag-drop listen failed', err));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const openPaths = async (paths: string[]) => {
      for (const p of paths) {
        await loadProjectFilePath(p);
      }
    };

    // Drain any files queued before this component mounted (cold start via
    // OS file association: the Rust side stashes argv paths into a state
    // that we pull from here).
    invoke<string[]>('take_pending_files')
      .then((paths) => {
        if (cancelled || !paths || paths.length === 0) return;
        openPaths(paths);
      })
      .catch((err) => console.error('take_pending_files failed', err));

    // Live channel for subsequent opens while the app is already running
    // (single-instance plugin forwards the new argv through this event).
    listen<string[]>('open-files', (event) => {
      const paths = event.payload ?? [];
      if (paths.length > 0) openPaths(paths);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) => console.error('open-files listen failed', err));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <ErrorBoundary>
      <div className={`app${dragOver ? ' drag-over' : ''}`}>
        <MenuBar />
        <TabBar />
        <div className="app-body">
          <div className="canvas-area">
            <ErrorBoundary>
              <Canvas />
            </ErrorBoundary>
            <ErrorBoundary>
              <Minimap />
            </ErrorBoundary>
            <Toasts />
          </div>
          <ErrorBoundary>
            <Inspector />
          </ErrorBoundary>
        </div>
      </div>
      {startScreenOpen && (
        <ErrorBoundary>
          <StartScreen />
        </ErrorBoundary>
      )}
      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-text">Bırak — dosyayı yeni sekmede aç</div>
        </div>
      )}
      {recovery && (
        <ErrorBoundary>
          <RecoveryDialog
            data={recovery}
            onDone={() => setRecovery(null)}
          />
        </ErrorBoundary>
      )}
      {snapshotPanelOpen && (
        <ErrorBoundary>
          <SnapshotPanel />
        </ErrorBoundary>
      )}
    </ErrorBoundary>
  );
}
