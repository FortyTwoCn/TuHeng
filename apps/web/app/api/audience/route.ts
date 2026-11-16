import { z } from 'zod';
import { AudienceSelection } from '@tuheng/contracts';
import { database, prisma } from '@tuheng/database';
import {
  audienceScope,
  resolveAudience,
  ensure,
  requireAssignmentManager,
  reviseAssignmentAudience,
} from '@tuheng/domain';
import { actor } from '../../../lib/auth';
import { checkOrigin, errorResponse, limitedBody } from '../../../lib/http';
const RequestInput = z.object({
  operation: z.enum(['BROWSE', 'TOGGLE', 'RESOLVE']),
  selection: AudienceSelection,
  query: z.string().max(100).default(''),
  page: z.number().int().min(0).max(10000).default(0),
  teacherId: z.string().optional(),
  classId: z.string().optional(),
  selectedOnly: z.boolean().default(false),
  target: z.enum(['ALL', 'TEACHER', 'CLASS', 'STUDENT']).optional(),
  targetId: z.string().optional(),
  checked: z.boolean().optional(),
});
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const a = await actor('STAFF'),
      raw = JSON.parse((await limitedBody(request, 500000)).toString());
    if (raw.operation === 'REVISE') {
      const p = z
        .object({
          id: z.string(),
          selection: AudienceSelection,
          revision: z.number().int(),
          rosterVersion: z.number().int(),
          reviewerIds: z.array(z.string()).min(1).max(50),
        })
        .parse(raw);
      return Response.json({
        data: await reviseAssignmentAudience(
          database,
          a,
          p.id,
          p.selection,
          p.revision,
          p.rosterVersion,
          p.reviewerIds,
        ),
      });
    }
    const b = RequestInput.parse(raw),
      scope = await audienceScope(database, a, b.selection.schoolId),
      resolved = await resolveAudience(database, a, b.selection),
      selected = new Set(resolved.recipients.map((r) => r.studentId));
    const grants = await database.list('teachingGrant', {
      classId: { in: scope.classes.map((c) => c.id) },
    });
    const teachers = await prisma.user.findMany({
      where: {
        schoolId: b.selection.schoolId,
        kind: 'TEACHER',
        active: true,
        ...(a.kind === 'TEACHER' ? { id: a.id } : {}),
      },
      select: { id: true, name: true, loginId: true },
      orderBy: { name: 'asc' },
    });
    const classPeople = (ids: string[]) =>
      new Set(scope.members.filter((m) => ids.includes(m.classId)).map((m) => m.userId));
    const teacherClasses = (id: string) =>
      scope.classes
        .filter((c) => grants.some((g) => g.classId === c.id && g.userId === id))
        .map((c) => c.id);
    if (b.operation === 'TOGGLE') {
      const selection = structuredClone(b.selection);
      let ids: string[] = [];
      if (b.target === 'ALL') {
        selection.include = { allEligibleInScope: !!b.checked, classIds: [], studentIds: [] };
        selection.exclude.studentIds = [];
        return Response.json({ data: { selection } });
      }
      if (b.target === 'TEACHER') {
        ensure(
          teachers.some((t) => t.id === b.targetId),
          'AUDIENCE_SCOPE_FORBIDDEN',
          403,
        );
        ids = [...classPeople(teacherClasses(b.targetId!))];
      }
      if (b.target === 'CLASS') {
        ensure(
          scope.classes.some((c) => c.id === b.targetId) ||
            (b.targetId === 'UNASSIGNED' && a.kind !== 'TEACHER'),
          'AUDIENCE_SCOPE_FORBIDDEN',
          403,
        );
        ids =
          b.targetId === 'UNASSIGNED'
            ? scope.students
                .filter((s) => !scope.members.some((m) => m.userId === s.id))
                .map((s) => s.id)
            : [...classPeople([b.targetId!])];
      }
      if (b.target === 'STUDENT') {
        ensure(
          scope.students.some((s) => s.id === b.targetId),
          'AUDIENCE_SCOPE_FORBIDDEN',
          403,
        );
        ids = [b.targetId!];
      }
      ids = ids.filter((id) => scope.students.some((s) => s.id === id));
      if (b.checked) {
        if (b.target === 'CLASS' && b.targetId !== 'UNASSIGNED')
          selection.include.classIds = [...new Set([...selection.include.classIds, b.targetId!])];
        else if (b.target === 'TEACHER')
          selection.include.classIds = [
            ...new Set([...selection.include.classIds, ...teacherClasses(b.targetId!)]),
          ];
        else selection.include.studentIds = [...new Set([...selection.include.studentIds, ...ids])];
        selection.exclude.studentIds = selection.exclude.studentIds.filter(
          (id) => !ids.includes(id),
        );
      } else {
        selection.include.studentIds = selection.include.studentIds.filter(
          (id) => !ids.includes(id),
        );
        selection.exclude.studentIds = [...new Set([...selection.exclude.studentIds, ...ids])];
      }
      return Response.json({ data: { selection } });
    }
    const teacherId = b.teacherId;
    if (teacherId)
      ensure(
        teachers.some((t) => t.id === teacherId),
        'AUDIENCE_SCOPE_FORBIDDEN',
        403,
      );
    let classes = scope.classes.filter(
      (c) => !teacherId || teacherClasses(teacherId).includes(c.id),
    );
    if (b.classId && b.classId !== 'UNASSIGNED')
      ensure(
        classes.some((c) => c.id === b.classId),
        'AUDIENCE_SCOPE_FORBIDDEN',
        403,
      );
    let people = scope.students.filter((s) =>
      b.classId === 'UNASSIGNED'
        ? !scope.members.some((m) => m.userId === s.id)
        : !b.classId || scope.members.some((m) => m.userId === s.id && m.classId === b.classId),
    );
    if (teacherId && !b.classId) {
      const ids = classPeople(teacherClasses(teacherId));
      people = people.filter((s) => ids.has(s.id));
    }
    if (b.selectedOnly) people = people.filter((s) => selected.has(s.id));
    const query = b.query.toLowerCase();
    people = people.filter(
      (s) => s.name.toLowerCase().includes(query) || (s.studentNumber ?? '').includes(query),
    );
    classes = classes.filter((c) => !b.query || c.name.includes(b.query));
    const count = (ids: Set<string>) => ({
      total: scope.students.filter((s) => ids.has(s.id)).length,
      selected: scope.students.filter((s) => ids.has(s.id) && selected.has(s.id)).length,
    });
    return Response.json(
      {
        data: {
          selection: b.selection,
          rosterVersion: resolved.rosterVersion,
          count: resolved.count,
          eligibleCount: resolved.eligibleCount,
          excluded: resolved.excluded,
          people: people
            .slice(b.page * 30, (b.page + 1) * 30)
            .map((s) => ({
              id: s.id,
              name: s.name,
              studentNumber: s.studentNumber,
              selected: selected.has(s.id),
            })),
          total: people.length,
          teachers: teachers
            .slice(0, 100)
            .map((t) => ({ ...t, ...count(classPeople(teacherClasses(t.id))) })),
          classes: classes
            .slice(0, 100)
            .map((c) => ({ id: c.id, name: c.name, ...count(classPeople([c.id])) })),
          unassigned:
            a.kind === 'TEACHER'
              ? 0
              : scope.students.filter((s) => !scope.members.some((m) => m.userId === s.id)).length,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function GET(request: Request) {
  try {
    const a = await actor('STAFF'),
      id = z.string().parse(new URL(request.url).searchParams.get('assignmentId'));
    const assignment = await database.get('assignment', id);
    ensure(assignment, 'NOT_FOUND', 404);
    await requireAssignmentManager(database, a, assignment);
    ensure(assignment.audience, 'AUDIENCE_REQUIRED');
    const preview = await resolveAudience(database, a, assignment.audience);
    return Response.json(
      {
        data: {
          selection: assignment.audience,
          rosterVersion: preview.rosterVersion,
          count: preview.count,
          people: preview.recipients.slice(0, 30),
          revision: assignment.audienceRevision ?? 0,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
