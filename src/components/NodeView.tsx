import React, { useRef, useEffect, useState, useCallback } from 'react';
import { SkillNode, MapLine } from '../types';
import { NODE_WIDTH, DEMO_NODE_SIZE, useStore } from '../store';

type EditTextarea = HTMLTextAreaElement;

function isLightColor(hex: string): boolean {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

function closestOnRoundedRect(
  mx: number, my: number, hw: number, hh: number, r: number,
): { x: number; y: number } {
  const ihw = hw - r;
  const ihh = hh - r;
  const qx = Math.max(-ihw, Math.min(ihw, mx));
  const qy = Math.max(-ihh, Math.min(ihh, my));
  const dx = mx - qx;
  const dy = my - qy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) {
    const dRight = ihw - qx, dLeft = qx + ihw, dBottom = ihh - qy, dTop = qy + ihh;
    const min = Math.min(dRight, dLeft, dBottom, dTop);
    if (min === dRight) return { x: hw, y: qy };
    if (min === dLeft) return { x: -hw, y: qy };
    if (min === dBottom) return { x: qx, y: hh };
    return { x: qx, y: -hh };
  }
  return { x: qx + (dx / dist) * r, y: qy + (dy / dist) * r };
}

function positionHandle(handle: HTMLDivElement, nodeEl: HTMLElement, clientX: number, clientY: number) {
  const rect = nodeEl.getBoundingClientRect();
  const zoom = rect.width / (nodeEl.offsetWidth || 1);
  const mx = (clientX - (rect.left + rect.width / 2)) / zoom;
  const my = (clientY - (rect.top + rect.height / 2)) / zoom;
  const hw = nodeEl.offsetWidth / 2;
  const hh = nodeEl.offsetHeight / 2;
  const pt = closestOnRoundedRect(mx, my, hw, hh, 10);
  handle.style.left = `calc(50% + ${pt.x}px)`;
  handle.style.top = `calc(50% + ${pt.y}px)`;
}

interface Props {
  node: SkillNode;
  isSelected: boolean;
  mapLines: MapLine[];
  color: string;
}

export const NodeView = React.memo(function NodeView({ node, isSelected, mapLines, color }: Props) {
  const isRoot = node.parentId === null;
  const bg = color;
  const light = isLightColor(bg);
  const handleRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<EditTextarea>(null);
  const editValueRef = useRef(node.title);
  const cancelledRef = useRef(false);

  const editingNodeId = useStore((s) => s.editingNodeId);
  const demoMode = useStore((s) => s.demoMode);
  const isSearchMatch = useStore((s) => s.searchMatchIds.includes(node.id));
  const isSearchActive = useStore(
    (s) =>
      s.searchActiveIndex >= 0 &&
      s.searchMatchIds[s.searchActiveIndex] === node.id,
  );
  const isEditing = editingNodeId === node.id && !demoMode;
  const [editValue, setEditValue] = useState(node.title);

  const isCompact = node.displayMode === 'compact';
  const hasImage = !!node.imageData;
  // Icon mode: compact + has image + no title content to show
  const isIconMode = isCompact && hasImage;

  useEffect(() => {
    if (!isEditing) return;
    const ta = editInputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [editValue, isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    cancelledRef.current = false;
    setEditValue(node.title);
    editValueRef.current = node.title;
    requestAnimationFrame(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    });
    return () => {
      if (!cancelledRef.current) {
        const val = editValueRef.current.replace(/\s+$/g, '');
        if (val) useStore.getState().updateNodeTitle(node.id, val);
      }
    };
  }, [isEditing, node.id]);

  const finishEdit = () => useStore.getState().setEditingNodeId(null);
  const cancelEdit = () => { cancelledRef.current = true; useStore.getState().setEditingNodeId(null); };

  useEffect(() => {
    if (!isSelected) return;
    const onMove = (e: MouseEvent) => {
      if (handleRef.current && nodeRef.current)
        positionHandle(handleRef.current, nodeRef.current, e.clientX, e.clientY);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [isSelected]);

  const onLocalMove = (e: React.MouseEvent) => {
    if (isSelected) return;
    if (handleRef.current && nodeRef.current)
      positionHandle(handleRef.current, nodeRef.current, e.clientX, e.clientY);
  };

  // Image drop handler
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      useStore.getState().setNodeImage(node.id, reader.result as string);
    };
    reader.readAsDataURL(file);
  }, [node.id]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const nodeWidth = demoMode ? DEMO_NODE_SIZE : isIconMode ? 64 : NODE_WIDTH;
  const demoStyle = demoMode
    ? { height: DEMO_NODE_SIZE, padding: 0 }
    : undefined;

  return (
    <div
      ref={nodeRef}
      className={`skill-node${isSelected ? ' selected' : ''}${!light ? ' dark-node' : ''}${isRoot ? ' root-node' : ''}${isIconMode ? ' icon-mode' : ''}${demoMode ? ' demo-mode' : ''}${isSearchMatch ? ' search-match' : ''}${isSearchActive ? ' search-active' : ''}`}
      data-node-id={node.id}
      onMouseMove={onLocalMove}
      onDrop={onDrop}
      onDragOver={onDragOver}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: nodeWidth,
        background: bg,
        borderColor: isRoot ? undefined : isSelected ? undefined : (color === '#ffffff' ? '#dcdce4' : color),
        ...demoStyle,
      }}
    >
      {hasImage && !demoMode && (
        <img
          src={node.imageData!}
          className={`node-image${isIconMode ? ' node-image-icon' : ''}`}
          draggable={false}
        />
      )}
      {!isIconMode && !demoMode && (
        <>
          {isEditing ? (
            <textarea
              ref={editInputRef}
              className="node-title-input"
              value={editValue}
              rows={1}
              onChange={(e) => { setEditValue(e.target.value); editValueRef.current = e.target.value; }}
              onBlur={finishEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  finishEdit();
                } else if (e.key === 'Escape') {
                  cancelEdit();
                }
                e.stopPropagation();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="node-title">{node.title}</div>
          )}
          {!isCompact && mapLines.map((line, i) =>
            line.type === 'pool-entry' ? (
              <div key={i} className="node-map-text node-pool-entry">
                <span className="pool-color-dot" style={{ background: line.color }} />
                <span>{line.text}</span>
              </div>
            ) : (
              <div key={i} className="node-map-text">{line.text}</div>
            ),
          )}
        </>
      )}
      {!demoMode && (
        <div ref={handleRef} className="connection-handle" data-handle="true" />
      )}
    </div>
  );
});
