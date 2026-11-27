import { z } from 'zod';
import { isValidTermRange } from './term-lifecycle';

const text = z.string().trim().min(1).max(100),
  id = z.string().min(1).max(100);
const instant = z.iso
  .datetime({ offset: true, error: 'INVALID_TERM_RANGE' })
  .transform((value) => new Date(value));
const termDates = { startsAt: instant, endsAt: instant };
const offeringUpdate = z
  .object({
    operation: z.literal('update-offering'),
    schoolId: id,
    offeringId: id,
    term: text.optional(),
    archived: z.boolean().optional(),
    startsAt: instant.optional(),
    endsAt: instant.optional(),
  })
  .transform((input, ctx) => {
    const { startsAt, endsAt, term, archived } = input;
    if (startsAt && endsAt) return { ...input, startsAt, endsAt };
    if (
      archived !== undefined &&
      startsAt === undefined &&
      endsAt === undefined &&
      term === undefined
    )
      return { ...input, startsAt, endsAt, term, archived };
    ctx.addIssue({ code: 'custom', message: 'INVALID_TERM_RANGE', path: ['endsAt'] });
    return z.NEVER;
  });

const organizationCommand = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create-school'),
    name: text,
    administratorName: text,
    proof: z.string(),
  }),
  z.object({ operation: z.literal('rename-school'), id, name: text, proof: z.string() }),
  z.object({
    operation: z.literal('create-school-admin'),
    schoolId: id,
    name: text,
    proof: z.string(),
  }),
  z.object({
    operation: z.literal('create-offering'),
    schoolId: id,
    courseId: id,
    term: text,
    ...termDates,
  }),
  z.object({
    operation: z.literal('update-course'),
    schoolId: id,
    courseId: id,
    title: text.optional(),
    code: text.optional(),
    archived: z.boolean().optional(),
  }),
  offeringUpdate,
  z.object({ operation: z.literal('create-teacher'), schoolId: id, name: text }),
  z.object({
    operation: z.literal('create-course'),
    schoolId: id,
    title: text,
    code: text,
  }),
  z.object({
    operation: z.literal('create-class'),
    schoolId: id,
    offeringId: id,
    name: text,
    teacherId: id,
  }),
  z.object({
    operation: z.literal('upsert-student'),
    schoolId: id,
    name: text,
    studentNumber: text,
    classIds: z.array(id).max(50),
  }),
  z.object({
    operation: z.literal('reset-password'),
    schoolId: id.optional(),
    id,
    proof: z.string(),
  }),
  z.object({
    operation: z.literal('update-account'),
    schoolId: id.optional(),
    id,
    proof: z.string(),
    name: text.optional(),
    studentNumber: text.optional(),
    active: z.boolean().optional(),
  }),
  z.object({
    operation: z.literal('set-school-active'),
    id,
    active: z.boolean(),
    proof: z.string(),
  }),
  z.object({
    operation: z.literal('membership'),
    schoolId: id.optional(),
    classId: id,
    studentId: id,
    joined: z.boolean(),
  }),
  z.object({
    operation: z.literal('update-class'),
    schoolId: id.optional(),
    fromTeacherId: id.optional(),
    name: text.optional(),
    classId: id,
    teacherId: id.optional(),
    archived: z.boolean().optional(),
    proof: z.string(),
  }),
]);

export const OrganizationCommand = organizationCommand.refine(
  (input) => {
    if (!('startsAt' in input)) return true;
    const { startsAt, endsAt } = input;
    return (
      !(startsAt instanceof Date && endsAt instanceof Date) || isValidTermRange(startsAt, endsAt)
    );
  },
  { error: 'INVALID_TERM_RANGE', path: ['endsAt'] },
);
