import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export const useConfirm = (): ConfirmFn => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return ctx;
};

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  useEffect(() => {
    if (!options) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false);
      if (e.key === 'Enter') settle(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [options, settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <div className="modal-overlay" onClick={() => settle(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              {options.danger && <AlertTriangle size={18} style={{ color: 'var(--color-error)' }} />}
              <h3 className="modal-title">{options.title || 'Xác nhận'}</h3>
            </div>
            <p className="modal-message">{options.message}</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => settle(false)}>
                {options.cancelText || 'Huỷ'}
              </button>
              <button
                className={`btn ${options.danger ? 'btn-danger' : 'btn-primary'}`}
                autoFocus
                onClick={() => settle(true)}
              >
                {options.confirmText || 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
};
