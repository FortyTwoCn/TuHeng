import Link from 'next/link';
import { Plus, Megaphone } from 'lucide-react';
import { Badge, PageTitle } from '@tuheng/ui';
import { AnnouncementAudience, type AnnouncementInput } from '@tuheng/contracts';
import { database, prisma } from '@tuheng/database';
import { announcementForRecipient, announcementScope, ensure, type Actor } from '@tuheng/domain';
import { AnnouncementEditor } from '../components/notifications/AnnouncementEditor';
import { date } from './shared';

export async function AnnouncementsView({
  a,
  area,
  segment,
  cursor,
}: {
  a: Actor;
  area: string;
  segment?: string;
  cursor?: string;
}) {
  const root = `/${area}/announcements`;
  if (!segment) {
    ensure(a.kind !== 'STUDENT', 'NOT_FOUND', 404);
    const records = await prisma.announcement.findMany({
      where: {
        creatorId: a.id,
        ...(a.kind !== 'SITE_ADMIN' ? { schoolId: a.schoolId ?? '' } : {}),
        id: cursor ? { lt: cursor } : undefined,
      },
      select: {
        id: true,
        title: true,
        schoolId: true,
        publishedAt: true,
        updatedAt: true,
        _count: { select: { recipients: true } },
      },
      orderBy: { id: 'desc' },
      take: 26,
    });
    return (
      <>
        <PageTitle
          title="公告管理"
          description="向授权范围内的学生和教师发布消息。"
          action={
            <Link className="button primary" href={root + '/new'}>
              <Plus size={17} aria-hidden="true" /> 新建公告
            </Link>
          }
        />
        <section className="panel profile-panel" aria-label="我的公告">
          <ul className="announcement-directory announcement-history">
            {records.slice(0, 25).map((record) => (
              <li key={record.id}>
                <div>
                  <Link href={root + '/' + record.id}>
                    <strong>{record.title}</strong>
                  </Link>
                  <small>
                    {date(record.publishedAt ?? record.updatedAt)}
                    {record.publishedAt ? ` · ${record._count.recipients} 位接收人` : ''}
                  </small>
                </div>
                <Badge tone={record.publishedAt ? 'green' : 'gray'}>
                  {record.publishedAt ? '已发布' : '草稿'}
                </Badge>
              </li>
            ))}
          </ul>
          {!records.length && (
            <div className="account-empty">
              <Megaphone size={25} aria-hidden="true" />
              <strong>暂无公告</strong>
            </div>
          )}
          {records.length > 25 && (
            <Link
              href={root + '?before=' + encodeURIComponent(records[24].id)}
              className="button secondary"
            >
              下一页
            </Link>
          )}
          {cursor && (
            <Link href={root} className="button ghost">
              返回首页
            </Link>
          )}
        </section>
      </>
    );
  }
  const record = segment === 'new' ? null : await database.get('announcement', segment);
  if (segment !== 'new') ensure(record, 'NOT_FOUND', 404);
  const manager = record?.creatorId === a.id && a.kind !== 'STUDENT';
  if (record) {
    if (manager)
      await announcementScope(database, a, AnnouncementAudience.parse(record.audience).scope);
    else ensure(await announcementForRecipient(database, a, record), 'NOT_FOUND', 404);
    if (record.publishedAt) {
      const count = manager
        ? await prisma.announcementRecipient.count({ where: { announcementId: record.id } })
        : undefined;
      return (
        <>
          <PageTitle
            title={record.title}
            description={`${date(record.publishedAt)} · 已发布${count !== undefined ? ` · ${count} 位接收人` : ''}`}
            action={
              <Link className="button secondary" href={manager ? root : `/${area}/notifications`}>
                {manager ? '返回公告管理' : '返回通知中心'}
              </Link>
            }
          />
          <article className="panel profile-panel announcement-body">{record.body}</article>
        </>
      );
    }
    ensure(manager, 'NOT_FOUND', 404);
  }
  ensure(
    a.kind === 'SITE_ADMIN' || a.kind === 'SCHOOL_ADMIN' || a.kind === 'TEACHER',
    'NOT_FOUND',
    404,
  );
  const initial: AnnouncementInput = record
    ? {
        title: record.title,
        body: record.body,
        audience: AnnouncementAudience.parse(record.audience),
      }
    : {
        title: '',
        body: '',
        audience: {
          scope: { kind: 'SCHOOL', schoolId: a.schoolId ?? '' },
          allStudents: false,
          allTeachers: false,
          studentClassIds: [],
          teacherClassIds: [],
          personIds: [],
          excludeIds: [],
        },
      };
  const scopeId = initial.audience.scope.kind === 'SCHOOL' ? initial.audience.scope.schoolId : null;
  const school = scopeId ? await database.get('school', scopeId) : null;
  return (
    <>
      <PageTitle
        title={record ? '编辑公告草稿' : '新建公告'}
        action={
          <Link className="button secondary" href={root}>
            返回公告管理
          </Link>
        }
      />
      <AnnouncementEditor
        initial={initial}
        actorKind={a.kind}
        area={area}
        scopeName={school?.name}
        existing={record ? { id: record.id, revision: record.revision } : undefined}
      />
    </>
  );
}
