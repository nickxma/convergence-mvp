import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Submit',
  description: 'Submit your writing or teachings to be considered for the Convergence corpus.',
  openGraph: {
    title: 'Submit — Convergence',
    description: 'Submit your writing or teachings to be considered for the Convergence corpus.',
    type: 'website',
  },
};

export default function SubmitLayout({ children }: { children: React.ReactNode }) {
  return children;
}
