import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import type { DrawingTool } from '@tuheng/geometry-core';
import type { EditorSession, SessionAction } from './session';
import type { CommandId } from './commands';
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
  gridSnap: boolean;
  projectionSnap: boolean;
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
  revision: object;
  axesSnap: boolean;
  referenceFilter: boolean;
  session: EditorSession;
  dispatch: (action: SessionAction) => void;
  runCommand: (id: CommandId) => void;
  deleteSelection: () => void;
  copySelection: () => void;
}
