import { database, prisma } from '@tuheng/database';
import type { AnnouncementAudience } from '@tuheng/contracts';
import { announcementScope, type Actor } from '@tuheng/domain';

export async function announcementClasses(
  actor: Actor,
  scope: AnnouncementAudience['scope'],
  q?: string,
  after?: string,
) {
  const directory = await announcementScope(database, actor, scope);
  const items = await prisma.teachingClass.findMany({
    where: {
      archived: false,
      schoolId: directory.schoolId ?? { not: null },
      id: { in: directory.permittedClassIds, gt: after },
      offering: {
        archived: false,
        course: { archived: false, schoolId: directory.schoolId ?? { not: null } },
      },
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { offering: { term: { contains: q, mode: 'insensitive' } } },
              { offering: { course: { title: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      schoolId: true,
      offering: { select: { term: true, course: { select: { title: true, schoolId: true } } } },
    },
    orderBy: { id: 'asc' },
    take: 16,
  });
  const schools = await prisma.school.findMany({
    where: {
      id: { in: items.flatMap(({ schoolId }) => (schoolId ? [schoolId] : [])) },
      active: true,
    },
    select: { id: true, name: true },
  });
  return {
    items: items.slice(0, 15).flatMap((cls) => {
      const school = schools.find((s) => s.id === cls.schoolId);
      return school && cls.offering.course.schoolId === cls.schoolId
        ? [
            {
              id: cls.id,
              name: cls.name,
              context: [school.name, cls.offering.course.title, cls.offering.term].join(' · '),
            },
          ]
        : [];
    }),
    nextCursor: items.length === 16 ? items[14].id : null,
  };
}
