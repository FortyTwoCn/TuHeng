import { expect,it } from 'vitest';
import { GeometryDocument } from '@tuheng/contracts';
import { addProjectionAxis, changedPlaneProjection, createDocument, deleteProjectionAxis } from '@tuheng/geometry-core';

it('uses the actual base or earlier projection axis and validates its retained face, direction and dependencies',()=>{
  const base=createDocument('VHW_PROJECTION');
  const spec={name:'X1',viewName:'V1',method:'PERPENDICULAR' as const,parentId:null,
    retainedViewId:'view-1',replacedViewId:'view-0',referenceEntityId:null,
    referenceAxis:{kind:'baseAxis' as const,axisId:'X' as const},
    anchor:{x:13,y:-9},through:{x:0,y:0},side:1 as const};
  const first=addProjectionAxis(base,spec,'student'),axis=first.auxiliarySystems![0];
  expect(axis.referenceStatus).toBe('SATISFIED');expect(axis.tangent.y).toBe(-1);
  const second=addProjectionAxis(first,{...spec,name:'X2',viewName:'H2',parentId:axis.id,
    retainedViewId:axis.newViewId,replacedViewId:'view-1',referenceAxis:{kind:'projectionAxis',systemId:axis.id},side:-1},'student');
  expect(second.entities).toHaveLength(0);
  expect(second.auxiliarySystems![1].tangent.x).toBe(1);
  expect(()=>deleteProjectionAxis(second,axis.id,'student')).toThrow();
  const d=structuredClone(second);
  d.auxiliarySystems![0].referenceAxis={kind:'projectionAxis',systemId:axis.id};
  expect(GeometryDocument.safeParse(d).success).toBe(false);
  const retained={x:16,y:-21},replaced={x:20,y:5};
  const result=changedPlaneProjection(retained,replaced,axis);
  expect(result.x).toBe(18);
  expect(result.y).toBe(-21);
});
