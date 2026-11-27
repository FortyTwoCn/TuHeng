import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  constructionAnimationJsonSchema,
  type ConstructionAnimationDocument,
  type GeometryDocument,
} from '@tuheng/contracts';
import {
  auditDrawing,
  CONSTRUCTION_ANIMATION_MAX_BYTES,
  deriveDefaultConstructionAnimation,
  parseConstructionAnimationJson,
  serializeConstructionAnimationJson,
  withConstructionAnimation,
  type SolidReconstructionResult,
} from '@tuheng/geometry-core';
import { downloadBlob } from './cad-download';
import { useConstructionPlayback } from './construction-playback';

export type LinkedFace = { viewId: string; entityId?: string };
type Build = { revision: string; result?: SolidReconstructionResult; error?: string };

export function useTeachingWorkspace(
  doc: GeometryDocument,
  readOnly: boolean,
  selected: string[],
  commit: (document: GeometryDocument, label: string) => GeometryDocument | undefined,
  report: (message: string) => void,
) {
  const [animationMode, setAnimationMode] = useState<'play' | 'author' | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [showSolid, setShowSolid] = useState(false);
  const [mobilePane, setMobilePane] = useState<'sheet' | 'solid'>('sheet');
  const [link, setLink] = useState(true);
  const [entityHover, setEntityHover] = useState<string>();
  const [faceHover, setFaceHover] = useState<LinkedFace>();
  const [faceSelection, setFaceSelection] = useState<LinkedFace>();
  const [build, setBuild] = useState<Build>();
  const [issue, setIssue] = useState<{ revision: string; id: string }>();
  const [animationError, setAnimationError] = useState('');
  const animation = useMemo(
    () => doc.constructionAnimation ?? deriveDefaultConstructionAnimation(doc),
    [doc],
  );
  const geometryRevision = useMemo(
    () => JSON.stringify({ ...doc, constructionAnimation: undefined }),
    [doc],
  );
  const formMode = animationMode === 'author' && !readOnly;
  const isPlayback = !!animationMode && !formMode;
  const playback = useConstructionPlayback(doc, animation, isPlayback);
  const audit = useMemo(() => (showAudit ? auditDrawing(doc) : undefined), [doc, showAudit]);
  const selectedIssue =
    issue?.revision === geometryRevision
      ? audit?.checks.find(({ id }) => id === issue.id)
      : undefined;
  const currentBuild = build?.revision === geometryRevision ? build : undefined;
  const solid = currentBuild?.result?.ok ? currentBuild.result.solid : undefined;
  const workerRef = useRef<Worker>(null);
  useEffect(() => () => workerRef.current?.terminate(), []);

  const animationInput = useRef<HTMLInputElement>(null);
  const latestDrawing = useRef({ doc, readOnly, commit, report });
  useLayoutEffect(() => {
    latestDrawing.current = { doc, readOnly, commit, report };
  }, [doc, readOnly, commit, report]);
  const importTicket = useRef(0);

  function changeAnimationMode(mode: typeof animationMode) {
    playback.stop();
    playback.jump(playback.index);
    if (mode) {
      setShowAudit(false);
      setMobilePane('sheet');
    }
    setAnimationMode(mode);
  }

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
        setShowAudit(false);
        setMobilePane('sheet');
        setAnimationMode('play');
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

  function generateSolid() {
    setShowSolid(true);
    setMobilePane('solid');
    setFaceHover(undefined);
    setFaceSelection(undefined);
    if (currentBuild && (!currentBuild.result || currentBuild.result.ok) && !currentBuild.error)
      return;
    workerRef.current?.terminate();
    setBuild({ revision: geometryRevision });
    try {
      const worker = new Worker(new URL('./solid-worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = ({ data }: MessageEvent<SolidReconstructionResult>) => {
        if (workerRef.current !== worker) return;
        setBuild({ revision: geometryRevision, result: data });
        worker.terminate();
        workerRef.current = null;
      };
      worker.onerror = () => {
        if (workerRef.current !== worker) return;
        setBuild({ revision: geometryRevision, error: '三维计算进程启动失败，请重新生成。' });
        worker.terminate();
        workerRef.current = null;
      };
      worker.postMessage(doc);
    } catch {
      setBuild({ revision: geometryRevision, error: '当前浏览器无法启动三维计算进程。' });
    }
  }

  const linkedFace = showSolid && solid && link ? (faceHover ?? faceSelection) : undefined;
  const view =
    linkedFace && solid?.sourceViewMapping.find(({ viewId }) => viewId === linkedFace.viewId);
  const linked2D = linkedFace?.entityId ? [linkedFace.entityId] : (view?.entityIds ?? []);
  const linked3D =
    showSolid && link ? new Set([...selected, ...(entityHover ? [entityHover] : [])]) : undefined;
  return {
    animation,
    animationMode,
    isPlayback,
    formMode,
    playback,
    changeAnimationMode,
    animationInput,
    animationError,
    dismissAnimationError: () => setAnimationError(''),
    importAnimation,
    files,
    save: (value: ConstructionAnimationDocument) => setAnimation(value, '动画编排已保存'),
    reset: () => setAnimation(undefined, '已清除保存的动画'),
    generate: () => deriveDefaultConstructionAnimation(doc),
    resetAfterLoad() {
      playback.stop();
      playback.jump(0);
      setAnimationError('');
      setEntityHover(undefined);
    },
    audit,
    showAudit,
    setShowAudit,
    selectedIssue,
    selectIssue: (id: string) => {
      setIssue({ revision: geometryRevision, id });
      setMobilePane('sheet');
    },
    showSolid,
    solid,
    build: currentBuild,
    generateSolid,
    toggleSolid: () => {
      if (showSolid) {
        setShowSolid(false);
        setMobilePane('sheet');
      } else if (solid) {
        setShowSolid(true);
        setMobilePane('solid');
      } else generateSolid();
    },
    mobilePane,
    setMobilePane,
    link,
    setLink,
    linked2D,
    linked3D,
    linkedFace,
    faceSelection,
    setEntityHover,
    setFaceHover,
    selectFace: (face?: LinkedFace) => setFaceSelection(face),
  };
}
