import type { Metadata } from 'next';

type Props = {
  params: Promise<{ postId: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { postId } = await params;

  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://convergence-mvp.vercel.app'}/api/community/posts/${postId}`,
      { next: { revalidate: 60 } }
    );
    if (res.ok) {
      const post = await res.json();
      const title = post.title ?? 'Community Discussion';
      const description = post.excerpt ?? 'Join the discussion on Convergence — the mindfulness community.';
      return {
        title,
        description,
        openGraph: {
          title: `${title} — Convergence`,
          description,
          type: 'article',
        },
      };
    }
  } catch {
    // fall through to default
  }

  return {
    title: 'Community Discussion',
    description: 'Join the discussion on Convergence — the mindfulness community.',
    openGraph: {
      title: 'Community Discussion — Convergence',
      description: 'Join the discussion on Convergence — the mindfulness community.',
      type: 'article',
    },
  };
}

export default function PostLayout({ children }: { children: React.ReactNode }) {
  return children;
}
