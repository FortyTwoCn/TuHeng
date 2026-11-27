import type { LucideIcon } from 'lucide-react';

export function WorkspaceAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  pressed,
  className = '',
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`cad-action ${className}`}
      title={label}
      aria-label={label}
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
