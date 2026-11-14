import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import type { DrawingTool } from '@tuheng/geometry-core';
export type Tool = DrawingTool | 'select' | 'pan' | 'box' | 'pen' | 'projection';
export interface Ruler {
  visible: boolean;
  origin: Vec2;
  angle: number;
  length: number;
}
export interface EditorControls {
  document: GeometryDocument;
  role: 'teacher' | 'student';
  readOnly: boolean;
  tool: Tool;
  selected: string[];
  select: (ids: string[]) => void;
  commit: (doc: GeometryDocument) => void;
  report: (message: string) => void;
  snapping: boolean;
  skipSnap: boolean;
  consumeSnap: () => void;
  fingerDraw: boolean;
  ruler: Ruler;
  onRulerChange: (ruler: Ruler) => void;
  labels: boolean;
  grid: boolean;
  axes: boolean;
  zoom: number;
  highlighted: string[];
  hiddenLayers: string[];
  fitKey: number;
}
