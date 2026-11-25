import { useState } from 'react';

export function GridSpacing({
  value,
  change,
  report,
  readOnly,
}: {
  value: number;
  change: (n: number) => void;
  report: (message: string) => void;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState<string>();
  function apply() {
    if (draft === undefined) return;
    const n = Number(draft.trim().replaceAll('，', '.').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0.1 || n > 100) report('网距需为 0.1 至 100 mm');
    else if (n !== value) change(n);
    setDraft(undefined);
  }
  return (
    <label className="cad-grid-spacing" title="网格间距（mm）">
      网距
      <input
        aria-label="网格间距（mm）"
        inputMode="decimal"
        disabled={readOnly}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Enter') apply();
            else setDraft(undefined);
          }
        }}
      />
    </label>
  );
}
