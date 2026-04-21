import { useEffect, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { listen } from '@tauri-apps/api/event';
import MenuBar from './components/MenuBar';
import Canvas from './components/Canvas';
import Inspector from './components/Inspector';
import Minimap from './components/Minimap';
import StartScreen from './components/StartScreen';
import Toasts from './components/Toasts';
import TabBar from './components/TabBar';
import ErrorBoundary from './components/ErrorBoundary';
import { useStore } from './store';
import { loadProjectFilePath } from './loadProjectFile';
import './App.css';

export default function App() {
  const startScreenOpen = useStore((s) => s.startScreenOpen);
  const [dragOver, setDragOver] = useState(false);

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
    listen<string[]>('open-files', (event) => {
      const paths = event.payload ?? [];
      (async () => {
        for (const p of paths) {
          await loadProjectFilePath(p);
        }
      })();
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
    </ErrorBoundary>
  );
}
