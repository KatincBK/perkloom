import { useState, useEffect } from 'react';
import { useStore, snapshotDataMap } from '../store';
import { diffSnapshots, type DiffResult, type SnapshotData } from '../snapshotDiff';

function formatTimestamp(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '';
  }
}

function DiffView({ diff }: { diff: DiffResult }) {
  return (
    <div className="snapshot-diff">
      <div className="snapshot-diff-summary">{diff.summary}</div>

      {diff.nodes.added.length > 0 && (
        <div className="diff-section">
          <div className="diff-heading diff-added-heading">+ Added Nodes</div>
          {diff.nodes.added.map((n) => (
            <div key={n.id} className="diff-row diff-added">{n.title}</div>
          ))}
        </div>
      )}

      {diff.nodes.removed.length > 0 && (
        <div className="diff-section">
          <div className="diff-heading diff-removed-heading">− Removed Nodes</div>
          {diff.nodes.removed.map((n) => (
            <div key={n.id} className="diff-row diff-removed">{n.title}</div>
          ))}
        </div>
      )}

      {diff.nodes.changed.length > 0 && (
        <div className="diff-section">
          <div className="diff-heading diff-changed-heading">~ Changed Nodes</div>
          {diff.nodes.changed.map((n) => (
            <div key={n.id} className="diff-row diff-changed">
              <div className="diff-changed-title">{n.title}</div>
              <div className="diff-changed-details">
                {n.changes.map((c, i) => (
                  <span key={i} className="diff-change-tag">{c}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(diff.edges.added > 0 || diff.edges.removed > 0) && (
        <div className="diff-section">
          <div className="diff-heading">Edges</div>
          {diff.edges.added > 0 && <div className="diff-row diff-added">+{diff.edges.added} edge(s)</div>}
          {diff.edges.removed > 0 && <div className="diff-row diff-removed">−{diff.edges.removed} edge(s)</div>}
        </div>
      )}

      {(diff.dataTypes.added.length > 0 || diff.dataTypes.removed.length > 0 || diff.dataTypes.changed.length > 0) && (
        <div className="diff-section">
          <div className="diff-heading">Data Types</div>
          {diff.dataTypes.added.map((n) => <div key={n} className="diff-row diff-added">+ {n}</div>)}
          {diff.dataTypes.removed.map((n) => <div key={n} className="diff-row diff-removed">− {n}</div>)}
          {diff.dataTypes.changed.map((n) => <div key={n} className="diff-row diff-changed">~ {n}</div>)}
        </div>
      )}
    </div>
  );
}

export default function SnapshotPanel() {
  const namedSnapshots = useStore((s) => s.namedSnapshots);
  const saveSnapshot = useStore((s) => s.saveSnapshot);
  const restoreSnapshot = useStore((s) => s.restoreSnapshot);
  const deleteSnapshot = useStore((s) => s.deleteSnapshot);
  const renameSnapshot = useStore((s) => s.renameSnapshot);
  const setOpen = useStore((s) => s.setSnapshotPanelOpen);

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [diffId, setDiffId] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  const handleSave = () => {
    const name = newName.trim() || `Snapshot ${namedSnapshots.length + 1}`;
    saveSnapshot(name);
    setNewName('');
  };

  const handleCompare = (id: string) => {
    if (diffId === id) {
      setDiffId(null);
      setDiffResult(null);
      return;
    }
    const snapData = snapshotDataMap.get(id);
    if (!snapData) return;
    const { nodes, dataTypes, poolTypes, edges, projectType } = useStore.getState();
    const current: SnapshotData = { nodes, dataTypes, poolTypes, edges, projectType };
    setDiffResult(diffSnapshots(snapData, current));
    setDiffId(id);
  };

  const handleRenameSubmit = (id: string) => {
    const trimmed = editingName.trim();
    if (trimmed) renameSnapshot(id, trimmed);
    setEditingId(null);
  };

  const sorted = [...namedSnapshots].reverse();

  return (
    <div className="shortcuts-overlay" onMouseDown={() => setOpen(false)}>
      <div className="snapshot-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="shortcuts-header">
          <span>Snapshots</span>
          <button className="shortcuts-close" onClick={() => setOpen(false)}>×</button>
        </div>

        <div className="snapshot-save-bar">
          <input
            className="snapshot-name-input"
            type="text"
            placeholder={`Snapshot ${namedSnapshots.length + 1}`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
          />
          <button className="dialog-btn dialog-btn-primary" onClick={handleSave}>
            Save
          </button>
        </div>

        <div className="snapshot-list">
          {sorted.length === 0 && (
            <div className="snapshot-empty">No snapshots yet. Save one to track your progress.</div>
          )}
          {sorted.map((snap) => (
            <div key={snap.id} className="snapshot-row">
              <div className="snapshot-row-header">
                <div className="snapshot-row-info">
                  {editingId === snap.id ? (
                    <input
                      className="snapshot-rename-input"
                      value={editingName}
                      autoFocus
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameSubmit(snap.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={() => handleRenameSubmit(snap.id)}
                    />
                  ) : (
                    <div
                      className="snapshot-name"
                      onDoubleClick={() => {
                        setEditingId(snap.id);
                        setEditingName(snap.name);
                      }}
                      title="Double-click to rename"
                    >
                      {snap.name}
                    </div>
                  )}
                  <div className="snapshot-time">{formatTimestamp(snap.createdAt)}</div>
                </div>
                <div className="snapshot-actions">
                  <button
                    className="snapshot-action-btn"
                    title="Compare with current state"
                    onClick={() => handleCompare(snap.id)}
                  >
                    {diffId === snap.id ? '▾ Diff' : '▸ Diff'}
                  </button>
                  <button
                    className="snapshot-action-btn snapshot-restore-btn"
                    title="Restore this snapshot"
                    onClick={() => restoreSnapshot(snap.id)}
                  >
                    Restore
                  </button>
                  {confirmDeleteId === snap.id ? (
                    <>
                      <button
                        className="snapshot-action-btn snapshot-delete-btn"
                        onClick={() => { deleteSnapshot(snap.id); setConfirmDeleteId(null); }}
                      >
                        Confirm
                      </button>
                      <button
                        className="snapshot-action-btn"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="snapshot-action-btn snapshot-delete-btn"
                      title="Delete snapshot"
                      onClick={() => setConfirmDeleteId(snap.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              {diffId === snap.id && diffResult && <DiffView diff={diffResult} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
