import { useRef, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GeometryEditor, type GeometryEditorHandle } from '@tuheng/geometry-editor';
import type { GeometryDocument } from '@tuheng/contracts';
import { connectionSheet } from '../repair-fixtures';
import { performanceDocument } from '../geometry-fixtures';
import '@tuheng/geometry-editor/src/styles.css';
declare global {
  interface Window {
    editorFixture: {
      documents: () => [GeometryDocument | undefined, GeometryDocument | undefined];
      echo: () => void;
      external: () => void;
      performance: () => void;
    };
    frameSamples: number[];
  }
}
function Fixture() {
  const [a, setA] = useState(connectionSheet),
    [b, setB] = useState(connectionSheet);
  const first = useRef<GeometryEditorHandle>(null),
    second = useRef<GeometryEditorHandle>(null);
  useEffect(() => {
    window.editorFixture = {
      documents: () => [first.current?.getDocument(), second.current?.getDocument()],
      echo: () => setA((d) => structuredClone(d)),
      external: () => setA(connectionSheet()),
      performance: () => setA(performanceDocument()),
    };
  }, []);
  return (
    <main style={{ display: 'flex', gap: 12, alignItems: 'start' }}>
      <div data-editor="a" style={{ width: 'min(850px,65vw)' }}>
        <GeometryEditor ref={first} value={a} onChange={setA} />
      </div>
      <div data-editor="b" style={{ width: 350 }}>
        <GeometryEditor ref={second} value={b} onChange={setB} />
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
