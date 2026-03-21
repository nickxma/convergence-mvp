import { AuthStatus } from '@/components/auth-status';

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <AuthStatus />
    </main>
  );
}
