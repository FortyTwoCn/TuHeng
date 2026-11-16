import { prisma } from '@tuheng/database';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const page = Math.max(0, Math.min(10000, Number(url.searchParams.get('page')) || 0));
  const schools = await prisma.school.findMany({
    where: {
      active: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { code: 'asc' },
    skip: page * 20,
    take: 21,
    select: { id: true, name: true, code: true },
  });
  return Response.json(
    { schools: schools.slice(0, 20), hasMore: schools.length > 20 },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
