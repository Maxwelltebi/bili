import { useEffect, useRef, useState, type ReactNode } from 'react';

type Props = { children: ReactNode; onClose: () => void; titleId: string; closing: boolean; onRequestClose: () => void };

export function JourneyModal({ children, onClose, titleId, closing, onRequestClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    const frame = requestAnimationFrame(() => element.querySelector<HTMLElement>('h1, h2')?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      element.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  useEffect(() => {
    if (!closing) return;
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;
    const timeout = window.setTimeout(onClose, delay);
    return () => window.clearTimeout(timeout);
  }, [closing, onClose]);
  return <dialog ref={dialog} className={`journey-modal ${closing ? 'is-closing' : ''}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onRequestClose(); }}>
    {children}
  </dialog>;
}

export function JourneyTransition({ children, stepKey }: { children: ReactNode; stepKey: string }) {
  const [visibleKey, setVisibleKey] = useState(stepKey);
  const lastContent = useRef(children);
  const changing = visibleKey !== stepKey;
  if (!changing) lastContent.current = children;
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!changing) return;
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160;
    const timeout = window.setTimeout(() => {
      setVisibleKey(stepKey);
      const dialog = viewport.current?.closest('dialog');
      dialog?.scrollTo({ top: 0 });
      requestAnimationFrame(() => viewport.current?.querySelector<HTMLElement>('h1, h2')?.focus({ preventScroll: true }));
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [changing, children, stepKey]);
  return <div ref={viewport} className={`journey-step ${changing ? 'is-leaving' : ''}`} inert={changing || undefined}>
    <div key={visibleKey} className="journey-step-content">{changing ? lastContent.current : children}</div>
  </div>;
}
