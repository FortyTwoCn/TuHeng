import NextAuth from 'next-auth';
import type { NextRequest } from 'next/server';
import { authOptionsFor } from '../../../../../lib/auth';
import { checkOrigin, errorResponse } from '../../../../../lib/http';
const handler = NextAuth(authOptionsFor('STUDENT'));
export const GET = handler;
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> },
) {
  try {
    checkOrigin(request);
    return await handler(request, context);
  } catch (e) {
    return errorResponse(e);
  }
}
