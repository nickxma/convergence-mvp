import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Profile',
  description: 'View your Convergence profile, activity, and community contributions.',
  openGraph: {
    title: 'Profile — Convergence',
    description: 'View your Convergence profile, activity, and community contributions.',
    type: 'profile',
  },
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
