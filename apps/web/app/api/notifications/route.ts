import { z } from 'zod';
import { prisma } from '@tuheng/database';
import { actor } from '../../../lib/auth';
import { checkOrigin, errorResponse, limitedBody } from '../../../lib/http';
export async function GET() {
  try {
    const a = await actor();
    const items = await prisma.userNotification.findMany({
      where: { userId: a.id, readAt: null },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    const assignments = await prisma.assignment.findMany({
      where: { id: { in: items.map((i) => i.assignmentId) } },
      select: { id: true, title: true },
    });
    return Response.json(
      {
        data: items.map((i) => ({
          ...i,
          title: assignments.find((a) => a.id === i.assignmentId)?.title ?? '作业',
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const a = await actor(),
      body = z
        .object({ id: z.string() })
        .parse(JSON.parse((await limitedBody(request, 1000)).toString()));
    await prisma.userNotification.updateMany({
      where: { id: body.id, userId: a.id },
      data: { readAt: new Date() },
    });
    return Response.json({ data: { ok: true } });
  } catch (e) {
    return errorResponse(e);
  }
}
