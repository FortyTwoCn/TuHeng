import {
  listGradingJobs,
  JobFilters,
} from '../../../../../../packages/infrastructure/src/job-records';
import { actor } from '../../../../lib/auth';
import { errorResponse } from '../../../../lib/http';
export async function GET(request: Request) {
  try {
    const entries = [...new URL(request.url).searchParams.entries()].filter(
      ([, value]) => value !== '',
    );
    const data = await listGradingJobs(
      await actor('STAFF'),
      JobFilters.parse(Object.fromEntries(entries)),
    );
    return Response.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
