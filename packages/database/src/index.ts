import { PrismaClient, Prisma } from '@prisma/client';
import { SafePrismaPg } from './pg-adapter';
import type {
  AnnouncementDirectory,
  DataPort,
  DeadlineCandidate,
  Entities,
  Table,
  Where,
} from '@tuheng/domain';
const globalDb = globalThis as unknown as { tuhengDb?: PrismaClient };
export const prisma =
  globalDb.tuhengDb ??
  new PrismaClient({
    adapter: new SafePrismaPg(
      { connectionString: process.env.DATABASE_URL! },
      {
        schema: process.env.DATABASE_URL
          ? (new URL(process.env.DATABASE_URL).searchParams.get('schema') ?? 'public')
          : 'public',
      },
    ),
  });
if (process.env.NODE_ENV !== 'production') globalDb.tuhengDb = prisma;
interface Delegate {
  findUnique(a: unknown): Promise<unknown>;
  findMany(a: unknown): Promise<unknown[]>;
  create(a: unknown): Promise<unknown>;
  createMany(a: unknown): Promise<unknown>;
  update(a: unknown): Promise<unknown>;
}
class PrismaDataPort implements DataPort {
  constructor(
    private client: PrismaClient | Prisma.TransactionClient = prisma,
    private nested = false,
  ) {}
  private table(name: Table) {
    return (this.client as unknown as Record<Table, Delegate>)[name];
  }
  async get<K extends Table>(name: K, id: string) {
    return (await this.table(name).findUnique({ where: { id } })) as Entities[K] | null;
  }
  async list<K extends Table>(
    name: K,
    where: Where<Entities[K]> = {},
    options: { take?: number; orderBy?: keyof Entities[K]; desc?: boolean } = {},
  ) {
    return (await this.table(name).findMany({
      where,
      take: options.take ?? 10000,
      ...(options.orderBy ? { orderBy: { [options.orderBy]: options.desc ? 'desc' : 'asc' } } : {}),
    })) as Entities[K][];
  }
  async create<K extends Table>(name: K, data: Partial<Entities[K]>) {
    return (await this.table(name).create({ data })) as Entities[K];
  }
  async createMany<K extends Table>(name: K, rows: Partial<Entities[K]>[]) {
    if (rows.length) await this.table(name).createMany({ data: rows });
  }
  async lockNotificationRecipients(ids: string[]) {
    if (ids.length)
      await this.client.$queryRaw`SELECT "id" FROM "User" WHERE "id" IN (${Prisma.join(ids)})
        ORDER BY "id" FOR NO KEY UPDATE`;
  }
  async questionVersionsUsingAsset(id: string) {
    return (await this.client.questionVersion.findMany({
      where: {
        OR: [
          { assetIds: { has: id } },
          { reference: { path: ['assetIds'], array_contains: [id] } },
        ],
      },
    })) as unknown as Entities['questionVersion'][];
  }
  async announcementPeople(directory: AnnouncementDirectory, take: number) {
    const roles = ['STUDENT', 'TEACHER'];
    const classes = (kind: string, classIds: string[]): Prisma.UserWhereInput =>
      kind === 'STUDENT'
        ? { kind, enrollments: { some: { classId: { in: classIds } } } }
        : { kind, grants: { some: { classId: { in: classIds } } } };
    const conditions: Prisma.UserWhereInput[] = [
      {
        active: true,
        school: { is: { active: true } },
        kind: { in: directory.kind ? [directory.kind] : roles },
      },
    ];
    if (directory.schoolId) conditions.push({ schoolId: directory.schoolId });
    if (directory.permittedClassIds)
      conditions.push({ OR: roles.map((kind) => classes(kind, directory.permittedClassIds!)) });
    if (directory.classId)
      conditions.push({ OR: roles.map((kind) => classes(kind, [directory.classId!])) });
    if (directory.q) {
      const match = { contains: directory.q, mode: 'insensitive' as const };
      conditions.push({ OR: [{ name: match }, { studentNumber: match }, { loginId: match }] });
    }
    if (directory.after) conditions.push({ id: { gt: directory.after } });
    if (directory.selection) {
      const s = directory.selection;
      conditions.push({
        id: { notIn: s.excludeIds },
        OR: [
          { id: { in: s.personIds } },
          s.allStudents ? { kind: 'STUDENT' } : classes('STUDENT', s.studentClassIds),
          s.allTeachers ? { kind: 'TEACHER' } : classes('TEACHER', s.teacherClassIds),
        ],
      });
    }
    const rows = await this.client.user.findMany({
      where: { AND: conditions },
      orderBy: { id: 'asc' },
      take,
      select: { id: true, kind: true, name: true, school: { select: { id: true, name: true } } },
    });
    return rows.flatMap(({ school, ...user }) =>
      school ? [{ ...user, schoolId: school.id, schoolName: school.name }] : [],
    );
  }
  async deadlineCandidates(now: Date, after: string, take: number) {
    const within = new Date(+now + 24 * 3600_000);
    const joinedBefore = new Date(+now - 30 * 60_000);
    return this.client.$queryRaw<DeadlineCandidate[]>`
      SELECT r.id AS "recipientId", r."studentId", a.id, a."schoolId", a.title, a."dueAt", work.missing
      FROM "Assignment" a
      JOIN "AssignmentRecipient" r ON r."assignmentId" = a.id AND r."schoolId" = a."schoolId"
      JOIN "School" school ON school.id = r."schoolId" AND school.active
      JOIN "User" u ON u.id = r."studentId" AND u."schoolId" = r."schoolId" AND u.active AND u.kind = 'STUDENT'
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS missing
        FROM "AssignmentItem" i
        WHERE i."assignmentId" = a.id AND NOT EXISTS (
          SELECT 1 FROM "Submission" s JOIN "SubmissionAttempt" attempt ON attempt."submissionId" = s.id
          WHERE s."itemId" = i.id AND s."userId" = r."studentId"
            AND attempt."ownerId" = r."studentId" AND attempt.source = 'ASSIGNMENT'
        )
      ) work
      WHERE a.status = 'PUBLISHED' AND a."audienceRevision" > 0
        AND a."startsAt" <= ${now} AND a."dueAt" > ${now} AND a."dueAt" <= ${within}
        AND r.active AND r."activeSince" <= ${joinedBefore} AND r.id > ${after} AND work.missing > 0
        AND NOT EXISTS (
          SELECT 1 FROM "UserNotification" n WHERE n."userId" = r."studentId" AND n.kind = 'ASSIGNMENT_DUE'
            AND n."resourceType" = 'ASSIGNMENT' AND n."resourceId" = a.id AND n."deadlineAt" = a."dueAt"
        )
      ORDER BY r.id LIMIT ${take}`;
  }
  async update<K extends Table>(name: K, id: string, data: Partial<Entities[K]>) {
    return (await this.table(name).update({ where: { id }, data })) as Entities[K];
  }
  async transaction<T>(work: (tx: DataPort) => Promise<T>): Promise<T> {
    if (this.nested) return work(this);
    for (let i = 0; i < 8; i++) {
      try {
        return await prisma.$transaction((tx) => work(new PrismaDataPort(tx, true)), {
          isolationLevel: 'Serializable',
          timeout: 15000,
        });
      } catch (e) {
        if (
          ((e instanceof Prisma.PrismaClientKnownRequestError &&
            ['P2034', 'P2002'].includes(e.code)) ||
            (e instanceof Error &&
              e.name === 'DriverAdapterError' &&
              (e as Error & { cause?: { kind?: string } }).cause?.kind ===
                'TransactionWriteConflict')) &&
          i < 7
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(150, 10 * 2 ** i) + Math.floor(Math.random() * 20)),
          );
          continue;
        }
        throw e;
      }
    }
    throw new Error('TRANSACTION_RETRY_EXHAUSTED');
  }
}
export const database: DataPort = new PrismaDataPort();
