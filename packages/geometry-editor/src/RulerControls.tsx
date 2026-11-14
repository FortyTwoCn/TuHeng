import type { Ruler } from './types';
export function RulerControls({
  ruler,
  setRuler,
  fingerDraw,
  setFingerDraw,
}: {
  ruler: Ruler;
  setRuler: (r: Ruler) => void;
  fingerDraw: boolean;
  setFingerDraw: (v: boolean) => void;
}) {
  return (
    <div className="geo-toolbar">
      <label>
        <input
          type="checkbox"
          checked={fingerDraw}
          onChange={(e) => setFingerDraw(e.target.checked)}
        />
        手指绘图
      </label>
      <label>
        <input
          type="checkbox"
          checked={ruler.visible}
          onChange={(e) => setRuler({ ...ruler, visible: e.target.checked })}
        />
        虚拟直尺
      </label>
      {ruler.visible &&
        (['angle', 'length'] as const).map((key) => (
          <label key={key}>
            {key === 'angle' ? '尺角度' : '尺长度'}
            <input
              type="number"
              value={ruler[key]}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (Number.isFinite(n))
                  setRuler({
                    ...ruler,
                    [key]: key === 'length' ? Math.max(5, Math.min(200, n)) : n,
                  });
              }}
            />
          </label>
        ))}
      {ruler.visible && (
        <>
          <button
            type="button"
            onClick={() =>
              setRuler({ ...ruler, origin: { x: ruler.origin.x + 5, y: ruler.origin.y } })
            }
          >
            尺向右
          </button>
          <button
            type="button"
            onClick={() =>
              setRuler({ ...ruler, origin: { x: ruler.origin.x, y: ruler.origin.y + 5 } })
            }
          >
            尺向上
          </button>
        </>
      )}
    </div>
  );
}
