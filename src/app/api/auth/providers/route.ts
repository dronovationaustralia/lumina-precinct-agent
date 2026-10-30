/** GET /api/auth/providers: which sign-in methods this deployment offers (read at request time). */
import { connection } from 'next/server';

import { microsoftConfigured } from '@/server/auth/session';

export async function GET() {
  await connection();
  return Response.json({ microsoft: microsoftConfigured(), demo: process.env.AUTH_DEMO_DISABLED !== '1' });
}
