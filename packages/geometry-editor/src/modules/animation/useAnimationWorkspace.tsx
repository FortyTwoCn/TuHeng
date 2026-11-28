import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  constructionAnimationJsonSchema,
  type ConstructionAnimationDocument,
  type GeometryDocument,
} from '@tuheng/contracts';
import {
  CONSTRUCTION_ANIMATION_MAX_BYTES,
  deriveDefaultConstructionAnimation,
  parseConstructionAnimationJson,
  serializeConstructionAnimationJson,
  withConstructionAnimation,
} from '@tuheng/geometry-core';
import { downloadBlob } from '../../cad-download';
import { useConstructionPlayback } from './construction-playback';

// 动画文件的校验与提交沿用当前正式文档，异步导入使用最新文档上下文。
export function useAnimationWorkspace({
  doc,
  enabled,
  readOnly,
  commit,
  report,
  opened,
}: {
  doc: GeometryDocument;
  enabled: boolean;
  readOnly: boolean;
  commit: (doc: GeometryDocument, label: string) => GeometryDocument | undefined;
  report: (message: string) => void;
  opened: () => void;
}) {
  const [animationError, setAnimationError] = useState('');
  const animation = useMemo(
    () => doc.constructionAnimation ?? deriveDefaultConstructionAnimation(doc),
    [doc],
  );
  const playback = useConstructionPlayback(doc, animation, enabled);
  const animationInput = useRef<HTMLInputElement>(null);
  const latestDrawing = useRef({ doc, readOnly, commit, report, opened });
  useLayoutEffect(() => {
    latestDrawing.current = { doc, readOnly, commit, report, opened };
  }, [doc, readOnly, commit, report, opened]);
  const importTicket = useRef(0);

  function setAnimation(value: ConstructionAnimationDocument | undefined, label: string) {
    const current = latestDrawing.current;
    if (current.readOnly) return false;
    try {
      const affected = current.commit(withConstructionAnimation(current.doc, value), label);
      if (!affected) throw Error('当前图纸无法保存动画');
      playback.stop();
      playback.jump(0);
      setAnimationError('');
      current.report(label);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '动画数据无效';
      setAnimationError(message);
      current.report(message);
      return false;
    }
  }

  async function importAnimation(file: File) {
    const request = ++importTicket.current;
    try {
      if (file.size > CONSTRUCTION_ANIMATION_MAX_BYTES) throw Error('$ 动画文件超过 8MB');
      const raw = await file.text();
      if (request !== importTicket.current || latestDrawing.current.readOnly) return;
      const value = parseConstructionAnimationJson(raw, latestDrawing.current.doc);
      if (setAnimation(value, '动画 JSON 已导入')) {
        latestDrawing.current.opened();
      }
    } catch (error) {
      if (request !== importTicket.current) return;
      const message = error instanceof Error ? error.message : '动画 JSON 无效';
      setAnimationError(message);
      latestDrawing.current.report(message);
    }
  }

  const files = {
    importAnimation: () => animationInput.current?.click(),
    animation: () =>
      downloadBlob(
        new Blob([serializeConstructionAnimationJson(animation)], { type: 'application/json' }),
        'tuheng.animation.json',
      ),
    animationSchema: () =>
      downloadBlob(
        new Blob([JSON.stringify(constructionAnimationJsonSchema(), null, 2) + '\n'], {
          type: 'application/schema+json',
        }),
        'tuheng.construction-animation.schema.json',
      ),
  };

  const fileControls = (
    <>
      <input
        ref={animationInput}
        className="geo-file-input"
        type="file"
        accept=".json,application/json"
        tabIndex={-1}
        aria-label="加载动画 JSON"
        disabled={readOnly}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void importAnimation(file);
        }}
      />
      {animationError && (
        <div className="geo-animation-error" role="alert">
          {animationError}
          <button type="button" onClick={() => setAnimationError('')}>
            关闭
          </button>
        </div>
      )}
    </>
  );
  return {
    animation,
    playback,
    fileControls,
    files,
    save: (value: ConstructionAnimationDocument) => setAnimation(value, '动画编排已保存'),
    reset: () => setAnimation(undefined, '已清除保存的动画'),
    generate: () => deriveDefaultConstructionAnimation(doc),
    resetAfterLoad() {
      playback.stop();
      playback.jump(0);
      setAnimationError('');
    },
  };
}
