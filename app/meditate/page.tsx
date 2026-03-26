import type { Metadata } from 'next';
import { MeditateInterface } from '@/components/meditate-interface';

export const metadata: Metadata = {
  title: 'Guided Meditation Generator',
  description:
    'Generate a personalized guided meditation grounded in hundreds of hours of mindfulness teachings from leading teachers and practitioners. Choose your duration, theme, and practice style.',
  openGraph: {
    title: 'Guided Meditation Generator — Convergence',
    description:
      'Generate a personalized guided meditation grounded in hundreds of hours of mindfulness teachings from leading teachers and practitioners. Choose your duration, theme, and practice style.',
    type: 'website',
  },
};

export default function MeditatePage() {
  return (
    <main id="main-content" className="flex flex-col" style={{ height: '100dvh' }}>
      <MeditateInterface />
    </main>
  );
}
