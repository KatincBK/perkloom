import { useRef, useEffect } from 'react';
import { useStore, NODE_WIDTH, computeNodeHeight } from '../store';

const MM_W = 180;
const MM_H = 120;
const MIN_NODES = 8;

export default function Minimap() {
  const nodes = useStore((s) => s.nodes);
  const camera = useStore((s) => s.camera);
  const selectedNodeIds = useStore((s) => s.selectedNodeIds);
  const dataTypes = useStore((s) => s.dataTypes);
  const poolTypes = useStore((s) => s.poolTypes);
  const minimapVisible = useStore((s) => s.minimapVisible);
  const setMinimapVisible = useStore((s) => s.setMinimapVisible);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const nodeList = Object.values(nodes);
  const shouldRender = nodeList.length >= MIN_NODES;

  useEffect(() => {
    if (!shouldRender || !minimapVisible) return;
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    cvs.width = MM_W * dpr;
    cvs.height = MM_H * dpr;
    ctx.scale(dpr, dpr);

    // Compute bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodeList) {
      const h = computeNodeHeight(n, dataTypes, poolTypes);
      const l = n.position.x - NODE_WIDTH / 2;
      const t = n.position.y - h / 2;
      if (l < minX) minX = l;
      if (t < minY) minY = t;
      if (l + NODE_WIDTH > maxX) maxX = l + NODE_WIDTH;
      if (t + h > maxY) maxY = t + h;
    }

    const pad = 40;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const worldW = maxX - minX || 1;
    const worldH = maxY - minY || 1;
    const scale = Math.min(MM_W / worldW, MM_H / worldH);
    const offX = (MM_W - worldW * scale) / 2;
    const offY = (MM_H - worldH * scale) / 2;

    ctx.clearRect(0, 0, MM_W, MM_H);

    // Draw edges
    ctx.strokeStyle = 'rgba(150,150,180,0.3)';
    ctx.lineWidth = 1;
    for (const n of nodeList) {
      if (!n.parentId || !nodes[n.parentId]) continue;
      const p = nodes[n.parentId];
      ctx.beginPath();
      ctx.moveTo(offX + (n.position.x - minX) * scale, offY + (n.position.y - minY) * scale);
      ctx.lineTo(offX + (p.position.x - minX) * scale, offY + (p.position.y - minY) * scale);
      ctx.stroke();
    }

    // Draw nodes
    const selSet = new Set(selectedNodeIds);
    for (const n of nodeList) {
      const x = offX + (n.position.x - NODE_WIDTH / 2 - minX) * scale;
      const y = offY + (n.position.y - minY) * scale;
      const w = NODE_WIDTH * scale;
      const h = 4;
      ctx.fillStyle = selSet.has(n.id) ? '#0d9488' : 'rgba(200,200,220,0.5)';
      ctx.fillRect(x, y - h / 2, w, h);
    }

    // Draw viewport rect
    const vp = document.querySelector('.canvas-viewport');
    if (vp) {
      const rect = vp.getBoundingClientRect();
      const vpL = (-camera.x / camera.zoom);
      const vpT = (-camera.y / camera.zoom);
      const vpW = rect.width / camera.zoom;
      const vpH = rect.height / camera.zoom;

      ctx.strokeStyle = 'rgba(13,148,136,0.7)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        offX + (vpL - minX) * scale,
        offY + (vpT - minY) * scale,
        vpW * scale,
        vpH * scale,
      );
    }
  });

  const handleClick = (e: React.MouseEvent) => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const rect = cvs.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Reverse the mapping to world coords
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodeList) {
      const h = computeNodeHeight(n, dataTypes, poolTypes);
      const l = n.position.x - NODE_WIDTH / 2;
      const t = n.position.y - h / 2;
      if (l < minX) minX = l;
      if (t < minY) minY = t;
      if (l + NODE_WIDTH > maxX) maxX = l + NODE_WIDTH;
      if (t + h > maxY) maxY = t + h;
    }
    const pad = 40;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const worldW = maxX - minX || 1;
    const worldH = maxY - minY || 1;
    const scale = Math.min(MM_W / worldW, MM_H / worldH);
    const offX = (MM_W - worldW * scale) / 2;
    const offY = (MM_H - worldH * scale) / 2;

    const worldX = (mx - offX) / scale + minX;
    const worldY = (my - offY) / scale + minY;

    const vp = document.querySelector('.canvas-viewport');
    if (vp) {
      const vpRect = vp.getBoundingClientRect();
      useStore.getState().setCamera({
        x: vpRect.width / 2 - worldX * camera.zoom,
        y: vpRect.height / 2 - worldY * camera.zoom,
      });
    }
  };

  if (!shouldRender) return null;

  if (!minimapVisible) {
    return (
      <button
        className="minimap-show-btn"
        onClick={() => setMinimapVisible(true)}
        title="Show minimap"
        aria-label="Show minimap"
      >
        <EyeIcon open={false} />
      </button>
    );
  }

  return (
    <div className="minimap">
      <canvas
        ref={canvasRef}
        style={{ width: MM_W, height: MM_H }}
        onClick={handleClick}
      />
      <button
        className="minimap-hide-btn"
        onClick={(e) => {
          e.stopPropagation();
          setMinimapVisible(false);
        }}
        title="Hide minimap"
        aria-label="Hide minimap"
      >
        <EyeIcon open={true} />
      </button>
    </div>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
