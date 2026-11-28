import { useState } from 'react';

export type WorkspaceMode = 'drafting' | 'teaching';
export type WorkspaceModules = {
  animation?: boolean;
  timeline?: boolean;
  solid3d?: boolean;
  audit?: boolean;
  reference?: boolean;
};
export type WorkspacePane = 'sheet' | 'narration' | 'timeline' | 'solid' | 'audit' | 'reference';
export type ReferencePlacement = 'docked' | 'floating';

export function useWorkspaceLayout(
  requestedMode: WorkspaceMode,
  enabled: WorkspaceModules = {},
  readOnly = false,
) {
  const [previousMode, setPreviousMode] = useState(requestedMode);
  const [mode, setMode] = useState(requestedMode);
  const [pane, setPane] = useState<WorkspacePane>('sheet');
  const [authoring, setAuthoring] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [reference, setReference] = useState<{
    placement: ReferencePlacement;
    visibility: 'closed' | 'open' | 'minimized';
  }>({ placement: 'docked', visibility: 'closed' });

  function changeMode(next: WorkspaceMode) {
    setMode(next);
    setAuthoring(false);
    setCollapsed([]);
    setAuditOpen(false);
    setPane('sheet');
  }
  if (previousMode !== requestedMode) {
    setPreviousMode(requestedMode);
    changeMode(requestedMode);
  }

  const teaching = mode === 'teaching';
  const canNarrate = teaching && enabled.animation !== false;
  const canShowTimeline = teaching && enabled.timeline !== false;
  const solidEnabled = enabled.solid3d !== false;
  const canShowSolid = teaching && solidEnabled;
  const editingSteps = canNarrate && authoring && !readOnly;
  const audit = enabled.audit !== false && auditOpen;
  const narration = canNarrate && !collapsed.includes('narration');
  const solid = canShowSolid && !collapsed.includes('solid');
  const timeline = canShowTimeline && !collapsed.includes('timeline') && !editingSteps;
  const docked =
    enabled.reference !== false &&
    reference.visibility === 'open' &&
    reference.placement === 'docked';
  const available = {
    sheet: true,
    narration: narration && !audit,
    solid,
    timeline,
    audit,
    reference: docked,
  };

  function toggleModule(id: 'narration' | 'timeline' | 'solid') {
    if (id === 'narration' && auditOpen) {
      setAuditOpen(false);
      setCollapsed((current) => current.filter((item) => item !== id));
      return;
    }
    setCollapsed((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  return {
    mode,
    changeMode,
    authoring: editingSteps,
    setAuthoring,
    editingLocked: teaching && !editingSteps,
    playback: (canNarrate || canShowTimeline) && !editingSteps,
    showAudit: audit,
    openAudit(open: boolean) {
      setAuditOpen(open);
      setPane(open ? 'audit' : 'sheet');
    },
    showNarration: available.narration,
    showSolid: solid,
    showTimeline: timeline,
    canNarrate,
    canShowTimeline,
    canShowSolid,
    solidEnabled,
    canAudit: enabled.audit !== false,
    canReference: enabled.reference !== false,
    showNarrationPane() {
      setCollapsed((current) => current.filter((item) => item !== 'narration'));
      setAuditOpen(false);
      setPane('narration');
    },
    showSolidPane() {
      setCollapsed((current) => current.filter((item) => item !== 'solid'));
      setPane('solid');
    },
    toggleModule,
    pane: available[pane] ? pane : 'sheet',
    setPane,
    available,
    reference,
    docked,
    openReference() {
      setReference((current) => ({ ...current, visibility: 'open' }));
      setPane('reference');
    },
    placeReference(placement: ReferencePlacement) {
      setReference({ placement, visibility: 'open' });
      setPane(placement === 'docked' ? 'reference' : 'sheet');
    },
    minimizeReference() {
      setReference((current) => ({ ...current, visibility: 'minimized' }));
      setPane('sheet');
    },
    closeReference() {
      setReference({ placement: 'docked', visibility: 'closed' });
      setPane('sheet');
    },
  };
}

export type WorkspaceLayout = ReturnType<typeof useWorkspaceLayout>;
