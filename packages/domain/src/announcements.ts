import { AnnouncementInput, type AnnouncementAudience } from '@tuheng/contracts';
import type {
  Actor,
  AnnouncementDirectory,
  AnnouncementPerson,
  DataPort,
  Entities,
} from './entities';
import { teachingScope } from './audience';
import { audit, ensure } from './policy';
import { recordNotifications } from './notification-events';
import { requireSchoolScope } from './identity';

export async function announcementScope(
  db: DataPort,
  actor: Actor,
  scope: AnnouncementAudience['scope'],
): Promise<AnnouncementDirectory> {
  ensure(
    !actor.onboarding && ['SITE_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(actor.kind ?? ''),
    'ANNOUNCEMENT_FORBIDDEN',
    403,
  );
  if (scope.kind === 'PLATFORM') {
    ensure(actor.kind === 'SITE_ADMIN', 'ANNOUNCEMENT_SCOPE_FORBIDDEN', 403);
    return { schoolId: null } as const;
  }
  requireSchoolScope(actor, scope.schoolId);
  const { school, classes } = await teachingScope(db, actor, scope.schoolId);
  return {
    schoolId: school.id,
    ...(actor.kind === 'TEACHER' ? { permittedClassIds: classes.map((cls) => cls.id) } : {}),
  };
}

async function validateClassTargets(db: DataPort, directory: AnnouncementDirectory, ids: string[]) {
  if (!ids.length) return;
  if (directory.permittedClassIds) {
    const allowed = new Set(directory.permittedClassIds);
    ensure(
      ids.every((id) => allowed.has(id)),
      'ANNOUNCEMENT_SCOPE_FORBIDDEN',
      403,
    );
    return;
  }
  const classes = await db.list('teachingClass', { id: { in: ids }, archived: false });
  const offerings = await db.list('courseOffering', {
    id: { in: classes.map((cls) => cls.offeringId) },
    archived: false,
  });
  const courses = await db.list('course', {
    id: { in: offerings.map((o) => o.courseId) },
    archived: false,
  });
  const schools = await db.list('school', {
    id: { in: classes.flatMap((cls) => (cls.schoolId ? [cls.schoolId] : [])) },
    active: true,
  });
  ensure(
    classes.length === ids.length &&
      classes.every((cls) => {
        const offering = offerings.find((o) => o.id === cls.offeringId);
        return (
          schools.some((s) => s.id === cls.schoolId) &&
          (!directory.schoolId || directory.schoolId === cls.schoolId) &&
          courses.some((c) => c.id === offering?.courseId && c.schoolId === cls.schoolId)
        );
      }),
    'ANNOUNCEMENT_SCOPE_FORBIDDEN',
    403,
  );
}

export async function announcementPeoplePage(
  db: DataPort,
  actor: Actor,
  scope: AnnouncementAudience['scope'],
  filters: Pick<AnnouncementDirectory, 'q' | 'kind' | 'classId' | 'after'>,
) {
  const directory = await announcementScope(db, actor, scope);
  await validateClassTargets(db, directory, filters.classId ? [filters.classId] : []);
  const rows = await db.announcementPeople({ ...directory, ...filters }, 26);
  return { items: rows.slice(0, 25), nextCursor: rows.length > 25 ? rows[24].id : null };
}

async function recipients(db: DataPort, actor: Actor, selection: AnnouncementAudience) {
  const directory = await announcementScope(db, actor, selection.scope);
  await validateClassTargets(db, directory, [
    ...new Set([...selection.studentClassIds, ...selection.teacherClassIds]),
  ]);
  const people: AnnouncementPerson[] = [];
  const explicitlySelected = new Set([...selection.personIds, ...selection.excludeIds]);
  if (explicitlySelected.size) {
    // Validate exclusions as well as direct selections without widening the search scope.
    const found = await db.announcementPeople(
      {
        ...directory,
        selection: {
          ...selection,
          allStudents: false,
          allTeachers: false,
          studentClassIds: [],
          teacherClassIds: [],
          excludeIds: [],
          personIds: [...explicitlySelected],
        },
      },
      explicitlySelected.size,
    );
    ensure(found.length === explicitlySelected.size, 'ANNOUNCEMENT_SCOPE_FORBIDDEN', 403);
  }
  let after: string | undefined;
  do {
    const page = await db.announcementPeople({ ...directory, selection, after }, 500);
    people.push(...page);
    after = page.length === 500 ? page[499].id : undefined;
  } while (after);
  return { directory, people };
}

async function previewFingerprint(selection: AnnouncementAudience, people: AnnouncementPerson[]) {
  const scope =
    selection.scope.kind === 'PLATFORM' ? ['PLATFORM'] : ['SCHOOL', selection.scope.schoolId];
  const input = new TextEncoder().encode(
    JSON.stringify([
      scope,
      selection.allStudents,
      selection.allTeachers,
      [...selection.studentClassIds].sort(),
      [...selection.teacherClassIds].sort(),
      [...selection.personIds].sort(),
      [...selection.excludeIds].sort(),
      people.map(({ id, schoolId, kind }) => [id, schoolId, kind]),
    ]),
  );
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('');
}
export async function previewAnnouncement(db: DataPort, actor: Actor, input: unknown) {
  const { audience } = AnnouncementInput.parse(input);
  return db.transaction(async (tx) => {
    const { people } = await recipients(tx, actor, audience);
    return {
      count: people.length,
      teachers: people.filter((p) => p.kind === 'TEACHER').length,
      fingerprint: await previewFingerprint(audience, people),
    };
  });
}

export async function saveAnnouncement(
  db: DataPort,
  actor: Actor,
  input: unknown,
  previous?: { id: string; revision: number },
) {
  const data = AnnouncementInput.parse(input);
  return db.transaction(async (tx) => {
    const scope = await announcementScope(tx, actor, data.audience.scope);
    if (!previous) {
      const result = await tx.create('announcement', {
        ...data,
        schoolId: scope.schoolId,
        creatorId: actor.id,
      });
      await audit(tx, actor, 'ANNOUNCEMENT_DRAFT_SAVED', result.id);
      return result;
    }
    const record = await tx.get('announcement', previous.id);
    ensure(record?.creatorId === actor.id, 'ANNOUNCEMENT_FORBIDDEN', 403);
    ensure(
      !record.publishedAt && record.revision === previous.revision,
      'ANNOUNCEMENT_CHANGED',
      409,
    );
    const result = await tx.update('announcement', record.id, {
      ...data,
      schoolId: scope.schoolId,
      revision: record.revision + 1,
    });
    await audit(tx, actor, 'ANNOUNCEMENT_DRAFT_SAVED', result.id);
    return result;
  });
}

export async function publishAnnouncement(
  db: DataPort,
  actor: Actor,
  input: {
    id: string;
    revision: number;
    fingerprint: string;
  },
) {
  return db.transaction(async (tx) => {
    const record = await tx.get('announcement', input.id);
    ensure(record?.creatorId === actor.id, 'ANNOUNCEMENT_FORBIDDEN', 403);
    await announcementScope(tx, actor, record.audience.scope);
    ensure(record.revision === input.revision, 'ANNOUNCEMENT_CHANGED', 409);
    if (record.publishedAt) return { id: record.id };
    const { people } = await recipients(tx, actor, record.audience);
    ensure(people.length, 'ANNOUNCEMENT_EMPTY');
    ensure(
      (await previewFingerprint(record.audience, people)) === input.fingerprint,
      'ANNOUNCEMENT_AUDIENCE_CHANGED',
      409,
    );
    const now = new Date();
    await tx.update('announcement', record.id, { publishedAt: now });
    await tx.createMany(
      'announcementRecipient',
      people.map(({ id, schoolId }) => ({
        announcementId: record.id,
        userId: id,
        schoolId,
        revision: record.revision,
      })),
    );
    for (let offset = 0; offset < people.length; offset += 500) {
      await recordNotifications(
        tx,
        people.slice(offset, offset + 500).map((person) => person.id),
        {
          kind: 'ANNOUNCEMENT_PUBLISHED',
          eventKey: `announcement:${record.id}:${record.revision}`,
          resourceType: 'ANNOUNCEMENT',
          resourceId: record.id,
          schoolId: record.schoolId,
          title: record.title,
          summary: record.body.replace(/\s+/g, ' ').slice(0, 160),
          revision: record.revision,
        },
        now,
      );
    }
    await audit(tx, actor, 'ANNOUNCEMENT_PUBLISHED', record.id, {
      count: people.length,
      revision: record.revision,
    });
    return { id: record.id };
  });
}

export async function announcementForRecipient(
  db: DataPort,
  actor: Actor,
  record: Entities['announcement'],
) {
  if (!record.publishedAt || !actor.schoolId) return false;
  return (
    (
      await db.list(
        'announcementRecipient',
        {
          announcementId: record.id,
          userId: actor.id,
          schoolId: actor.schoolId,
          revision: record.revision,
        },
        { take: 1 },
      )
    ).length > 0
  );
}
