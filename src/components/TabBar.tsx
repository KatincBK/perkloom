import { useStore } from '../store';

export default function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const liveDirty = useStore((s) => s.isDirty);
  const switchTab = useStore((s) => s.switchTab);
  const closeTab = useStore((s) => s.closeTab);

  if (tabs.length === 0) return null;

  const tryClose = (id: string, title: string, dirty: boolean) => {
    if (dirty) {
      const ok = window.confirm(
        `"${title}" kaydedilmemiş değişiklikler içeriyor. Yine de kapatılsın mı?`,
      );
      if (!ok) return;
    }
    closeTab(id);
  };

  return (
    <div className="tab-bar">
      {tabs.map((t) => {
        const isActive = t.id === activeTabId;
        const dirty = isActive ? liveDirty : !!t.snapshot?.isDirty;
        return (
          <div
            key={t.id}
            className={`tab-item${isActive ? ' active' : ''}`}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              if (!isActive) switchTab(t.id);
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                tryClose(t.id, t.title, dirty);
              }
            }}
            title={t.title}
          >
            {dirty && <span className="tab-dirty" aria-label="unsaved">•</span>}
            <span className="tab-title">{t.title}</span>
            <button
              className="tab-close"
              aria-label="Close tab"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                tryClose(t.id, t.title, dirty);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
