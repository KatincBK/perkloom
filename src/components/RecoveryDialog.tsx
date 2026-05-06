import { useState } from 'react';
import { useStore } from '../store';
import { clearAutosave, type RecoveryFile, type RecoveryTab } from '../autosave';

interface Props {
  data: RecoveryFile;
  onDone: () => void;
}

function formatTimestamp(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '';
  }
}

function basename(path: string | null): string {
  if (!path) return '';
  const norm = path.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

export default function RecoveryDialog({ data, onDone }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(data.tabs.map((t) => t.tabId)),
  );
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const recover = async () => {
    if (busy) return;
    setBusy(true);
    const store = useStore.getState();
    const picked = data.tabs.filter((t) => selected.has(t.tabId));
    for (const t of picked) {
      const title = t.filePath ? basename(t.filePath) : t.title;
      store.openInNewTab(t.data, t.filePath, title);
      // Recovered tabs should remain marked dirty until the user saves; the
      // file on disk (if any) doesn't reflect these in-memory changes.
      useStore.setState({ isDirty: true });
    }
    if (picked.length > 0) {
      store.addToast(`Recovered ${picked.length} unsaved tab(s)`, 'success');
    }
    await clearAutosave();
    setBusy(false);
    onDone();
  };

  const discard = async () => {
    if (busy) return;
    setBusy(true);
    await clearAutosave();
    setBusy(false);
    onDone();
  };

  return (
    <div className="shortcuts-overlay">
      <div className="recovery-panel">
        <div className="shortcuts-header">
          <span>Recover unsaved work</span>
          <span className="recovery-time">
            from {formatTimestamp(data.savedAt)}
          </span>
        </div>
        <div className="recovery-body">
          <p className="recovery-hint">
            Perkloom kapanırken kaydedilmemiş değişiklikleri buldu. Geri
            yüklemek istediklerini seç:
          </p>
          <div className="recovery-list">
            {data.tabs.map((t: RecoveryTab) => (
              <label key={t.tabId} className="recovery-row">
                <input
                  type="checkbox"
                  checked={selected.has(t.tabId)}
                  onChange={() => toggle(t.tabId)}
                />
                <div className="recovery-row-text">
                  <div className="recovery-title">
                    {t.title || '(untitled)'}
                  </div>
                  <div className="recovery-path">
                    {t.filePath ?? 'unsaved (no file)'}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div className="recovery-actions">
          <button
            className="dialog-btn dialog-btn-danger"
            disabled={busy}
            onClick={discard}
          >
            Discard all
          </button>
          <button
            className="dialog-btn dialog-btn-primary"
            disabled={busy || selected.size === 0}
            onClick={recover}
          >
            Recover selected
          </button>
        </div>
      </div>
    </div>
  );
}
