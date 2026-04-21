import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { useStore, ProjectData } from '../store';
import { ProjectType } from '../types';
import {
  getRecentFiles,
  addRecentFile,
  removeRecentFile,
  RecentFile,
} from '../recentFiles';
import { parseImportedJson } from '../importJson';

const openFilters = [
  { name: 'All Supported', extensions: ['perkloom', 'json'] },
  { name: 'Perkloom Project', extensions: ['perkloom'] },
  { name: 'JSON', extensions: ['json'] },
  { name: 'All Files', extensions: ['*'] },
];

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString();
}

export function startNewProject(type: ProjectType) {
  // New projects always open in a fresh tab so multiple docs can coexist.
  useStore.getState().newTab(type);
  const vp = document.querySelector('.canvas-viewport');
  const rect = vp?.getBoundingClientRect();
  if (rect) {
    useStore.setState({
      camera: { x: rect.width / 2, y: rect.height / 3, zoom: 1 },
    });
  }
}

export default function StartScreen() {
  const [recents, setRecents] = useState<RecentFile[]>([]);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    getRecentFiles().then(setRecents);
  }, []);

  const loadFile = async (path: string) => {
    const fileName = path.split(/[\\/]/).pop() ?? path;
    const isJson = path.toLowerCase().endsWith('.json');
    try {
      const text = await readTextFile(path);

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
      console.error('Failed to load file', err);
      removeRecentFile(path);
      setRecents((r) => r.filter((x) => x.path !== path));
      useStore.getState().addToast(`Open failed: ${err}`, 'error');
    }
  };

  const handleOpen = async () => {
    const path = await open({ filters: openFilters, multiple: false });
    if (!path) return;
    await loadFile(path);
  };

  return (
    <div className="start-screen">
      <div className="start-screen-inner">
        <div className="start-left">
          <h1 className="start-title">Perkloom</h1>
          <p className="start-subtitle">Skill tree & flow chart editor</p>
          <div className="start-actions">
            <button
              className="start-btn primary"
              onClick={() => setPicking(true)}
            >
              New Project
            </button>
            <button className="start-btn" onClick={handleOpen}>
              Open File...
            </button>
          </div>
        </div>
        <div className="start-right">
          <div className="start-recent-header">Recent Files</div>
          {recents.length === 0 ? (
            <div className="start-recent-empty">No recent files yet.</div>
          ) : (
            <div className="start-recent-list">
              {recents.map((r) => (
                <div
                  key={r.path}
                  className={`start-recent-item${r.missing ? ' missing' : ''}`}
                  onClick={() => {
                    if (!r.missing) loadFile(r.path);
                  }}
                  title={r.missing ? `File not found: ${r.path}` : r.path}
                >
                  <div className="start-recent-name">{r.name}</div>
                  <div className="start-recent-path">{r.path}</div>
                  <div className="start-recent-date">
                    {r.missing ? 'missing' : formatDate(r.lastOpened)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {picking && (
        <ProjectTypePicker
          onCancel={() => setPicking(false)}
          onPick={(type) => {
            setPicking(false);
            startNewProject(type);
          }}
        />
      )}
    </div>
  );
}

export function ProjectTypePicker({
  onCancel,
  onPick,
}: {
  onCancel: () => void;
  onPick: (type: ProjectType) => void;
}) {
  return (
    <div className="shortcuts-overlay" onMouseDown={onCancel}>
      <div
        className="shortcuts-panel project-type-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-header">
          <span>Yeni Proje</span>
          <button className="shortcuts-close" onClick={onCancel}>×</button>
        </div>
        <div className="project-type-body">
          <p className="project-type-hint">
            Hangi tür proje oluşturmak istiyorsun?
          </p>
          <div className="project-type-grid">
            <button
              className="project-type-card"
              onClick={() => onPick('skilltree')}
            >
              <div className="project-type-card-title">Skill Tree</div>
              <div className="project-type-card-desc">
                Özel veri tipleri, parametreler ve havuzlarla hiyerarşik
                yetenek ağaçları.
              </div>
            </button>
            <button
              className="project-type-card"
              onClick={() => onPick('flowchart')}
            >
              <div className="project-type-card-title">Flow Chart</div>
              <div className="project-type-card-desc">
                Sade node'lar (Title + Description) ve tıklanabilir
                bağlantılar (tip + açıklama).
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
