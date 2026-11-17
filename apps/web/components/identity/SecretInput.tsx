'use client';
import { useId, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export function SecretInput({
  label,
  hint,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; hint?: string }) {
  const generated = useId();
  const id = input.id ?? generated;
  const [visible, setVisible] = useState(false);
  return (
    <div className="secret-field">
      <label htmlFor={id}>{label}</label>
      <div className="secret-input">
        <input
          {...input}
          id={id}
          type={visible ? 'text' : 'password'}
          aria-describedby={hint ? id + '-hint' : input['aria-describedby']}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={(visible ? '隐藏' : '显示') + label}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {hint && (
        <small id={id + '-hint'} className="muted">
          {hint}
        </small>
      )}
    </div>
  );
}
