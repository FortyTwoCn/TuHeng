import { ZodError } from 'zod';
import { DomainError } from '@tuheng/domain';
export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(process.env.NEXTAUTH_URL ?? request.url).origin)
    throw new DomainError('INVALID_ORIGIN', 403);
}
export async function limitedBody(request: Request, max: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError('EMPTY_BODY');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new DomainError('BODY_TOO_LARGE', 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export function errorResponse(e: unknown) {
  if (e instanceof DomainError) return Response.json({ error: e.code }, { status: e.status });
  if (e instanceof SyntaxError)
    return Response.json({ error: 'INVALID_JSON_BODY' }, { status: 400 });
  if (e instanceof ZodError)
    return Response.json(
      { error: 'INVALID_INPUT', details: e.issues.map((i) => i.message).slice(0, 6) },
      { status: 400 },
    );
  const code = (e as { code?: string }).code;
  if (code === 'P2002') return Response.json({ error: 'DUPLICATE_RECORD' }, { status: 409 });
  console.error(JSON.stringify({ event: 'api-error', code: code ?? 'INTERNAL_ERROR' }));
  return Response.json(
    { error: 'OPERATION_FAILED', hint: '请重试；如仍失败，请让管理员通过任务编号或操作审计定位。' },
    { status: 500 },
  );
}
