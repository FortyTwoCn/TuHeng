import type { GeometryDocument } from '@tuheng/contracts';
import { reconstructDrawing3D, type DrawingReconstructionResult } from '@tuheng/geometry-core';

const worker = self as unknown as {
  onmessage: ((message: MessageEvent<GeometryDocument>) => void) | null;
  postMessage: (result: DrawingReconstructionResult) => void;
};
worker.onmessage = ({ data }) => worker.postMessage(reconstructDrawing3D(data));
