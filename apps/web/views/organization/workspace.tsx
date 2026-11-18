import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ensure, type Actor } from '@tuheng/domain';
import { PageTitle } from '@tuheng/ui';
import {
  selectedSchool,
  organizationSchool,
  offeringDetail,
} from '../../../../packages/infrastructure/src/organization-queries';
import { OrganizationCommands } from '../../components/organization/OrganizationCommands';
import { CredentialDelivery } from '../../components/identity/CredentialDelivery';
import { RosterImportWizard } from '../../components/identity/RosterImportWizard';
import { Classes, Catalog } from './catalog';
import { ChooseSchool, href, type Params } from './navigation';
import { People, Schools, SchoolDashboard } from './people';
export async function organizationWorkspace(
  a: Actor,
  area: string,
  segments: string[],
  search: Params,
) {
  const section = segments[0],
    path = '/' + area + '/' + section;
  ensure(a.kind, 'IDENTITY_REQUIRED', 403);
  if (!['classes', 'organization'].includes(section) && segments.length !== 1) notFound();
  if (['teachers', 'students'].includes(section))
    redirect(
      href('/' + area + '/' + (area === 'teacher' ? 'classes' : 'users'), {
        ...search,
        kind: section === 'students' ? 'STUDENT' : 'TEACHER',
      }),
    );
  const identity = { id: a.id, kind: a.kind, schoolId: a.schoolId };
  if (section === 'schools' && area === 'admin')
    return (
      <OrganizationCommands identity={identity} schoolId="">
        {await Schools({ a, path, search })}
      </OrganizationCommands>
    );
  const title = {
    organization: '课程与开课学期',
    classes: '教学班及成员',
    users: '用户管理',
    delivery: '凭据交付',
    imports: '名单导入',
  }[section as 'organization'];
  if (area === 'admin' && (!search.schoolId || search.choose))
    return ChooseSchool({ a, path, search, title });
  const schoolId = selectedSchool(a, search.schoolId),
    school = await organizationSchool(a, schoolId);
  const data = { a, area, schoolId, segments, search },
    scope = (
      <nav className="row-actions organization-scope" aria-label="当前管理范围">
        <strong>{school.name}</strong>
        <span>{school.code}</span>
        {area === 'admin' && <Link href={href(path, { choose: '1' })}>切换学校</Link>}
      </nav>
    );
  if (section === 'dashboard' && area === 'school') return SchoolDashboard({ a, schoolId });
  if (section === 'imports') {
    const o = search.offeringId ? await offeringDetail(a, schoolId, search.offeringId) : null;
    ensure(!o || (!o.archived && !o.course.archived), 'CATALOG_ARCHIVED', 409);
    return (
      <>
        {scope}
        <PageTitle
          title="名单导入"
          action={<Link href={href('/' + area + '/delivery', { schoolId })}>凭据交付</Link>}
        />
        <RosterImportWizard
          key={schoolId + ':' + (o?.id ?? '')}
          schoolId={schoolId}
          teacher={area === 'teacher'}
          initialOffering={o ? { id: o.id, name: o.course.title + ' · ' + o.term } : undefined}
        />
      </>
    );
  }
  if (section === 'delivery')
    return (
      <>
        {scope}
        <PageTitle
          title="凭据交付"
          action={<Link href={href('/' + area + '/imports', { schoolId })}>名单导入</Link>}
        />
        <CredentialDelivery
          key={schoolId}
          schoolId={schoolId}
          batchId={search.batchId}
          siteAdmin={area === 'admin'}
        />
      </>
    );
  let content;
  if (section === 'classes') content = await Classes(data);
  else if (section === 'organization' && area !== 'teacher') content = await Catalog(data);
  else if (section === 'users' && area !== 'teacher') content = await People({ ...data, path });
  else notFound();
  return (
    <OrganizationCommands key={schoolId} identity={identity} schoolId={schoolId}>
      {scope}
      {content}
    </OrganizationCommands>
  );
}
