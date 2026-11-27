import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import type { EditorSession, SessionAction } from './session';
import type { CommandId } from './commands';
import type { CadController } from './useCadCommand';
import type { Bounds, DrawingAuditCheck, ObjectSnapType } from '@tuheng/geometry-core';
import type { Appearance } from './CadPreferences';
import type { ConstructionPlayback } from './construction-playback';
export type Tool = 'select' | 'pan' | 'box' | 'pen' | 'projection';
export interface Ruler {
  visible: boolean;
  origin: Vec2;
  angle: number;
  length: number;
}
export interface CameraFit {
  bounds?: Bounds;
}
export interface EditorControls {
  cursorStatusRef?: import('react').RefObject<HTMLOutputElement | null>;
  cad: CadController;
  appearance: Appearance;
  objectSnap: boolean;
  gridSpacing: number;
  objectTypes: ObjectSnapType[];
  direction: boolean;
  tracking: boolean;
  ortho: boolean;
  touchOffset: boolean;
  selectionMode: 'replace' | 'add' | 'remove';
  typeFilter: string;
  document: GeometryDocument;
  role: 'teacher' | 'student';
  readOnly: boolean;
  tool: Tool;
  selected: string[];
  select: (ids: string[]) => void;
  commit: (doc: GeometryDocument) => GeometryDocument | undefined;
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
  playback?: ConstructionPlayback;
  auditCheck?: DrawingAuditCheck;
  hoverEntity?: (id?: string) => void;
  fitTeachingViewport?: boolean;
  hiddenLayers: string[];
  fit: CameraFit;
  revision: object;
  axesSnap: boolean;
  referenceFilter: boolean;
  session: EditorSession;
  dispatch: (action: SessionAction) => void;
  runCommand: (id: CommandId) => void;
  deleteSelection: () => void;
  copySelection: () => void;
}
