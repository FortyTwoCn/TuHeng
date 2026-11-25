import { useMemo, useState, type ComponentProps } from 'react';
import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  angle,
  cadLength,
  cadLineEndpoint,
  cadNumber,
  cadPreview,
  distance,
  localToSheet,
  sub,
} from '@tuheng/geometry-core';
import type { DynamicLineInput, LineFields } from './DynamicLineInput';
import { lineSnapAt, type CadPick } from './cad-pointer';
import type { CadController } from './useCadCommand';

type PrecisionInput = Omit<ComponentProps<typeof DynamicLineInput>, 'size' | 'handle'> & {
  key: string;
};

export function useCadPrecision({
  cad,
  doc,
  cursor,
  hiddenLayers,
  afterLineCommit,
  focusCanvas,
}: {
  cad: CadController;
  doc: GeometryDocument;
  cursor?: CadPick;
  hiddenLayers: string[];
  afterLineCommit: () => void;
  focusCanvas: (preventScroll?: boolean) => void;
}) {
  const op = cad.session;
  const [lineDraft, setLineDraft] = useState<{ prefix: string; fields: LineFields }>();
  const [scalarDraft, setScalarDraft] = useState<{ prefix: string; value: string }>();
  const [error, setError] = useState('');
  const drawingLine = op?.commandId === 'segment' && op.points.length === 1;
  // 每段直线使用独立草稿。延续上一段的工具、视图与节点，不延续上一段的输入值。
  const fields = lineDraft?.prefix === op?.prefix ? lineDraft?.fields : undefined;
  const scalarMode =
    op?.phase === 'points' && op.points.length === 1
      ? op.commandId === 'rotate'
        ? 'angle'
        : op.commandId === 'compass' && !op.parameters.opening
          ? 'opening'
          : undefined
      : undefined;
  const scalar = scalarDraft?.prefix === op?.prefix ? scalarDraft?.value : undefined;

  // 预览与提交共用精确终点。输入尺寸后，只保留仍与终点相符的吸附关系。
  function precisePick(pick: CadPick): CadPick {
    if (!op || !drawingLine || !fields) return pick;
    const start = op.points[0];
    const position = cadLineEndpoint(start, pick.directionPosition ?? pick.position, fields);
    return {
      ...pick,
      position,
      rawPosition: position,
      entityId: distance(position, pick.position) < 1e-8 ? pick.entityId : undefined,
      snap: lineSnapAt(pick, start, position),
    };
  }

  const lineCursor: CadPick | undefined = drawingLine
    ? (cursor ?? {
        type: 'point',
        viewId: op.viewId,
        position: op.points[0],
        rawPosition: op.points[0],
      })
    : undefined;
  let linePreview = lineCursor;
  if (lineCursor) {
    try {
      linePreview = precisePick(lineCursor);
    } catch {
      // 允许输入中间态，保留指针预览，正式提交时再提示错误。
      linePreview = { ...lineCursor, snap: undefined };
    }
  }

  const commandPreview = useMemo(() => {
    if (!op || drawingLine) return null;
    try {
      const live =
        scalarMode === 'angle' && scalar?.trim()
          ? { ...op, parameters: { ...op.parameters, angle: scalar } }
          : op;
      return cadPreview(
        live,
        doc,
        cursor?.position,
        cursor?.entityId,
        cursor?.viewId,
        hiddenLayers,
      );
    } catch {
      return null;
    }
  }, [op, doc, cursor, drawingLine, hiddenLayers, scalar, scalarMode]);

  function clearLineDraft() {
    setLineDraft(undefined);
    setError('');
  }

  function cancel() {
    cad.send({ type: 'cancel' });
    setScalarDraft(undefined);
    clearLineDraft();
    focusCanvas();
  }

  let input: PrecisionInput | undefined;
  if (op && lineCursor && linePreview) {
    const start = op.points[0];
    input = {
      key: op.prefix,
      anchor: localToSheet(doc, lineCursor.viewId, lineCursor.rawPosition),
      from: localToSheet(doc, op.viewId, start),
      length: distance(start, linePreview.position),
      angle: angle(sub(linePreview.position, start)),
      fields: fields ?? {},
      error: fields ? error : '',
      change(next) {
        setLineDraft({ prefix: op.prefix, fields: next });
        setError('');
      },
      cancel,
      commit() {
        try {
          const pick = precisePick(lineCursor);
          if (distance(start, pick.position) < 1e-8) throw Error('移动光标或输入大于零的长度');
          if (cad.send(pick)) {
            clearLineDraft();
            afterLineCommit();
            focusCanvas(true);
          }
        } catch (error) {
          setError(error instanceof Error ? error.message : '输入无效');
        }
      },
    };
  } else if (op && scalarMode) {
    const origin = op.points[0];
    const position = cursor?.position ?? origin;
    const value =
      scalarMode === 'angle' ? angle(sub(position, origin)) : distance(position, origin);
    input = {
      key: op.prefix + scalarMode,
      anchor: localToSheet(doc, op.viewId, position),
      measure: scalarMode,
      length: value,
      angle: 0,
      fields: { length: scalar },
      error: scalar !== undefined ? error : '',
      confirmLabel: scalarMode === 'angle' ? '应用旋转角' : '应用开度',
      change(draft) {
        setScalarDraft({ prefix: op.prefix, value: draft.length ?? '' });
        setError('');
      },
      cancel,
      commit() {
        const text = scalar ?? String(value);
        try {
          if (scalarMode === 'angle') {
            const degrees = cadNumber(text, '旋转角', '°');
            if (Math.abs(degrees) > 360) throw Error('旋转角需在 −360° 至 360° 内');
            cad.send({ type: 'parameters', values: { angle: text } }, { type: 'confirm' });
          } else {
            cadLength(text, '开度');
            cad.send({ type: 'parameters', values: { opening: text } });
          }
          setScalarDraft(undefined);
          setError('');
          focusCanvas(true);
        } catch (error) {
          setError(error instanceof Error ? error.message : '输入无效');
        }
      },
    };
  }

  return { drawingLine, linePreview, commandPreview, input, precisePick, clearLineDraft };
}

export function sheetToViewport(
  p: Vec2,
  box: { x: number; y: number; height: number },
  scale: number,
): Vec2 {
  return { x: (p.x - box.x) * scale, y: (box.y + box.height - p.y) * scale };
}
