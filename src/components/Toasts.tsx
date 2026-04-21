import { useStore } from '../store';

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const removeToast = useStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.kind}`}
          onClick={() => removeToast(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
