import type { GeometryDocument } from '@tuheng/contracts';
import type { Bounds } from '@tuheng/geometry-core';
import type { EditorControls } from '../types';

export type ViewportProps = EditorControls & {
  viewId: string;
  focusKey: number;
  onCameraChange: (box: Bounds) => void;
  replace: (doc: GeometryDocument) => GeometryDocument | undefined;
};
