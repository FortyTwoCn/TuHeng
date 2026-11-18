import * as queries from '../../../../../../packages/infrastructure/src/organization-queries';
import { prisma } from '@tuheng/database';
import { ensure } from '@tuheng/domain';
import { actor } from '../../../../lib/auth';
import { checkOrigin, errorResponse, limitedBody } from '../../../../lib/http';
import { listCredentialDeliveries } from '../../../../../../packages/infrastructure/src/credential-delivery';
import * as org from '../../../../../../packages/infrastructure/src/organization';
import { OrganizationCommand } from '@tuheng/contracts';
import * as catalog from '../../../../../../packages/infrastructure/src/teaching-catalog';
export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  try {
    checkOrigin(request);
    const a = await actor('STAFF'),
      { operation } = await context.params;
    const input = OrganizationCommand.parse({
      ...JSON.parse((await limitedBody(request, 20000)).toString()),
      operation,
    });
    if (
      ['update-account', 'reset-password', 'membership', 'update-class'].includes(
        input.operation,
      ) &&
      a.kind === 'SITE_ADMIN'
    )
      ensure('schoolId' in input && input.schoolId, 'SELECT_SCHOOL_REQUIRED');
    if ('classId' in input && input.schoolId)
      ensure(
        (await org.requireManagedClass(a, input.classId, prisma, true)).schoolId === input.schoolId,
        'SCOPE_MISMATCH',
        403,
      );
    let data: unknown;
    switch (input.operation) {
      case 'create-school':
        data = await org.createSchoolWithAdmin(a, input, input.proof);
        break;
      case 'rename-school':
        data = await org.renameSchool(a, input.id, input.name, input.proof);
        break;
      case 'create-teacher':
        data = await org.createTeacher(a, input);
        break;
      case 'create-school-admin':
        data = await org.createSchoolAdministrator(a, input, input.proof);
        break;
      case 'create-offering':
        data = await catalog.createOffering(a, input);
        break;
      case 'update-offering':
        data = await catalog.updateOffering(a, input);
        break;
      case 'update-course':
        data = await catalog.updateCourse(a, input);
        break;
      case 'create-course':
        data = await catalog.createCourse(a, input);
        break;
      case 'create-class':
        data = await org.createClass(a, input);
        break;
      case 'upsert-student':
        data = await org.upsertStudentMembership(a, input);
        break;
      case 'reset-password':
        data = await org.resetAccountPassword(a, input.id, input.proof, input.schoolId);
        break;
      case 'update-account':
        data = await org.updateAccount(
          a,
          input.id,
          { name: input.name, studentNumber: input.studentNumber, active: input.active },
          input.proof,
          input.schoolId,
        );
        break;
      case 'set-school-active':
        data = await org.setSchoolActive(a, input.id, input.active, input.proof);
        break;
      case 'membership':
        data = await org.changeClassMembership(a, input.classId, input.studentId, input.joined);
        break;
      case 'update-class':
        data = await org.updateClass(
          a,
          input.classId,
          {
            teacherId: input.teacherId,
            fromTeacherId: input.fromTeacherId,
            name: input.name,
            archived: input.archived,
          },
          input.proof,
        );
        break;
    }
    return Response.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function GET(request: Request, context: { params: Promise<{ operation: string }> }) {
  try {
    const a = await actor('STAFF'),
      { operation } = await context.params,
      url = new URL(request.url);
    const search = Object.fromEntries(url.searchParams);
    const result = (data: unknown) =>
      Response.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
    if (operation === 'schools') return result(await queries.searchSchools(a, search));
    const schoolId = queries.selectedSchool(a, search.schoolId);
    switch (operation) {
      case 'scope':
        return result(await queries.organizationSchool(a, schoolId));
      case 'overview':
        return result(await queries.schoolOverview(a, schoolId));
      case 'courses':
        return result(await queries.courseList(a, schoolId, search));
      case 'offerings':
        return result(await queries.offeringList(a, schoolId, search));
      case 'classes':
        return result(await queries.classList(a, schoolId, search));
      case 'accounts':
        return result(await queries.people(a, schoolId, search));
      case 'deliveries':
        await queries.organizationSchool(a, schoolId);
        return result(
          await listCredentialDeliveries(
            a,
            schoolId,
            Math.max(0, Math.trunc(Number(search.page) || 0)),
          ),
        );
      default:
        return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
  } catch (e) {
    return errorResponse(e);
  }
}
