import { useEffect, useRef, useState } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import type { SolidReconstructionResult } from '@tuheng/geometry-core';

export type LinkedFace = { viewId: string; entityId?: string };
type Build = { revision: string; result?: SolidReconstructionResult; error?: string };

// 三维计算留在工作线程。二维和三维只交换可追溯的视图与图元 ID。
export function useSolidPreview(
  doc: GeometryDocument,
  revision: string,
  active: boolean,
  selected: string[],
) {
  const [link, setLink] = useState(true);
  const [entityHover, setEntityHover] = useState<string>();
  const [faceHover, setFaceHover] = useState<LinkedFace>();
  const [faceSelection, setFaceSelection] = useState<LinkedFace>();
  const [build, setBuild] = useState<Build>();
  const workerRef = useRef<Worker>(null);
  useEffect(() => () => workerRef.current?.terminate(), []);
  const currentBuild = build?.revision === revision ? build : undefined;
  const solid = currentBuild?.result?.ok ? currentBuild.result.solid : undefined;
  const linkedFace = active && solid && link ? (faceHover ?? faceSelection) : undefined;
  const view =
    linkedFace && solid?.sourceViewMapping.find(({ viewId }) => viewId === linkedFace.viewId);

  function generate() {
    if (currentBuild && (!currentBuild.result || currentBuild.result.ok) && !currentBuild.error)
      return;
    setFaceHover(undefined);
    setFaceSelection(undefined);
    workerRef.current?.terminate();
    setBuild({ revision });
    try {
      const worker = new Worker(new URL('./solid-worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      function finish(next: Build) {
        if (workerRef.current !== worker) return;
        setBuild(next);
        worker.terminate();
        workerRef.current = null;
      }
      worker.onmessage = ({ data }: MessageEvent<SolidReconstructionResult>) =>
        finish({ revision, result: data });
      worker.onerror = () => finish({ revision, error: '三维计算进程启动失败，请重新生成。' });
      worker.postMessage(doc);
    } catch {
      workerRef.current?.terminate();
      workerRef.current = null;
      setBuild({ revision, error: '当前浏览器无法启动三维计算进程。' });
    }
  }

  return {
    generate,
    solid,
    build: currentBuild,
    link,
    setLink,
    linkedFace,
    linked2D: linkedFace?.entityId ? [linkedFace.entityId] : (view?.entityIds ?? []),
    linked3D:
      active && link ? new Set([...selected, ...(entityHover ? [entityHover] : [])]) : undefined,
    setEntityHover,
    setFaceHover,
    selectFace: setFaceSelection,
  };
}
