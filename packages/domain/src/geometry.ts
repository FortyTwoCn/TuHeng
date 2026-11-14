import { GeometryDocument } from '@tuheng/contracts';
import { combineAnswer } from '@tuheng/geometry-core';
import { DomainError, ensure } from './policy';
export function validateAnswerGeometry(stem: unknown, input: unknown) {
  if (input == null) return undefined;
  ensure(stem, 'GEOMETRY_QUESTION_REQUIRED');
  try {
    return combineAnswer(GeometryDocument.parse(stem), input);
  } catch (error) {
    if (error instanceof Error && error.message === 'GEOMETRY_STEM_CHANGED')
      throw new DomainError('GEOMETRY_STEM_CHANGED', 403);
    throw error;
  }
}
