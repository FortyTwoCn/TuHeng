import type { EditorControls } from './types';

type SnapControls = Pick<
  EditorControls,
  | 'snapping'
  | 'skipSnap'
  | 'objectSnap'
  | 'objectTypes'
  | 'direction'
  | 'gridSpacing'
  | 'axes'
  | 'axesSnap'
  | 'gridSnap'
  | 'projectionSnap'
  | 'hiddenLayers'
>;

export function draftingSnapControls(controls: SnapControls, threshold: number, paused = false) {
  return {
    enabled: controls.snapping && !controls.skipSnap && !paused,
    direction: controls.direction,
    objects: controls.objectSnap,
    objectTypes: controls.objectTypes,
    gridSpacing: controls.gridSpacing,
    axes: controls.axes && controls.axesSnap,
    grid: controls.gridSnap,
    projection: controls.projectionSnap,
    hiddenLayers: controls.hiddenLayers,
    threshold,
  };
}
