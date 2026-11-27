import type { GeometryDocument } from '@tuheng/contracts';
import { reconstructSolid3D, type SolidReconstructionResult } from '@tuheng/geometry-core';

const worker = self as unknown as {
  onmessage: ((message: MessageEvent<GeometryDocument>) => void) | null;
  postMessage: (result: SolidReconstructionResult) => void;
};
worker.onmessage = ({ data }) => worker.postMessage(reconstructSolid3D(data));
