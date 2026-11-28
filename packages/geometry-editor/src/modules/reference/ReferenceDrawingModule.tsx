import { useState, type CSSProperties, type PointerEventHandler, type Ref } from 'react';
import { Maximize2, Minimize2, PanelRight, X } from 'lucide-react';
import type { GeometryDocument } from '@tuheng/contracts';
import type { ReferencePlacement } from '../useWorkspaceLayout';
import { ReferenceProperties } from './ReferenceProperties';
import { ReferenceViewport } from './ReferenceViewport';

type ContentsProps = {
  document: GeometryDocument;
  copy: (document: GeometryDocument, ids: string[]) => void;
  copyDisabled?: string;
};

function ReferenceContents({ document, copy, copyDisabled }: ContentsProps) {
  const [previous, setPrevious] = useState(document);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  if (previous !== document) {
    setPrevious(document);
    setVersion(version + 1);
    setSelected([]);
  }
  const entities = selected.flatMap(
    (id) => document.entities.find((entity) => entity.id === id) ?? [],
  );
  return (
    <div className="geo-reference-content">
      <ReferenceViewport
        key={version}
        document={document}
        selected={selected}
        select={setSelected}
      />
      {entities.length > 0 && (
        <div className="geo-reference-inspector">
          <ReferenceProperties doc={document} entities={entities} />
          <div className="geo-reference-copy">
            <span>{entities.length} 个对象</span>
            <button
              type="button"
              className="geo-teaching-primary"
              disabled={!!copyDisabled}
              title={copyDisabled}
              onClick={() => copy(document, selected)}
            >
              复制到主画框
            </button>
            {copyDisabled && <small>{copyDisabled}</small>}
          </div>
        </div>
      )}
    </div>
  );
}

export function ReferenceDrawingModule({
  entry,
  placement,
  minimized,
  loading,
  error,
  load,
  copy,
  copyDisabled,
  place,
  minimize,
  close,
  windowRef,
  style,
  move,
  resize,
}: {
  entry?: { document: GeometryDocument; title: string; notice?: string };
  placement: ReferencePlacement;
  minimized: boolean;
  loading: boolean;
  error: string;
  load: () => void;
  copy: ContentsProps['copy'];
  copyDisabled?: string;
  place: (placement: ReferencePlacement) => void;
  minimize: () => void;
  close: () => void;
  windowRef: Ref<HTMLElement>;
  style?: CSSProperties;
  move: PointerEventHandler<HTMLElement>;
  resize: PointerEventHandler<HTMLElement>;
}) {
  const floating = placement === 'floating';
  return (
    <aside
      ref={windowRef}
      className="geo-reference-pane"
      data-placement={placement}
      hidden={minimized}
      aria-label="参考图纸预览"
      style={style}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="geo-reference-titlebar" onPointerDown={move}>
        <h3 title={entry?.title}>{entry?.title ?? '参考图纸'}</h3>
        <button
          type="button"
          aria-label={floating ? '停靠分屏' : '切为浮窗'}
          title={floating ? '停靠分屏' : '切为浮窗'}
          onClick={() => place(floating ? 'docked' : 'floating')}
        >
          {floating ? <PanelRight size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
        </button>
        <button type="button" aria-label="最小化参考图纸" title="最小化" onClick={minimize}>
          <Minimize2 size={16} aria-hidden />
        </button>
        <button type="button" aria-label="关闭参考图纸" title="关闭" onClick={close}>
          <X size={16} aria-hidden />
        </button>
      </header>
      <div className="geo-reference-file">
        <button type="button" onClick={load}>
          加载参考图纸
        </button>
        {loading && <span role="status">正在读取…</span>}
        {entry?.notice && <span role="status">{entry.notice}</span>}
        {error && <p role="alert">{error}</p>}
      </div>
      {entry && (
        <ReferenceContents document={entry.document} copy={copy} copyDisabled={copyDisabled} />
      )}
      {floating && (
        <span className="geo-reference-resize" aria-hidden="true" onPointerDown={resize} />
      )}
    </aside>
  );
}
