import { Suspense } from 'react';

import { SignIn } from '@/components/auth/SignIn';

export const metadata = { title: 'Sign in · Lumina Precinct Agent' };

export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
