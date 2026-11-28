import type { GeometryDocument } from '@tuheng/contracts';
import {
  localToSheet,
  type DrawingAuditCheck,
  type DrawingAuditReport,
} from '@tuheng/geometry-core';

const status = { PASS: '通过', WARN: '有警告', FAIL: '未通过' };
const severity = { PASS: '通过', WARN: '警告', ERROR: '需修正' };

export function DrawingAuditModule({
  report,
  selected,
  select,
  generate,
}: {
  report: DrawingAuditReport;
  selected?: DrawingAuditCheck;
  select: (id: string) => void;
  generate?: () => void;
}) {
  const checks = [...report.checks].sort(
    (a, b) =>
      ['ERROR', 'WARN', 'PASS'].indexOf(a.severity) - ['ERROR', 'WARN', 'PASS'].indexOf(b.severity),
  );
  return (
    <aside className="geo-teaching-pane geo-audit-pane" aria-label="格式审核面板">
      <div className="geo-audit-heading">
        <h3>格式审核</h3>
        <span data-severity={report.status}>{status[report.status]}</span>
      </div>
      <p>
        {report.summary} 投影容差 {report.toleranceMm} mm。
      </p>
      {generate && (
        <button
          type="button"
          className="geo-teaching-primary"
          onClick={generate}
          disabled={!report.canReconstruct3D}
        >
          生成三维模型
        </button>
      )}
      {!report.canReconstruct3D && (
        <p className="geo-audit-notice">
          {report.status === 'FAIL'
            ? '请先修正下方标记的问题。'
            : '三维重建需要至少两张正交投影视图。'}
        </p>
      )}
      <ul className="geo-audit-results">
        {checks.map((check) => (
          <li key={check.id}>
            <button
              type="button"
              aria-pressed={selected?.id === check.id}
              data-audit-check={check.id}
              onClick={() => select(check.id)}
            >
              <strong>{check.title}</strong>
              <span data-severity={check.severity}>{severity[check.severity]}</span>
              <small>{check.detail}</small>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function DrawingAuditMarkers({
  doc,
  check,
  scale,
}: {
  doc: GeometryDocument;
  check?: DrawingAuditCheck;
  scale: number;
}) {
  if (!check?.markers.length) return null;
  const locations = check.markers.map((marker) => ({
    ...marker,
    sheet: localToSheet(doc, marker.viewId, marker.position),
  }));
  const first = locations[0],
    other = locations.find(({ viewId }) => viewId !== first.viewId);
  return (
    <g data-audit-markers={check.id} className="geo-audit-markers" pointerEvents="none">
      {other && (
        <line
          x1={first.sheet.x}
          y1={first.sheet.y}
          x2={other.sheet.x}
          y2={other.sheet.y}
          vectorEffect="non-scaling-stroke"
          strokeDasharray="6 5"
          strokeWidth="1.4"
        />
      )}
      {locations.map(({ sheet, label }, i) => (
        <g key={i} transform={`translate(${sheet.x} ${sheet.y})`}>
          <circle r={7 / scale} strokeWidth={2 / scale} />
          {label && (
            <text
              transform={`translate(${10 / scale} ${8 / scale}) scale(1 -1)`}
              stroke="none"
              fontSize={11 / scale}
            >
              {label}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}
