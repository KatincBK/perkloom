import { useEffect, useRef } from 'react';
import { useStore } from '../store';

// Floating Word-style find box. Always mounted (it owns the global Ctrl+F
// shortcut) but renders its UI only while open. Match state lives in the store
// so NodeView can outline hits and Canvas can center the active one.
export default function SearchBar() {
  const open = useStore((s) => s.searchOpen);
  const query = useStore((s) => s.searchQuery);
  const matchIds = useStore((s) => s.searchMatchIds);
  const activeIndex = useStore((s) => s.searchActiveIndex);
  const activeTabId = useStore((s) => s.activeTabId);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Ctrl/Cmd+F opens the box and focuses the field. Capture phase so it
  // fires even when focus sits in a node-title editor that stops propagation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        useStore.getState().openSearch();
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Focus the field whenever the bar becomes visible.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  // Matches belong to one document — drop them when the active tab changes.
  useEffect(() => {
    useStore.getState().closeSearch();
  }, [activeTabId]);

  if (!open) return null;

  const total = matchIds.length;
  const hasQuery = query.trim().length > 0;

  return (
    <div
      className="search-bar"
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        className="search-input"
        type="text"
        placeholder="Find nodes…"
        value={query}
        onChange={(e) => useStore.getState().setSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) useStore.getState().searchPrev();
            else useStore.getState().searchNext();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            useStore.getState().closeSearch();
          }
          e.stopPropagation();
        }}
      />
      <span className="search-count">
        {hasQuery ? `${total > 0 ? activeIndex + 1 : 0}/${total}` : ''}
      </span>
      <button
        className="search-nav-btn"
        title="Previous (Shift+Enter)"
        disabled={total === 0}
        onClick={() => useStore.getState().searchPrev()}
      >
        ↑
      </button>
      <button
        className="search-nav-btn"
        title="Next (Enter)"
        disabled={total === 0}
        onClick={() => useStore.getState().searchNext()}
      >
        ↓
      </button>
      <button
        className="search-close-btn"
        title="Close (Esc)"
        onClick={() => useStore.getState().closeSearch()}
      >
        ✕
      </button>
    </div>
  );
}
