import { actor } from '../../../lib/auth';
import { checkOrigin, errorResponse, limitedBody } from '../../../lib/http';
import {
  aiCenter,
  AICommands,
  requireAIAdmin,
  saveAIConfiguration,
} from '../../../../../packages/infrastructure/src/ai-admin';
import { prisma } from '@tuheng/database';
export async function GET(request: Request) {
  try {
    const a = await actor('STAFF');
    requireAIAdmin(a);
    const params = new URL(request.url).searchParams;
    if (params.get('view') === 'invocations') {
      const page = Math.max(0, Number(params.get('page')) || 0);
      const where = {
        ...(params.get('schoolId') ? { schoolId: params.get('schoolId')! } : {}),
        ...(params.get('actorId') ? { actorId: params.get('actorId')! } : {}),
        ...(params.get('taskKey') ? { taskKey: params.get('taskKey')! } : {}),
      };
      return Response.json(
        {
          items: await prisma.aIInvocation.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: page * 30,
            take: 30,
            include: { callAttempts: true },
          }),
          total: await prisma.aIInvocation.count({ where }),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return Response.json(await aiCenter(a, params.get('q') ?? ''), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    return Response.json(
      {
        data: await saveAIConfiguration(
          await actor('STAFF'),
          AICommands.parse(JSON.parse((await limitedBody(request, 30000)).toString('utf8'))),
        ),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
