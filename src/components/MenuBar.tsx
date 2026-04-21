import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, writeFile } from '@tauri-apps/plugin-fs';
import { addRecentFile } from '../recentFiles';
import { ProjectTypePicker, startNewProject } from './StartScreen';
import { loadProjectFilePath } from '../loadProjectFile';

interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  action?: () => void;
  divider?: boolean;
  checked?: boolean;
}

function Menu({
  label, items, isOpen, onOpen, onHover,
}: {
  label: string; items: MenuItem[]; isOpen: boolean; onOpen: () => void; onHover: () => void;
}) {
  return (
    <div className="menu-trigger-container">
      <div
        className={`menu-trigger${isOpen ? ' open' : ''}`}
        onMouseDown={(e) => { e.stopPropagation(); onOpen(); }}
        onMouseEnter={onHover}
      >
        {label}
      </div>
      {isOpen && (
        <div className="menu-dropdown">
          {items.map((item, i) =>
            item.divider ? (
              <div key={i} className="menu-divider" />
            ) : (
              <div
                key={i}
                className={`menu-item${item.disabled ? ' disabled' : ''}`}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  if (!item.disabled && item.action) { item.action(); onOpen(); }
                }}
              >
                <span>
                  {item.checked !== undefined && (
                    <span className="menu-check">{item.checked ? '\u2713' : ' '}</span>
                  )}
                  {item.label}
                </span>
                {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
//  SHORTCUTS PANEL
// ============================================================

const SHORTCUTS = [
  { key: 'Double-click canvas', desc: 'Create node' },
  { key: 'Double-click node', desc: 'Edit title' },
  { key: 'Drag from handle', desc: 'Connect / create child' },
  { key: 'Delete / Backspace', desc: 'Delete selected' },
  { key: 'Ctrl+C', desc: 'Copy nodes' },
  { key: 'Ctrl+V', desc: 'Paste nodes' },
  { key: 'Ctrl+Z', desc: 'Undo' },
  { key: 'Ctrl+Shift+Z', desc: 'Redo' },
  { key: 'Ctrl+S', desc: 'Save' },
  { key: 'Ctrl+Shift+S', desc: 'Save As' },
  { key: 'Ctrl+O', desc: 'Open' },
  { key: 'Space + drag', desc: 'Pan canvas' },
  { key: 'Middle-click drag', desc: 'Pan canvas' },
  { key: 'Alt + click drag', desc: 'Pan canvas' },
  { key: 'Scroll wheel', desc: 'Zoom' },
  { key: 'Escape', desc: 'Deselect' },
  { key: 'Right-click node', desc: 'Context menu' },
  { key: 'Click + drag empty', desc: 'Box select' },
  { key: 'Drop image on node', desc: 'Set node image' },
];

function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="shortcuts-overlay" onMouseDown={onClose}>
      <div className="shortcuts-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="shortcuts-header">
          <span>Keyboard Shortcuts</span>
          <button className="shortcuts-close" onClick={onClose}>x</button>
        </div>
        <div className="shortcuts-list">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="shortcut-row">
              <kbd className="shortcut-key">{s.key}</kbd>
              <span className="shortcut-desc">{s.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  MENU BAR
// ============================================================

export default function MenuBar() {
  const mode = useStore((s) => s.mode);
  const selectedNodeIds = useStore((s) => s.selectedNodeIds);
  const gridSnap = useStore((s) => s.gridSnap);
  const demoMode = useStore((s) => s.demoMode);
  const autoTargetLength = useStore((s) => s.autoTargetLength);
  const [autoLenDraft, setAutoLenDraft] = useState<string>(String(autoTargetLength));
  useEffect(() => {
    setAutoLenDraft(String(autoTargetLength));
  }, [autoTargetLength]);
  const theme = useStore((s) => s.theme);
  const filePath = useStore((s) => s.currentFilePath);
  const setFilePath = useStore((s) => s.setCurrentFilePath);
  const isDirty = useStore((s) => s.isDirty);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [pickingType, setPickingType] = useState(false);

  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenu]);

  const toggle = (name: string) => setOpenMenu((prev) => (prev === name ? null : name));
  const hover = (name: string) => { if (openMenu) setOpenMenu(name); };

  const handleShowHome = () => useStore.getState().setStartScreenOpen(true);

  const handleNewProject = () => setPickingType(true);

  const dialogFilter = { name: 'Perkloom', extensions: ['perkloom'] };
  // Open accepts both .perkloom and .json. Three separate filters work better
  // on Windows than a single combined filter (rfd/IFileOpenDialog quirk where
  // some shells fail to expand multi-extension specs).
  const openFilters = [
    { name: 'All Supported', extensions: ['perkloom', 'json'] },
    { name: 'Perkloom Project', extensions: ['perkloom'] },
    { name: 'JSON', extensions: ['json'] },
  ];

  const handleSaveAs = async () => {
    const path = await save({ filters: [dialogFilter], defaultPath: 'project.perkloom' });
    if (!path) return;
    const data = useStore.getState().getProjectData();
    try {
      await writeTextFile(path, JSON.stringify(data, null, 2));
      setFilePath(path);
      addRecentFile(path);
      useStore.getState().setIsDirty(false);
      const fileName = path.split(/[\\/]/).pop() ?? path;
      useStore.getState().setActiveTabTitle(fileName);
      useStore.getState().addToast(`Saved to ${fileName}`, 'success');
    } catch (err) {
      useStore.getState().addToast(`Save failed: ${err}`, 'error');
    }
  };

  const handleSave = async () => {
    if (!filePath) return handleSaveAs();
    const data = useStore.getState().getProjectData();
    try {
      await writeTextFile(filePath, JSON.stringify(data, null, 2));
      addRecentFile(filePath);
      useStore.getState().setIsDirty(false);
      useStore.getState().addToast('Saved', 'success');
    } catch (err) {
      useStore.getState().addToast(`Save failed: ${err}`, 'error');
    }
  };

  const handleOpen = async () => {
    const path = await open({ filters: openFilters, multiple: false });
    if (!path) return;
    await loadProjectFilePath(path);
  };

  const handleExportJson = async () => {
    const path = await save({ filters: [{ name: 'JSON', extensions: ['json'] }], defaultPath: 'project.json' });
    if (!path) return;
    const data = useStore.getState().getReadableExport();
    await writeTextFile(path, JSON.stringify(data, null, 2));
  };

  const handleExportCsv = async () => {
    const path = await save({ filters: [{ name: 'CSV', extensions: ['csv'] }], defaultPath: 'project.csv' });
    if (!path) return;
    const csv = useStore.getState().getCsvExport();
    await writeTextFile(path, csv);
  };

  const handleExportPng = async () => {
    const worldEl = document.querySelector('.canvas-world') as HTMLElement | null;
    if (!worldEl) return;
    // Use a temporary canvas to render the world element
    const nodes = worldEl.querySelectorAll('.skill-node');
    const edges = worldEl.querySelector('.edges-layer');
    if (nodes.length === 0) return;

    // Compute bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((el) => {
      const n = el as HTMLElement;
      const left = parseFloat(n.style.left) - n.offsetWidth / 2;
      const top = parseFloat(n.style.top) - n.offsetHeight / 2;
      const right = left + n.offsetWidth;
      const bottom = top + n.offsetHeight;
      if (left < minX) minX = left;
      if (top < minY) minY = top;
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    });

    const pad = 40;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const w = maxX - minX;
    const h = maxY - minY;

    // Clone the world, reset transform, render to canvas via foreignObject SVG
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('xmlns', svgNS);

    // Add edge paths
    if (edges) {
      const edgeSvg = edges.cloneNode(true) as SVGSVGElement;
      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('transform', `translate(${-minX},${-minY})`);
      for (const child of Array.from(edgeSvg.children)) g.appendChild(child);
      svg.appendChild(g);
    }

    // Render HTML nodes via foreignObject
    const fo = document.createElementNS(svgNS, 'foreignObject');
    fo.setAttribute('width', String(w));
    fo.setAttribute('height', String(h));
    const clone = worldEl.cloneNode(true) as HTMLElement;
    clone.style.transform = `translate(${-minX}px, ${-minY}px)`;
    clone.style.position = 'absolute';
    clone.style.top = '0';
    clone.style.left = '0';
    // Remove SVG from clone (we already added edges)
    const cloneSvg = clone.querySelector('.edges-layer');
    cloneSvg?.remove();
    // Remove selection box
    const selBox = clone.querySelector('.selection-box');
    selBox?.remove();

    const body = document.createElement('body');
    body.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    body.style.margin = '0';
    body.style.padding = '0';
    body.style.width = w + 'px';
    body.style.height = h + 'px';
    body.style.position = 'relative';
    body.style.overflow = 'hidden';

    // Copy stylesheets
    const styles = document.querySelectorAll('style, link[rel="stylesheet"]');
    styles.forEach((s) => body.appendChild(s.cloneNode(true)));
    body.appendChild(clone);
    fo.appendChild(body);
    svg.appendChild(fo);

    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = w * 2; // 2x for retina
      canvas.height = h * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      canvas.toBlob(async (pngBlob) => {
        if (!pngBlob) return;
        const path = await save({ filters: [{ name: 'PNG', extensions: ['png'] }], defaultPath: 'skilltree.png' });
        if (!path) return;
        const arrayBuf = await pngBlob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);
        // Write as binary via Tauri FS
        await writeFile(path, bytes);
      }, 'image/png');
    };
    img.src = url;
  };

  // keyboard shortcuts
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  const handleSaveAsRef = useRef(handleSaveAs);
  handleSaveAsRef.current = handleSaveAs;
  const handleOpenRef = useRef(handleOpen);
  handleOpenRef.current = handleOpen;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          handleSaveAsRef.current();
        } else {
          const st = useStore.getState();
          if (st.currentFilePath && !st.isDirty) return;
          handleSaveRef.current();
        }
      }
      if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        handleOpenRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fileItems: MenuItem[] = [
    { label: 'Home', action: handleShowHome },
    { label: 'New Project', action: handleNewProject },
    { divider: true, label: '' },
    { label: 'Open...', action: handleOpen, shortcut: 'Ctrl+O' },
    { label: 'Save', action: handleSave, shortcut: 'Ctrl+S', disabled: !!filePath && !isDirty },
    { label: 'Save As...', action: handleSaveAs, shortcut: 'Ctrl+Shift+S' },
    { divider: true, label: '' },
    {
      label: 'Close Tab',
      shortcut: 'Ctrl+W',
      action: () => {
        const id = useStore.getState().activeTabId;
        if (id) useStore.getState().closeTab(id);
      },
    },
    { divider: true, label: '' },
    { label: 'Export as JSON', action: handleExportJson },
    { label: 'Export as CSV', action: handleExportCsv },
    { label: 'Export as PNG', action: handleExportPng },
  ];

  const editItems: MenuItem[] = [
    { label: 'Undo', shortcut: 'Ctrl+Z', action: () => useStore.getState().undo() },
    { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: () => useStore.getState().redo() },
    { divider: true, label: '' },
    {
      label: 'Copy',
      shortcut: 'Ctrl+C',
      disabled: selectedNodeIds.length === 0,
      action: () => useStore.getState().copyNodes(selectedNodeIds),
    },
    {
      label: 'Paste',
      shortcut: 'Ctrl+V',
      action: () => {
        const vp = document.querySelector('.canvas-viewport');
        const rect = vp?.getBoundingClientRect();
        if (rect) {
          const { camera: cam } = useStore.getState();
          useStore.getState().pasteNodes(
            (rect.width / 2 - cam.x) / cam.zoom,
            (rect.height / 2 - cam.y) / cam.zoom,
          );
        }
      },
    },
    { divider: true, label: '' },
    {
      label: 'Delete Node',
      shortcut: 'Del',
      disabled: selectedNodeIds.length === 0,
      action: () => {
        const { selectedNodeIds: ids, deleteNode } = useStore.getState();
        for (const id of ids) deleteNode(id);
      },
    },
    { divider: true, label: '' },
    {
      label: 'All Nodes Expanded',
      action: () => useStore.getState().setAllDisplayMode('expanded'),
    },
    {
      label: 'All Nodes Compact',
      action: () => useStore.getState().setAllDisplayMode('compact'),
    },
  ];

  const layoutItems: MenuItem[] = [
    { label: 'Layered (Compact LR)', action: () => useStore.getState().autoLayout('layered') },
    { label: 'Layered (Compact TD)', action: () => useStore.getState().autoLayout('layered-td') },
    { label: 'Tree (Top-Down)', action: () => useStore.getState().autoLayout('tree') },
    { label: 'Horizontal (Left-Right)', action: () => useStore.getState().autoLayout('horizontal') },
    { label: 'Radial', action: () => useStore.getState().autoLayout('radial') },
    { label: 'Grid', action: () => useStore.getState().autoLayout('force') },
  ];

  const viewItems: MenuItem[] = [
    {
      label: 'Zoom In',
      action: () => {
        const { camera, setCamera } = useStore.getState();
        setCamera({ zoom: Math.min(5, camera.zoom * 1.25) });
      },
    },
    {
      label: 'Zoom Out',
      action: () => {
        const { camera, setCamera } = useStore.getState();
        setCamera({ zoom: Math.max(0.1, camera.zoom / 1.25) });
      },
    },
    { label: 'Reset Zoom', action: () => useStore.getState().setCamera({ zoom: 1 }) },
    { divider: true, label: '' },
    {
      label: 'Grid Snap',
      checked: gridSnap,
      action: () => useStore.getState().setGridSnap(!gridSnap),
    },
    {
      label: 'Demo Mode',
      checked: demoMode,
      action: () => useStore.getState().setDemoMode(!demoMode),
    },
    { divider: true, label: '' },
    {
      label: 'Day Mode',
      checked: theme === 'day',
      action: () => useStore.getState().setTheme(theme === 'day' ? 'night' : 'day'),
    },
    { divider: true, label: '' },
    {
      label: 'Keyboard Shortcuts',
      action: () => setShowShortcuts(true),
    },
  ];

  return (
    <>
      <div className="menu-bar" ref={barRef}>
        <div className="menu-bar-left">
          <Menu label="File" items={fileItems} isOpen={openMenu === 'file'} onOpen={() => toggle('file')} onHover={() => hover('file')} />
          <Menu label="Edit" items={editItems} isOpen={openMenu === 'edit'} onOpen={() => toggle('edit')} onHover={() => hover('edit')} />
          <Menu label="Layout" items={layoutItems} isOpen={openMenu === 'layout'} onOpen={() => toggle('layout')} onHover={() => hover('layout')} />
          <Menu label="View" items={viewItems} isOpen={openMenu === 'view'} onOpen={() => toggle('view')} onHover={() => hover('view')} />
        </div>
        <div className="menu-bar-right">
          <button
            className="theme-toggle-btn"
            onClick={() => useStore.getState().setTheme(theme === 'day' ? 'night' : 'day')}
            title={theme === 'day' ? 'Switch to Night' : 'Switch to Day'}
          >
            {theme === 'day' ? '\u263E' : '\u2600'}
          </button>
          {mode === 'auto' && (
            <div className="auto-length-control" title="Auto mode connection length">
              <span className="auto-length-label">Length</span>
              <input
                type="number"
                className="auto-length-input"
                min={20}
                step={10}
                value={autoLenDraft}
                onChange={(e) => setAutoLenDraft(e.target.value)}
                onBlur={() => {
                  const v = parseFloat(autoLenDraft);
                  if (Number.isNaN(v)) {
                    setAutoLenDraft(String(autoTargetLength));
                  } else {
                    useStore.getState().setAutoTargetLength(v);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
          )}
          <div className="mode-toggle">
            <button className={`mode-btn${mode === 'static' ? ' active' : ''}`} onClick={() => useStore.getState().setMode('static')}>Static</button>
            <button className={`mode-btn${mode === 'engineer' ? ' active' : ''}`} onClick={() => useStore.getState().setMode('engineer')}>Engineer</button>
            <button className={`mode-btn${mode === 'auto' ? ' active' : ''}`} onClick={() => useStore.getState().setMode('auto')}>Auto</button>
            <button className={`mode-btn${mode === 'responsive' ? ' active' : ''}`} onClick={() => useStore.getState().setMode('responsive')}>Responsive</button>
          </div>
        </div>
      </div>
      {showShortcuts && <ShortcutsPanel onClose={() => setShowShortcuts(false)} />}
      {pickingType && (
        <ProjectTypePicker
          onCancel={() => setPickingType(false)}
          onPick={(type) => {
            setPickingType(false);
            startNewProject(type);
          }}
        />
      )}
    </>
  );
}
