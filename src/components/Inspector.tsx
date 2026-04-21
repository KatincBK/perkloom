import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useStore } from '../store';
import { EdgeData, FieldDefinition, FieldType, SkillNode, PoolEntry, edgeId } from '../types';

// Apply persisted global width synchronously at import so the first render
// uses the user's last-used width before the store / any loaded project
// overrides it.
if (typeof document !== 'undefined') {
  try {
    const raw = localStorage.getItem('perkloom-inspector-width');
    const n = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(n)) {
      const clamped = Math.min(720, Math.max(240, n));
      document.documentElement.style.setProperty(
        '--inspector-width',
        `${clamped}px`,
      );
    }
  } catch {
    // ignore storage errors
  }
}

function InspectorResizeHandle() {
  const dragging = useRef(false);
  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      useStore.getState().setInspectorWidth(window.innerWidth - ev.clientX);
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const onDoubleClick = () => {
    useStore.getState().setInspectorWidth(280);
  };
  return (
    <div
      className="inspector-resize-handle"
      onMouseDown={onDown}
      onDoubleClick={onDoubleClick}
      title="Sürükle: genişlet/daralt — Çift tıkla: sıfırla"
    />
  );
}

function AutoGrowTextarea({
  minRows = 2,
  maxPx = 480,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  minRows?: number;
  maxPx?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, maxPx);
    el.style.height = `${next}px`;
  }, [rest.value, maxPx]);
  return <textarea ref={ref} rows={minRows} {...rest} />;
}

// ============================================================
//  PRESET COLORS (36)
// ============================================================

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#fb7185',
  '#fca5a5', '#fdba74', '#fcd34d', '#fde047', '#bef264', '#86efac',
  '#6ee7b7', '#5eead4', '#67e8f9', '#7dd3fc', '#93c5fd', '#a5b4fc',
  '#c4b5fd', '#d8b4fe', '#f0abfc', '#f9a8d4', '#737373', '#ffffff',
];

// ============================================================
//  COLOR PICKER
// ============================================================

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="color-picker-container" ref={ref}>
      <button
        className="color-swatch"
        style={{ background: value }}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className="color-palette">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              className={`color-palette-item${c === value ? ' active' : ''}`}
              style={{ background: c }}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
//  DROPDOWN EDITOR
// ============================================================

function DropdownEditor({
  field,
  node,
  dataTypeId,
}: {
  field: FieldDefinition;
  node: SkillNode;
  dataTypeId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editingOpt, setEditingOpt] = useState<string | null>(null);
  const [optValue, setOptValue] = useState('');

  return (
    <div>
      <div className="dropdown-value-row">
        <select
          className="inspector-select"
          value={(node.fieldValues[field.id] as string) ?? ''}
          onChange={(e) =>
            useStore
              .getState()
              .setFieldValue(node.id, field.id, e.target.value)
          }
        >
          <option value="">-- Sec --</option>
          {field.dropdownOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          className="icon-btn icon-btn-sm"
          title="Edit options"
          onClick={() => setEditing(!editing)}
        >
          &#9998;
        </button>
      </div>

      {editing && (
        <div className="dropdown-options">
          <div className="dropdown-options-label">Secenekler</div>
          {field.dropdownOptions.map((opt) => (
            <div key={opt.id} className="dropdown-option-row">
              {editingOpt === opt.id ? (
                <input
                  className="field-name-input"
                  value={optValue}
                  onChange={(e) => setOptValue(e.target.value)}
                  onBlur={() => {
                    if (optValue.trim())
                      useStore
                        .getState()
                        .renameDropdownOption(
                          dataTypeId,
                          field.id,
                          opt.id,
                          optValue.trim(),
                        );
                    setEditingOpt(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setEditingOpt(null);
                  }}
                  autoFocus
                />
              ) : (
                <span
                  className="dropdown-option-label"
                  onDoubleClick={() => {
                    setOptValue(opt.label);
                    setEditingOpt(opt.id);
                  }}
                >
                  {opt.label}
                </span>
              )}
              <button
                className="icon-btn icon-btn-sm"
                onClick={() =>
                  useStore
                    .getState()
                    .deleteDropdownOption(dataTypeId, field.id, opt.id)
                }
              >
                x
              </button>
            </div>
          ))}
          <button
            className="add-option-btn"
            onClick={() =>
              useStore.getState().addDropdownOption(dataTypeId, field.id)
            }
          >
            + Secenek Ekle
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
//  POOL FIELD EDITOR
// ============================================================

function PoolFieldEditor({
  field,
  node,
  dataTypeId,
}: {
  field: FieldDefinition;
  node: SkillNode;
  dataTypeId: string;
}) {
  const poolTypes = useStore((s) => s.poolTypes);
  const [editingPool, setEditingPool] = useState(false);
  const [editingPtName, setEditingPtName] = useState(false);
  const [ptNameValue, setPtNameValue] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemNameValue, setItemNameValue] = useState('');

  const pt = field.poolTypeId ? poolTypes[field.poolTypeId] : null;
  const ptList = Object.values(poolTypes);
  const entries =
    (node.fieldValues[field.id] as PoolEntry[] | undefined) ?? [];

  return (
    <div>
      {/* Pool Type Selector */}
      <div className="field-sub-label">Pool Type</div>
      <div className="pool-type-row">
        {editingPtName ? (
          <>
            <input
              className="inspector-input"
              value={ptNameValue}
              onChange={(e) => setPtNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (ptNameValue.trim() && field.poolTypeId)
                    useStore
                      .getState()
                      .renamePoolType(field.poolTypeId, ptNameValue.trim());
                  setEditingPtName(false);
                }
                if (e.key === 'Escape') setEditingPtName(false);
              }}
              autoFocus
            />
            <button
              className="icon-btn icon-btn-sm icon-btn-confirm"
              title="Confirm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (ptNameValue.trim() && field.poolTypeId)
                  useStore
                    .getState()
                    .renamePoolType(field.poolTypeId, ptNameValue.trim());
                setEditingPtName(false);
              }}
            >
              &#10003;
            </button>
          </>
        ) : (
          <>
            <select
              className="inspector-select"
              value={field.poolTypeId ?? ''}
              onChange={(e) =>
                useStore
                  .getState()
                  .setFieldPoolType(dataTypeId, field.id, e.target.value)
              }
            >
              {!field.poolTypeId && <option value="">-- Sec --</option>}
              {ptList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {pt && (
              <button
                className="icon-btn icon-btn-sm"
                title="Edit pool type name"
                onClick={() => {
                  setPtNameValue(pt.name);
                  setEditingPtName(true);
                }}
              >
                &#9998;
              </button>
            )}
          </>
        )}
      </div>
      <button
        className="add-option-btn"
        onClick={() => {
          const id = useStore.getState().addPoolType();
          useStore.getState().setFieldPoolType(dataTypeId, field.id, id);
        }}
      >
        + Pool Type Ekle
      </button>

      {/* Pool Items Editor */}
      {pt && (
        <>
          <button
            className="pool-items-toggle"
            onClick={() => setEditingPool(!editingPool)}
          >
            {editingPool ? '\u25BC' : '\u25B6'} Pool Items ({pt.items.length})
          </button>

          {editingPool && (
            <div className="pool-items-editor">
              {pt.items.map((item) => (
                <div key={item.id} className="pool-item-row">
                  <ColorPicker
                    value={item.color}
                    onChange={(c) =>
                      useStore
                        .getState()
                        .setPoolItemColor(field.poolTypeId!, item.id, c)
                    }
                  />
                  {editingItemId === item.id ? (
                    <input
                      className="field-name-input pool-item-name-input"
                      value={itemNameValue}
                      onChange={(e) => setItemNameValue(e.target.value)}
                      onBlur={() => {
                        if (itemNameValue.trim())
                          useStore
                            .getState()
                            .renamePoolItem(
                              field.poolTypeId!,
                              item.id,
                              itemNameValue.trim(),
                            );
                        setEditingItemId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') setEditingItemId(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <span
                      className="pool-item-name"
                      onDoubleClick={() => {
                        setItemNameValue(item.name);
                        setEditingItemId(item.id);
                      }}
                    >
                      {item.name}
                    </span>
                  )}
                  <button
                    className="icon-btn icon-btn-sm"
                    onClick={() =>
                      useStore
                        .getState()
                        .deletePoolItem(field.poolTypeId!, item.id)
                    }
                  >
                    x
                  </button>
                </div>
              ))}
              <button
                className="add-option-btn"
                onClick={() =>
                  useStore.getState().addPoolItem(field.poolTypeId!)
                }
              >
                + Item Ekle
              </button>
            </div>
          )}

          {/* Entries */}
          <div className="pool-entries">
            <div className="field-sub-label" style={{ marginTop: 8 }}>
              Entries
            </div>
            {entries.map((entry, i) => (
              <div key={i} className="pool-entry-row">
                <input
                  className="pool-entry-count"
                  type="number"
                  min={0}
                  value={entry.count}
                  onChange={(e) =>
                    useStore
                      .getState()
                      .setPoolEntryCount(
                        node.id,
                        field.id,
                        i,
                        parseInt(e.target.value) || 0,
                      )
                  }
                />
                <span className="pool-entry-x">x</span>
                <select
                  className="inspector-select pool-entry-select"
                  value={entry.itemId}
                  onChange={(e) =>
                    useStore
                      .getState()
                      .setPoolEntryItem(
                        node.id,
                        field.id,
                        i,
                        e.target.value,
                      )
                  }
                >
                  <option value="">--</option>
                  {pt.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-btn icon-btn-sm"
                  onClick={() =>
                    useStore
                      .getState()
                      .removePoolEntry(node.id, field.id, i)
                  }
                >
                  x
                </button>
              </div>
            ))}
            {pt.items.length > 0 && (
              <button
                className="add-option-btn"
                onClick={() =>
                  useStore
                    .getState()
                    .addPoolEntry(node.id, field.id, pt.items[0].id)
                }
              >
                + Ekle
              </button>
            )}
          </div>
        </>
      )}

      {/* Show on map */}
      <label className="show-on-map-toggle">
        <input
          type="checkbox"
          checked={field.showOnMap}
          onChange={(e) =>
            useStore
              .getState()
              .setFieldShowOnMap(dataTypeId, field.id, e.target.checked)
          }
        />
        <span>Show on map</span>
      </label>
    </div>
  );
}

// ============================================================
//  FIELD EDITOR
// ============================================================

function FieldEditor({
  field,
  node,
  dataTypeId,
  locked = false,
}: {
  field: FieldDefinition;
  node: SkillNode;
  dataTypeId: string;
  locked?: boolean;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(field.name);
  const value = node.fieldValues[field.id];

  return (
    <div className="inspector-field field-editor">
      <div className="field-header">
        {editingName && !locked ? (
          <input
            className="field-name-input"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={() => {
              if (nameValue.trim())
                useStore
                  .getState()
                  .renameField(dataTypeId, field.id, nameValue.trim());
              setEditingName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setEditingName(false);
            }}
            autoFocus
          />
        ) : (
          <label
            className={`inspector-label${locked ? '' : ' field-label-editable'}`}
            onDoubleClick={() => {
              if (locked) return;
              setNameValue(field.name);
              setEditingName(true);
            }}
          >
            {field.name}
          </label>
        )}
        {!locked && (
          <button
            className="icon-btn icon-btn-sm"
            title="Delete field"
            onClick={() =>
              useStore.getState().deleteField(dataTypeId, field.id)
            }
          >
            x
          </button>
        )}
      </div>

      {field.type === 'text' && (
        <>
          <AutoGrowTextarea
            className="inspector-textarea"
            value={(value as string) ?? ''}
            onChange={(e) =>
              useStore
                .getState()
                .setFieldValue(node.id, field.id, e.target.value)
            }
            minRows={3}
          />
          <label className="show-on-map-toggle">
            <input
              type="checkbox"
              checked={field.showOnMap}
              onChange={(e) =>
                useStore
                  .getState()
                  .setFieldShowOnMap(dataTypeId, field.id, e.target.checked)
              }
            />
            <span>Show on map</span>
          </label>
        </>
      )}

      {field.type === 'dropdown' && (
        <DropdownEditor
          field={field}
          node={node}
          dataTypeId={dataTypeId}
        />
      )}

      {field.type === 'number' && (
        <input
          className="inspector-input"
          type="number"
          value={(value as number) ?? 0}
          onChange={(e) =>
            useStore
              .getState()
              .setFieldValue(
                node.id,
                field.id,
                parseFloat(e.target.value) || 0,
              )
          }
        />
      )}

      {field.type === 'boolean' && (
        <label className="boolean-toggle">
          <input
            type="checkbox"
            checked={(value as boolean) ?? false}
            onChange={(e) =>
              useStore
                .getState()
                .setFieldValue(node.id, field.id, e.target.checked)
            }
          />
          <span>{value ? 'True' : 'False'}</span>
        </label>
      )}

      {field.type === 'pool' && (
        <PoolFieldEditor
          field={field}
          node={node}
          dataTypeId={dataTypeId}
        />
      )}
    </div>
  );
}

// ============================================================
//  EDGE INSPECTOR
// ============================================================

function EdgeInspector({
  edge,
  fromTitle,
  toTitle,
  bidirectional,
  isFlowchart,
}: {
  edge: EdgeData;
  fromTitle: string;
  toTitle: string;
  bidirectional: boolean;
  isFlowchart: boolean;
}) {
  return (
    <div className="inspector">
      <InspectorResizeHandle />
      <div className="inspector-header">Connection</div>
      <div className="inspector-content">
        <div className="inspector-info">
          <div className="info-row">
            <span className="info-label">From</span>
            <span className="info-value">{fromTitle}</span>
          </div>
          <div className="info-row">
            <span className="info-label">To</span>
            <span className="info-value">{toTitle}</span>
          </div>
        </div>

        <div className="inspector-field">
          <label className="inspector-label">İsim</label>
          <input
            className="inspector-input"
            value={edge.name}
            placeholder="ör. depends-on, triggers, blocks..."
            onChange={(e) =>
              useStore.getState().setEdgeName(edge.id, e.target.value)
            }
          />
        </div>

        <div className="inspector-field">
          <label className="inspector-label">Açıklama</label>
          <AutoGrowTextarea
            className="inspector-textarea"
            minRows={4}
            value={edge.description}
            placeholder="Bağlantının ne anlama geldiğini açıklayın..."
            onChange={(e) =>
              useStore.getState().setEdgeDescription(edge.id, e.target.value)
            }
          />
        </div>

        {isFlowchart && (
          <div className="inspector-field">
            <label className="inspector-label">Yön</label>
            <div className="edge-direction-row">
              <label className="radio-option">
                <input
                  type="radio"
                  name="edge-direction"
                  checked={!bidirectional}
                  onChange={() =>
                    useStore.getState().setEdgeBidirectional(edge.id, false)
                  }
                />
                <span>Tek yönlü</span>
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  name="edge-direction"
                  checked={bidirectional}
                  onChange={() =>
                    useStore.getState().setEdgeBidirectional(edge.id, true)
                  }
                />
                <span>Karşılıklı</span>
              </label>
            </div>
          </div>
        )}

        <div className="inspector-field">
          <button
            className="add-field-btn"
            onClick={() => {
              useStore.getState().removeEdge(edge.id);
              useStore.getState().selectEdge(null);
            }}
          >
            Bağlantıyı Kaldır
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  INSPECTOR
// ============================================================

export default function Inspector() {
  const selectedNodeIds = useStore((s) => s.selectedNodeIds);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const edges = useStore((s) => s.edges);
  const nodes = useStore((s) => s.nodes);
  const dataTypes = useStore((s) => s.dataTypes);
  const projectType = useStore((s) => s.projectType);
  const isFlowchart = projectType === 'flowchart';

  const selectedNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
  const node = selectedNodeId ? nodes[selectedNodeId] : null;
  const selectedEdge = selectedEdgeId ? edges[selectedEdgeId] : null;

  const [editingDtName, setEditingDtName] = useState(false);
  const [dtNameValue, setDtNameValue] = useState('');
  const [showFieldMenu, setShowFieldMenu] = useState(false);
  const [showTypeManager, setShowTypeManager] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{
    id: string;
    count: number;
  } | null>(null);
  const [convertTarget, setConvertTarget] = useState<string>('');

  useEffect(() => {
    setEditingDtName(false);
    setShowFieldMenu(false);
  }, [selectedNodeId]);

  useEffect(() => {
    if (!showFieldMenu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.add-field-container'))
        setShowFieldMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showFieldMenu]);

  if (selectedEdge) {
    const reverseId = edgeId(selectedEdge.toId, selectedEdge.fromId);
    const bidirectional = !!edges[reverseId];
    return (
      <EdgeInspector
        edge={selectedEdge}
        fromTitle={nodes[selectedEdge.fromId]?.title ?? 'Unknown'}
        toTitle={nodes[selectedEdge.toId]?.title ?? 'Unknown'}
        bidirectional={bidirectional}
        isFlowchart={isFlowchart}
      />
    );
  }

  if (!node) {
    return (
      <div className="inspector">
        <InspectorResizeHandle />
        <div className="inspector-header">Inspector</div>
        <div className="inspector-empty">
          <p>No node selected</p>
          <p className="hint">
            Double-click on the canvas to create a node.
          </p>
          <p className="hint">
            Drag from the circle below a node to connect it.
          </p>
        </div>
      </div>
    );
  }

  const dt = dataTypes[node.dataTypeId];
  const dtList = Object.values(dataTypes);
  const parentTitle = node.parentId
    ? nodes[node.parentId]?.title ?? 'Unknown'
    : null;
  const childrenCount = Object.values(nodes).filter(
    (n) => n.parentId === node.id,
  ).length;

  return (
    <div className="inspector">
      <InspectorResizeHandle />
      <div className="inspector-header">Inspector</div>
      <div className="inspector-content">
        {/* Data Type Selector — flowchart locks this to a single fixed type */}
        {!isFlowchart && (
        <div className="inspector-field">
          <label className="inspector-label">Veri Tipi</label>
          <div className="data-type-row">
            {editingDtName ? (
              <>
                <input
                  className="inspector-input"
                  value={dtNameValue}
                  onChange={(e) => setDtNameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (dtNameValue.trim())
                        useStore
                          .getState()
                          .renameDataType(node.dataTypeId, dtNameValue.trim());
                      setEditingDtName(false);
                    }
                    if (e.key === 'Escape') setEditingDtName(false);
                  }}
                  autoFocus
                />
                <button
                  className="icon-btn icon-btn-confirm"
                  title="Confirm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (dtNameValue.trim())
                      useStore
                        .getState()
                        .renameDataType(node.dataTypeId, dtNameValue.trim());
                    setEditingDtName(false);
                  }}
                >
                  &#10003;
                </button>
              </>
            ) : (
              <>
                <ColorPicker
                  value={dt?.color ?? '#ffffff'}
                  onChange={(c) =>
                    useStore.getState().setDataTypeColor(node.dataTypeId, c)
                  }
                />
                <select
                  className="inspector-select"
                  value={node.dataTypeId}
                  onChange={(e) =>
                    useStore
                      .getState()
                      .setNodeDataType(node.id, e.target.value)
                  }
                >
                  {dtList.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-btn"
                  title="Edit name"
                  onClick={() => {
                    setDtNameValue(dt?.name ?? '');
                    setEditingDtName(true);
                  }}
                >
                  &#9998;
                </button>
              </>
            )}
          </div>
          <button
            className="add-data-type-btn"
            onClick={() => {
              const id = useStore.getState().addDataType();
              useStore.getState().setNodeDataType(node.id, id);
            }}
          >
            + Veri Tipi Ekle
          </button>
          <button
            className="manage-types-toggle"
            onClick={() => setShowTypeManager((v) => !v)}
          >
            {showTypeManager ? '\u25BC' : '\u25B6'} Veri Tiplerini Yönet
          </button>
          {showTypeManager && (
            <div className="type-manager-list">
              {dtList.map((t) => {
                const usage = Object.values(nodes).filter(
                  (n) => n.dataTypeId === t.id,
                ).length;
                const isLast = dtList.length <= 1;
                return (
                  <div key={t.id} className="type-manager-row">
                    <span
                      className="type-manager-dot"
                      style={{ background: t.color }}
                    />
                    <span className="type-manager-name">{t.name}</span>
                    <span className="type-manager-count">{usage}</span>
                    <button
                      className="icon-btn icon-btn-sm icon-btn-danger"
                      title={
                        isLast
                          ? 'Son veri tipi silinemez'
                          : usage > 0
                            ? `${usage} node kullanıyor`
                            : 'Sil'
                      }
                      disabled={isLast}
                      onClick={() => {
                        if (isLast) return;
                        if (usage === 0) {
                          useStore.getState().deleteDataType(t.id, null);
                        } else {
                          const firstOther =
                            dtList.find((d) => d.id !== t.id)?.id ?? '';
                          setConvertTarget(firstOther);
                          setDeleteDialog({ id: t.id, count: usage });
                        }
                      }}
                    >
                      &#128465;
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Flowchart per-node color override */}
        {isFlowchart && (
          <div className="inspector-field">
            <label className="inspector-label">Renk</label>
            <div className="data-type-row">
              <ColorPicker
                value={node.color ?? dt?.color ?? '#ffffff'}
                onChange={(c) =>
                  useStore.getState().setNodeColor(node.id, c)
                }
              />
              <span className="info-value" style={{ flex: 1 }}>
                {node.color ? 'Özel renk' : 'Varsayılan'}
              </span>
              {node.color && (
                <button
                  className="icon-btn"
                  title="Varsayılana döndür"
                  onClick={() =>
                    useStore.getState().setNodeColor(node.id, null)
                  }
                >
                  &#8634;
                </button>
              )}
            </div>
          </div>
        )}

        {/* Title */}
        <div className="inspector-field">
          <label className="inspector-label">Title</label>
          <textarea
            className="inspector-textarea inspector-title-textarea"
            value={node.title}
            rows={Math.max(1, node.title.split('\n').length)}
            onChange={(e) =>
              useStore.getState().updateNodeTitle(node.id, e.target.value)
            }
          />
        </div>

        {/* Fields */}
        {dt?.fields.map((field) => (
          <FieldEditor
            key={field.id}
            field={field}
            node={node}
            dataTypeId={node.dataTypeId}
            locked={isFlowchart}
          />
        ))}

        {/* Add Parameter — disabled in flowchart mode (fixed schema) */}
        {!isFlowchart && (
          <div className="inspector-field add-field-container">
            <button
              className="add-field-btn"
              onClick={() => setShowFieldMenu(!showFieldMenu)}
            >
              + Parametre Ekle
            </button>
            {showFieldMenu && (
              <div className="add-field-menu">
                {(
                  [
                    ['text', 'Text'],
                    ['dropdown', 'Dropdown'],
                    ['number', 'Number'],
                    ['boolean', 'Boolean'],
                    ['pool', 'Countable Pool'],
                  ] as [FieldType, string][]
                ).map(([type, label]) => (
                  <button
                    key={type}
                    className="add-field-menu-item"
                    onClick={() => {
                      useStore.getState().addField(node.dataTypeId, type);
                      setShowFieldMenu(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Node Info */}
        <div className="inspector-info">
          <div className="info-row">
            <span className="info-label">Parent</span>
            <span className="info-value">
              {parentTitle ?? 'None (Root)'}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">Children</span>
            <span className="info-value">{childrenCount}</span>
          </div>
        </div>
      </div>

      {deleteDialog && (
        <div className="shortcuts-overlay" onClick={() => setDeleteDialog(null)}>
          <div
            className="shortcuts-panel delete-type-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shortcuts-header">
              <span>Veri Tipini Sil</span>
              <button
                className="shortcuts-close"
                onClick={() => setDeleteDialog(null)}
              >
                ×
              </button>
            </div>
            <div className="delete-type-body">
              <p>
                <strong>{dataTypes[deleteDialog.id]?.name}</strong> tipini{' '}
                <strong>{deleteDialog.count}</strong> node kullanıyor.
              </p>
              <p className="hint">
                Bu node'ları başka bir tipe dönüştürebilir ya da dönüştürmeden
                silebilirsin. Dönüştürürsen alan değerleri sıfırlanır.
              </p>
              <div className="inspector-field">
                <label className="inspector-label">Dönüştürülecek tip</label>
                <select
                  className="inspector-select"
                  value={convertTarget}
                  onChange={(e) => setConvertTarget(e.target.value)}
                >
                  {dtList
                    .filter((d) => d.id !== deleteDialog.id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="delete-type-actions">
                <button
                  className="dialog-btn"
                  onClick={() => setDeleteDialog(null)}
                >
                  İptal
                </button>
                <button
                  className="dialog-btn dialog-btn-danger"
                  onClick={() => {
                    useStore.getState().deleteDataType(deleteDialog.id, null);
                    setDeleteDialog(null);
                  }}
                >
                  Dönüştürmeden Sil
                </button>
                <button
                  className="dialog-btn dialog-btn-primary"
                  onClick={() => {
                    useStore
                      .getState()
                      .deleteDataType(deleteDialog.id, convertTarget);
                    setDeleteDialog(null);
                  }}
                >
                  Dönüştür ve Sil
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
