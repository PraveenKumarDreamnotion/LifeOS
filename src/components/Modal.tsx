import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A focus-trapping modal (12 §2.2). role is configurable — the trigger modal uses
 * alertdialog. Esc invokes onClose; the overlay does not (a reminder must be acted on,
 * not dismissed by a stray click).
 */
export function Modal({
  children,
  role = 'dialog',
  onEscape,
  labelledBy,
}: {
  children: ReactNode;
  role?: 'dialog' | 'alertdialog';
  onEscape?: () => void;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onEscape?.();
        return;
      }
      // Trap Tab inside the dialog so focus can't wander to the page behind it.
      if (e.key === 'Tab' && ref.current) {
        const focusable = ref.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === ref.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onEscape]);

  return (
    <div className="overlay">
      <div className="modal" role={role} aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} ref={ref}>
        {children}
      </div>
    </div>
  );
}
