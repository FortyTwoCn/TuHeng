import { formFeatures, startingToleranceRow } from '@tuheng/geometry-core';
import { useId } from 'react';

const columnNames = ['特征', '公差', '附加公差', '基准1', '基准2', '基准3'];
export function ToleranceRows({
  value,
  first,
  locked,
  change,
}: {
  value?: string;
  first: string[];
  locked: boolean;
  change: (value: string) => void;
}) {
  const list = useId();
  const rows: string[][] = value
    ? JSON.parse(value)
    : [startingToleranceRow(first[0] || '∥', first[1] || '0.1', first[2] || '')];
  const update = (next: string[][]) => change(JSON.stringify(next));
  return (
    <details className="cad-tolerance-rows">
      <summary>多行公差框</summary>
      <datalist id={list}>
        {formFeatures.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      {rows.map((row, i) => (
        <fieldset key={i}>
          <legend>第 {i + 1} 行</legend>
          {row.map((part, j) => (
            <label key={j}>
              {columnNames[j]}
              <input
                aria-label={'第' + (i + 1) + '行 ' + columnNames[j]}
                disabled={locked}
                list={j === 0 ? list : undefined}
                value={part}
                onChange={(event) =>
                  update(
                    rows.map((r, k) =>
                      k === i ? r.map((cell, m) => (m === j ? event.target.value : cell)) : r,
                    ),
                  )
                }
              />
            </label>
          ))}
        </fieldset>
      ))}
      <button
        type="button"
        disabled={locked || rows.length === 3}
        onClick={() => update([...rows, startingToleranceRow('∥', '0.1', '')])}
      >
        添加一行
      </button>
      <button
        type="button"
        disabled={locked || rows.length < 2}
        onClick={() => update(rows.slice(0, -1))}
      >
        移除末行
      </button>
    </details>
  );
}
