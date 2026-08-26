import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface CustomSelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

interface CustomSelectProps {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  disabled?: boolean;
  title?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
  triggerClassName = '',
  menuClassName = '',
  disabled = false,
  title,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((opt) => opt.value === value);

  useEffect(() => {
    if (!open) return;

    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (option: CustomSelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  return (
    <div className={`custom-select ${className}`} ref={ref}>
      <button
        type="button"
        className={`custom-select-trigger ${triggerClassName}`}
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title={title}
      >
        <span className="custom-select-value">{selected?.label || value}</span>
        <ChevronDown size={15} className={`custom-select-caret ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div className={`custom-select-menu ${menuClassName}`} role="listbox">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`custom-select-option ${option.value === value ? 'active' : ''}`}
              disabled={option.disabled}
              onClick={() => choose(option)}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
