import type { CadEntity, GeometryDocument, Vec2 } from '@tuheng/contracts';
import { add, angle, cross, distance, dot, length, point, scale, sub, unit } from './vectors';
import { hatchStrokes } from './hatch';
import { angleMeasurement } from './cad-dimensions';

type Ellipse = Extract<CadEntity, { kind: 'ellipse' }>;
type Dimension = Extract<CadEntity, { kind: 'dimension' }>;
export interface CadText {
  at: Vec2;
  angle: number;
  size: number;
  text: string;
  anchor?: 'start' | 'end';
}
export interface CadDrawing {
  strokes: Vec2[][];
  labels: CadText[];
}
const DEG = Math.PI / 180;
const vector = (degrees: number) => ({ x: Math.cos(degrees * DEG), y: Math.sin(degrees * DEG) });
const normal = (v: Vec2) => ({ x: -v.y, y: v.x });
export function ellipseAt(center: Vec2, e: Ellipse, parameterDegrees: number): Vec2 {
  const major = vector(e.angle),
    t = parameterDegrees * DEG;
  return add(
    center,
    add(
      scale(major, e.majorRadius * Math.cos(t)),
      scale(normal(major), e.minorRadius * Math.sin(t)),
    ),
  );
}
export function dimensionValue(doc: GeometryDocument, e: Dimension): number {
  if (e.dimensionType === 'RADIUS' || e.dimensionType === 'DIAMETER') {
    const obj = doc.entities.find((obj) => obj.id === e.referenceIds[0]);
    if (obj?.kind !== 'circle' && obj?.kind !== 'arc') throw Error('半径标注缺少圆或圆弧');
    return obj.radius * (e.dimensionType === 'DIAMETER' ? 2 : 1);
  }
  if (e.dimensionType === 'ANGULAR') return Math.abs(angleMeasurement(doc,e.referenceIds,e.position).sweep);
  const [a,b] = e.referenceIds.map(id=>point(doc,id));
  const d = sub(b,a);
  if (e.dimensionType === 'LINEAR')
    return Math.abs(e.linearAngle === undefined ? (e.linearAxis === 'Y' ? d.y : d.x) : dot(d,vector(e.linearAngle)));
  return length(d);
}
function arrow(tip: Vec2, direction: Vec2, size: number, closed: boolean) {
  const v = unit(direction),
    center = add(tip, scale(v, size)),
    side = scale(normal(v), size * 0.26);
  const left = add(center, side),
    right = sub(center, side);
  return closed ? [left, tip, right, left] : [left, tip, right];
}
function dimensionDrawing(doc: GeometryDocument, e: Dimension): CadDrawing {
  const p = e.position, size = e.textSize, angular = e.dimensionType === 'ANGULAR';
  let value: number;
  try {
    value = dimensionValue(doc,e);
    if (value < 1e-8) throw Error('测量跨度为零');
  } catch {
    return {strokes:[],labels:[{at:p,size,angle:0,text:'尺寸标注失效'}]};
  }
  const text =
    e.textOverride ||
    (e.dimensionType === 'RADIUS' ? 'R' : e.dimensionType === 'DIAMETER' ? 'Ø' : '') +
      value.toFixed(e.precision) +
      (angular ? '°' : ' mm');
  const strokes: Vec2[][] = [],
    labels = [{ at: p, size, angle: 0, text }],
    closed = e.arrowStyle === 'CLOSED';
  const tol = e.tolerance;
  if (tol) {
    const x = p.x + [...text].length*size*0.64 + size*0.35;
    if (tol.showCode && tol.code)
      labels.push({at: {x,y:p.y},size:size*0.83,angle:0,text:tol.code});
    if (tol.showDeviation) {
      const u = x + (tol.showCode ? tol.code.length*size*0.62 : 0);
      if (tol.upper) labels.push({at:{x:u,y:p.y+size*0.5},size:size*0.7,angle:0,text:tol.upper});
      if (tol.lower) labels.push({at:{x:u,y:p.y-size*0.5},size:size*0.7,angle:0,text:tol.lower});
    }
  }
  if (e.dimensionType === 'RADIUS' || e.dimensionType === 'DIAMETER') {
    const source = doc.entities.find((obj) => obj.id === e.referenceIds[0]);
    if (source?.kind !== 'circle' && source?.kind !== 'arc') throw Error('圆引用无效');
    const c = point(doc, source.center);
    const d =
      distance(c, p) > 1e-8
        ? unit(sub(p, c))
        : vector(source.kind === 'arc' ? source.startAngle : 0);
    const r = source.radius, outward = distance(c,p) > r;
    const end = add(c,scale(d,r)), far = sub(c,scale(d,r));
    const diameter=e.dimensionType==='DIAMETER';
    if (outward) {
      strokes.push(diameter ? [far,end,p] : [c,end,p]);
      strokes.push(arrow(end,d,size,closed));
      if (diameter) strokes.push(arrow(far,scale(d,-1),size,closed));
    } else {
      strokes.push(diameter ? [far,end] : [c,end],arrow(end,scale(d,-1),size,closed));
      if (diameter) strokes.push(arrow(far,d,size,closed));
    }
    const leader=add(p,{x:(p.x<c.x?-1:1)*size*1.7,y:0});
    strokes.push([p,leader]);
    if (source.kind === 'arc') {
      const wrap = (n:number)=>((n+540)%360)-180;
      const phase=(((angle(d)-source.startAngle)*Math.sign(source.sweep))%360+360)%360;
      if (phase>Math.abs(source.sweep)+1e-7) {
        const contacts=[source.startAngle,source.startAngle+source.sweep];
        const target=angle(d);
        const start=contacts.sort((a,b)=>Math.abs(wrap(target-a))-Math.abs(wrap(target-b)))[0];
        const extent=wrap(target-start), count=Math.max(2,Math.ceil(Math.abs(extent)/7.5));
        strokes.push(Array.from({length:count+1},(_,i)=>add(c,scale(vector(start+extent*i/count),r))));
      }
    }
  } else {
    if (angular) {
      const {vertex:a,start,sweep}=angleMeasurement(doc,e.referenceIds,p);
      const radius = Math.max(distance(a, p), size);
      const path = Array.from({ length: 33 }, (_, i) =>
        add(a, scale(vector(start + (sweep * i) / 32), radius)),
      );
      strokes.push(
        [a, path[0]],
        path,
        [a, path[32]],
        arrow(path[0], sub(path[1], path[0]), size, closed),
        arrow(path[32], sub(path[31], path[32]), size, closed),
      );
    } else {
      const [a,b] = e.referenceIds.map(id=>point(doc,id));
      const d =
          e.dimensionType === 'ALIGNED'
            ? unit(sub(b, a))
            : vector(e.linearAngle ?? (e.linearAxis === 'Y' ? 90 : 0)),
        n = normal(d);
      const x = add(a, scale(n, dot(sub(p, a), n))),
        y = add(b, scale(n, dot(sub(p, b), n)));
      strokes.push(
        [a, x],
        [b, y],
        [x, y],
        arrow(x, sub(y, x), size, closed),
        arrow(y, sub(x, y), size, closed),
      );
    }
  }
  return { strokes, labels };
}
export function cadDrawing(doc: GeometryDocument, e: CadEntity): CadDrawing {
  if (e.kind === 'dimension') return dimensionDrawing(doc, e);
  if (e.kind === 'hatch') {
    try {
      return { strokes: hatchStrokes(doc, e), labels: [] };
    } catch (error) {
      // Gesture previews can temporarily open a region or exceed the legal pattern density.
      // The document schema rejects confirmation; rendering must still allow correction.
      return {
        strokes: [],
        labels: [
          {
            at: e.origin,
            angle: 0,
            size: 2.5,
            text: error instanceof Error ? error.message : '剖面边界无效',
          },
        ],
      };
    }
  }
  if (e.kind === 'ellipse') {
    const center = point(doc, e.center);
    const step = Math.max(
      0.25,
      Math.min(8, (2 * Math.acos(Math.max(-1, 1 - 0.01 / e.majorRadius))) / DEG),
    );
    const n = Math.max(2, Math.ceil(Math.abs(e.sweep) / step));
    return {
      strokes: [
        Array.from({ length: n + 1 }, (_, i) =>
          ellipseAt(center, e, e.startAngle + (e.sweep * i) / n),
        ),
      ],
      labels: [],
    };
  }
  const d = vector(e.angle),
    n = normal(d),
    size = e.size;
  // A tolerance frame and its cells form one readable paper glyph. Reflected view
  // coordinates must neither reverse their reading order nor flip rotation symbols.
  const frame = doc.views.find((view) => view.id === e.viewId)?.transform;
  const reflected = !!frame && cross(frame.xAxis, frame.yAxis) < 0;
  const readingSign = reflected && !(e.kind === 'symbol' && e.symbolType === 'DIRECTION') ? -1 : 1;
  const at = (x: number, y: number) =>
    add(e.position, add(scale(d, x * size * readingSign), scale(n, y * size)));
  const label = (x: number, y: number, text: string): CadText => ({
    at: at(x, y),
    angle: e.angle,
    size,
    text,
    anchor: reflected ? 'end' : 'start',
  });
  if (e.kind === 'text') return { strokes: [], labels: [label(0, 0, e.content)] };
  if (e.kind === 'symbol') {
    const labels = e.label ? [{at:e.labelPosition ?? at(0,1),size,angle:0,text:e.label}] : [];
    if (e.symbolType === 'DIRECTION') {
      const end = at((e.arrowLength ?? 2*size)/size,0);
      return {
        strokes: [[e.position,end], arrow(end, scale(d, -1), Math.min(size*0.7,(e.arrowLength ?? 2*size)*0.48), true)],
        labels,
      };
    }
    const sign = e.symbolType === 'LEFT_ROTATION' ? 1 : -1;
    const path = Array.from({ length: 30 }, (_, i) => {
      const a = (35 + (285 * i) / 29) * DEG;
      return at(Math.cos(a), sign * Math.sin(a));
    });
    return {
      strokes: [path, arrow(path[29], sub(path[28], path[29]), size * 0.55, true)],
      labels,
    };
  }
  const guide: Vec2[][] = e.leader ? [[e.leader,at(-0.65,0),at(0,0)]] : [];
  if (e.annotationType === 'ROUGHNESS') {
    const strokes = [...guide, [at(0, 0.9), at(0.45, 0), at(1.35, 1.8), at(3.8, 1.8)]];
    if (e.roughnessMode === 'REMOVAL_REQUIRED') strokes.push([at(0, 0.9), at(0.9, 0.9)]);
    if (e.roughnessMode === 'REMOVAL_PROHIBITED')
      strokes.push(
        Array.from({ length: 33 }, (_, i) =>
          at(
            0.45 + 0.28 * Math.cos((2 * Math.PI * i) / 32),
            0.65 + 0.28 * Math.sin((2 * Math.PI * i) / 32),
          ),
        ),
      );
    const labels=e.fields.map((f, i)=>label(1.5,0.65-i*1.2,f));
    const options=e.roughnessDetails;
    if (options) {
      if (options.accessory==='BAR') strokes.push([at(0,0.9),at(1.06,0.9)]);
      if (options.accessory==='ALL_AROUND') strokes.push(Array.from({length:25},(_,i)=>
        at(0.45+0.28*Math.cos(i*Math.PI/12),0.28*Math.sin(i*Math.PI/12))));
      if (options.accessory==='AFTER_WELD') strokes.push([at(0.9,1.0),at(1.24,0.67),at(1.54,1.18)]);
      const textures={NONE:'',PARALLEL:'＝',PERPENDICULAR:'⊥',CROSSED:'X',MULTIDIRECTIONAL:'M',
        CIRCULAR:'C',RADIAL:'R',NON_DIRECTIONAL:'P'};
      if (options.texture!=='NONE') labels.push(label(4,0.65,textures[options.texture]));
      if (options.method) labels.push(label(1.5,2.0,options.method));
      if (options.extent!=='NONE') labels.push(label(0,-1.05,options.extent==='ALL'?'全部':'其余'));
    }
    return { strokes, labels };
  }
  if (e.annotationType === 'TOLERANCE_TEXT') {
    const [nominal, upper, lower] = e.fields,
      offset = [...nominal].length * 0.8 + 0.3,
      labels = [label(0, 0, nominal)];
    if (upper) labels.push({ ...label(offset, 0.55, upper), size: size * 0.7 });
    if (lower) labels.push({ ...label(offset, -0.35, lower), size: size * 0.7 });
    return { strokes: [], labels };
  }
  const strokes: Vec2[][] = [...guide], labels: CadText[] = [];
  if (e.annotationType==='GEOMETRIC_TOLERANCE' && e.toleranceRows) {
    const columns = Array.from({length:6},(_,i)=>Math.max(1.3,...e.toleranceRows!.map(row=>[...row[i]].length*.78+.7)));
    for (const [i,row] of e.toleranceRows.entries()) {
      let x=0;
      const y=-1.6*i;
      for (const [j,value] of row.entries()) {
        const w=columns[j];
        strokes.push([at(x,y-.35),at(x+w,y-.35),at(x+w,y+1.25),at(x,y+1.25),at(x,y-.35)]);
        if (value) labels.push(label(x+.25,y,value));
        x+=w;
      }
    }
    return {strokes,labels};
  }
  let x = 0;
  if (e.annotationType === 'DATUM')
    strokes.push([at(0, -1.7), at(-0.35, -2.2), at(0.35, -2.2), at(0, -1.7), at(0, -0.35)]);
  for (const f of e.fields) {
    const width = [...f].length + 0.75;
    strokes.push([
      at(x, -0.35),
      at(x + width, -0.35),
      at(x + width, 1.25),
      at(x, 1.25),
      at(x, -0.35),
    ]);
    labels.push(label(x + 0.25, 0, f));
    x += width;
  }
  return { strokes, labels };
}

export function textCorners(label: CadText) {
  const d = vector(label.angle),
    n = normal(d),
    width =
      Math.max(
        0.5,
        [...label.text].reduce((v, c) => v + (c.charCodeAt(0) > 255 ? 1 : 0.62), 0),
      ) * label.size;
  const a = sub(
      sub(label.at, scale(d, label.anchor === 'end' ? width : 0)),
      scale(n, label.size * 0.2),
    ),
    b = add(a, scale(d, width)),
    c = add(b, scale(n, label.size * 1.2));
  return [a, b, c, add(a, scale(n, label.size * 1.2)), a];
}

export function mapCadDrawing(drawing: CadDrawing, at: (p: Vec2) => Vec2): CadDrawing {
  const origin = at({ x: 0, y: 0 }),
    reflected = cross(sub(at({ x: 1, y: 0 }), origin), sub(at({ x: 0, y: 1 }), origin)) < 0;
  return {
    strokes: drawing.strokes.map((path) => path.map(at)),
    labels: drawing.labels.map((l) => ({
      ...l,
      at: at(l.at),
      angle: angle(scale(sub(at(add(l.at, vector(l.angle))), at(l.at)), reflected ? -1 : 1)),
      anchor: reflected !== (l.anchor === 'end') ? 'end' : 'start',
    })),
  };
}

/** Native SVG elliptic arcs preserve analytic geometry in zoomed views and exported previews. */
export function ellipsePath(doc: GeometryDocument, e: Ellipse, at: (p: Vec2) => Vec2 = (p) => p) {
  const center = point(doc, e.center),
    c = at(center),
    u = sub(at(add(center, vector(e.angle))), c),
    v = sub(at(add(center, normal(vector(e.angle)))), c);
  const start = at(ellipseAt(center, e, e.startAngle)),
    count = Math.abs(e.sweep) === 360 ? 2 : 1;
  const pieces = [`M ${start.x} ${start.y}`];
  for (let i = 1; i <= count; i++) {
    const end = at(ellipseAt(center, e, e.startAngle + (e.sweep * i) / count));
    pieces.push(
      `A ${e.majorRadius} ${e.minorRadius} ${angle(u)} ${Math.abs(e.sweep / count) > 180 ? 1 : 0} ${e.sweep * cross(u, v) > 0 ? 1 : 0} ${end.x} ${end.y}`,
    );
  }
  return pieces.join(' ');
}
