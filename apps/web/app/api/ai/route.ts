import { actor } from '../../../lib/auth';
import { checkOrigin, errorResponse, limitedBody } from '../../../lib/http';
import {
  aiCenter,
  AICommands,
  requireAIAdmin,
  saveAIConfiguration,
} from '../../../../../packages/infrastructure/src/ai-admin';
import {
  InvocationFilters,
  listAIInvocations,
} from '../../../../../packages/infrastructure/src/ai-records';
export async function GET(request: Request) {
  try {
    const a = await actor('STAFF');
    requireAIAdmin(a);
    const params = new URL(request.url).searchParams;
    if (params.get('view') === 'invocations') {
      return Response.json(
        await listAIInvocations(
          a,
          InvocationFilters.parse(
            Object.fromEntries(
              [...params.entries()].filter(([key, value]) => key !== 'view' && value !== ''),
            ),
          ),
        ),
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
