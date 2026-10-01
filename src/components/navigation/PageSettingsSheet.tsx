import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './page-settings.css';

export function PageSettingsSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const back = (event: Event) => { event.preventDefault(); close.current(); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') ?? [])];
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('route-native-back', back, true);
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('route-native-back', back, true);
      window.removeEventListener('keydown', keyboard);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(<div className="page-settings-backdrop" onClick={onClose}>
    <section ref={panel} className="page-settings-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
      <header><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} aria-label={`${title} 닫기`}><X size={21} /></button></header>
      <div className="page-settings-content">{children}</div>
    </section>
  </div>, document.body);
}

export function PageSettingToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: () => void }) {
  return <button className="page-setting-toggle" type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange}>
    <span><b>{label}</b><small>{description}</small></span><i className={checked ? 'on' : ''} aria-hidden="true"><span /></i>
  </button>;
}
