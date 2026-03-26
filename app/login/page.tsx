import type { Metadata } from 'next';
import { LoginForm } from '@/components/login-form';

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to Convergence to ask questions, generate meditations, and join the community.',
  openGraph: {
    title: 'Sign In — Convergence',
    description: 'Sign in to Convergence to ask questions, generate meditations, and join the community.',
    type: 'website',
  },
};

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <LoginForm />
    </main>
  );
}
