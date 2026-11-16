// The former shared authentication domain is deliberately closed.
export function GET() {
  return Response.json(
    { error: 'USE_REALM_LOGIN', paths: ['/login/student', '/login/staff'] },
    { status: 410 },
  );
}
export const POST = GET;
