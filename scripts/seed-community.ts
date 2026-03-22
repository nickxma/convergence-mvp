/**
 * scripts/seed-community.ts
 *
 * Inserts demo community content for the Token-Governed Knowledge Commons.
 * Creates 5 discussion threads covering core mindfulness topics, 3 replies
 * per thread, and realistic vote counts to populate the governance leaderboard.
 *
 * Usage:
 *   pnpm seed:community
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.
 * Reads from .env.local automatically when run via the npm script.
 *
 * Idempotent: identifies seed records by SEED_AUTHOR_* wallet addresses.
 * Safe to re-run — skips insertion if seed posts already exist.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Load .env.local ───────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), '.env.local');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch {
    // No .env.local — rely on process env
  }
}

loadEnvLocal();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── Seed wallet addresses (clearly marked as demo/placeholder) ────────────────

const SEED_AUTHORS = [
  '0x5EED_AUTHOR_000000000000000000000001',
  '0x5EED_AUTHOR_000000000000000000000002',
  '0x5EED_AUTHOR_000000000000000000000003',
  '0x5EED_AUTHOR_000000000000000000000004',
  '0x5EED_AUTHOR_000000000000000000000005',
  '0x5EED_AUTHOR_000000000000000000000006',
  '0x5EED_AUTHOR_000000000000000000000007',
  '0x5EED_AUTHOR_000000000000000000000008',
] as const;

// 80 unique voter wallets for seeding realistic vote distributions
const SEED_VOTERS = Array.from(
  { length: 80 },
  (_, i) => `0x5EED_VOTER_${String(i + 1).padStart(26, '0')}`,
);

// ── Post content (5 threads, mindfulness-focused) ─────────────────────────────

const SEED_POSTS = [
  {
    title: "What does genuine acceptance mean in practice — and when does it become passivity?",
    body: `One of the tensions I keep hitting in practice is the distinction between accepting what's happening in the present moment versus accepting circumstances that could and should change.

Sam makes it clear that acceptance is about the quality of attention in this moment — not a stance on whether to act in the world. But I notice in myself a tendency to use "acceptance" as an excuse to not engage with difficult situations. Has anyone worked through this confusion?

The classic example: you're in a job that's clearly wrong for you. Acceptance of the present moment vs. accepting a bad situation feel like very different things. How do you hold that distinction?`,
    author_wallet: SEED_AUTHORS[0],
    votes: 72,
    replies: [
      {
        body: `The confusion usually dissolves when you see that acceptance is about the quality of attention right now — the sensations, thoughts, emotions arising in this moment — not a global endorsement of your circumstances.

Accepting that you feel trapped in a job is different from accepting that you should stay. The first is honest. The second is a conclusion that doesn't follow from the first.

The "passive acceptance" trap tends to come from confusing the present moment (where acceptance applies) with the future (where intention and action apply). You can fully accept the discomfort of a bad situation while also forming a clear intention to change it.`,
        author_wallet: SEED_AUTHORS[1],
      },
      {
        body: `I think there's also a conceptual conflation between acceptance and approval. Accepting something means acknowledging it fully — seeing it clearly — not endorsing it.

When I accept frustration or dissatisfaction, I'm not saying "this is fine." I'm saying "this is what's here." From that honest starting point, I can respond thoughtfully. From resistance, my responses tend to be reactive and distorted.

The test I use: am I seeing this clearly, or am I in a story about how it shouldn't be this way? The latter is a flag that acceptance hasn't actually landed.`,
        author_wallet: SEED_AUTHORS[2],
      },
      {
        body: `Worth noting that the Stoic tradition makes the same distinction explicitly — "dichotomy of control." Accept what is not in your power. Change what is. The mindfulness framing just applies this to present-moment experience first.

Where I've found it practically useful: accepting uncomfortable emotions fully tends to reduce the energy they consume, which ironically makes it easier to act clearly. Resistance leaks bandwidth. Acceptance frees it.`,
        author_wallet: SEED_AUTHORS[3],
      },
    ],
  },
  {
    title: "Non-attachment in daily life: where the teaching meets the edge cases",
    body: `Non-attachment is easy to understand as a principle and genuinely hard to embody in the specifics of a life — especially with people, work, and goals you care about.

The obvious targets (materialism, ego) are covered well in the literature. I'm more interested in the edges: How does non-attachment work with close relationships? With long-term projects? With your own wellbeing?

I notice that attachment to outcomes is sometimes exactly the right thing — it motivates execution, care, consistency. At what point does caring become clinging? Is there a useful distinction?`,
    author_wallet: SEED_AUTHORS[1],
    votes: 58,
    replies: [
      {
        body: `The frame I find most useful: attachment is caring + the belief that the outcome defines you. Non-attachment is caring fully + the recognition that you are not the outcome.

This sounds subtle but it's actually a significant phenomenological difference. Attachment tends to narrow attention to the outcome and away from the process. Non-attachment allows full engagement with the process — often producing better results — without the suffering that comes when outcomes don't cooperate.

With relationships it applies differently. You can care deeply and still recognize that another person's choices, moods, and life path are not yours to control. That recognition can actually improve relationship quality — it reduces the possessiveness that close people find suffocating.`,
        author_wallet: SEED_AUTHORS[2],
      },
      {
        body: `I've come to think "non-attachment" is a somewhat unfortunate translation. The better frame might be something like "non-grasping" or "non-clinging" — holding things lightly rather than not holding them at all.

A parent doesn't stop caring about their child's wellbeing. They (ideally) learn to care without clinging to a specific vision of what that wellbeing looks like. That's closer to what the teaching points at.

The practical marker I use: am I responding to what's actually here, or to my idea of what should be here? The gap between those two things is usually where the clinging lives.`,
        author_wallet: SEED_AUTHORS[0],
      },
      {
        body: `Worth distinguishing motivation from attachment. Intrinsic motivation — wanting to do the work because it's meaningful — is compatible with non-attachment. Extrinsic or outcome-dependent motivation is closer to attachment.

In practice this shows up as: do you still find the work meaningful when it fails or when no one notices? If not, the motivation is attached to recognition or success, not the work itself.

This isn't a moral judgment — outcome-dependent motivation is understandable and useful. But it tends to produce more suffering and is more fragile under adversity.`,
        author_wallet: SEED_AUTHORS[3],
      },
    ],
  },
  {
    title: "Present-moment awareness: is it really accessible during active cognitive work?",
    body: `Most of the examples given for present-moment awareness involve relatively quiet activities — sitting meditation, breathing, walking. I'm genuinely unsure how it applies to cognitively demanding tasks: writing, coding, reasoning through complex problems.

When I'm in a flow state on a problem, there's no gap for "noticing" in the normal sense. The attention is fully deployed. Is that already a form of present-moment awareness? Or is flow a different state that bypasses the practice?

Curious how others have thought about this — especially people who do analytical work.`,
    author_wallet: SEED_AUTHORS[2],
    votes: 43,
    replies: [
      {
        body: `Flow is actually a pretty good description of effortless present-moment attention. The difference between flow and the mindfulness framing might just be semantic.

What meditation practice builds (over time) is the capacity to recognize when you've *left* the present moment — when thinking has become distracted or self-referential rather than task-focused. This is arguably more valuable than the flow state itself, because it lets you return to it more reliably.

So: yes, deep work on a hard problem can be present-moment aware. The practice develops the metacognitive capacity to notice when it isn't.`,
        author_wallet: SEED_AUTHORS[4],
      },
      {
        body: `The frame I use: present-moment awareness doesn't require reduced cognitive activity — it requires that activity to be non-self-referential. Thinking about the problem = present. Thinking about how you're doing at the problem = not present.

The sneaky version is when analytical work becomes a performance — "am I being smart enough," "what will people think of this" — those are the places where present-moment contact breaks down during cognitive tasks.

The meditation skill that transfers most to analytical work is probably the ability to notice when thinking has become self-referential and return to the task.`,
        author_wallet: SEED_AUTHORS[0],
      },
      {
        body: `Sam addresses this somewhat in the app. The pointing is at the field of experience as a whole — not at a narrowed focus on breath or body. Deep cognitive work, when it's clean, is a valid expression of that field.

The confusion I had for a long time was conflating mindfulness with calm or with low-level sensory experience. That's one form of it. Open awareness — in which complex thinking can occur without a separate observer watching — is a more complete account.`,
        author_wallet: SEED_AUTHORS[1],
      },
    ],
  },
  {
    title: "Noting vs. open awareness: switching methods after years of practice",
    body: `I've been using the noting technique almost exclusively for three years. It works well for me — particularly for anxiety and difficult emotions. The labeling creates a small but useful distance from content.

Recently started experimenting with open awareness (choiceless awareness, shikantaza-adjacent). The transition is genuinely disorienting. Noting gives the mind something to do; open awareness asks it to just be. I keep defaulting back to noting even when intending to practice open awareness.

Has anyone navigated this transition? Is there a way to use the techniques in sequence or do they need to be held as distinct practices?`,
    author_wallet: SEED_AUTHORS[3],
    votes: 29,
    replies: [
      {
        body: `The disorientation is real and normal. Noting works by using a cognitive handle to stay close to experience. Open awareness removes the handle and asks you to rest in experience directly. These are genuinely different orientations.

What helped me: treat noting as a tool you can pick up and put down, not an identity. If the mind is churning and difficult to work with, note. If it's relatively settled, try dropping into open awareness from that platform. Over time the open state becomes more stable and you rely on noting less.

Don't try to switch methods mid-difficulty. That tends to produce the instability you're describing.`,
        author_wallet: SEED_AUTHORS[5],
      },
      {
        body: `In the Tibetan system these roughly correspond to shamatha (stabilizing) and rigpa (recognizing). They're not the same practice and are often taught in sequence — shamatha first, as a platform, then the recognition practice.

The noting technique is essentially a shamatha method with phenomenological content. Open awareness is pointing at something the mind recognizes rather than constructs. If you haven't had a clear recognition of what open awareness is pointing at, it will feel like you're just sitting there doing nothing.

That recognition — often called "pointing out" in the Dzogchen tradition — is the thing that makes the practice unlock. Until then, open awareness can feel like formless wandering.`,
        author_wallet: SEED_AUTHORS[6],
      },
      {
        body: `I found it helpful to alternate deliberately — e.g., 15 minutes of noting followed by 15 minutes of attempting open awareness. The noting session stabilizes attention; the open awareness session is then working with a more tractable mind.

After several months of this the transition became smoother. I now use noting mostly as a diagnostic when practice goes sideways rather than as the primary method.`,
        author_wallet: SEED_AUTHORS[2],
      },
    ],
  },
  {
    title: "Sam Harris vs. other contemporary teachers — what's genuinely different?",
    body: `I've spent significant time with the Waking Up app, and separately with teachers from the Vipassana and Tibetan traditions. The secular framing Sam uses is obviously different, but I'm trying to understand whether the differences are:

a) Mostly rhetorical/packaging (same pointing, different vocabulary)
b) Substantively different in what they're pointing at or how they develop practice
c) Some of both, and it depends on the specific tradition

The pointing-out instruction emphasis in Waking Up feels closer to Tibetan approaches than to Theravada. But Sam's framing of ethics and the relationship between insight and behavior seems distinct from both. Curious what others have found.`,
    author_wallet: SEED_AUTHORS[4],
    votes: 15,
    replies: [
      {
        body: `Mostly (c). The core phenomenological pointing — look for the looker, find that awareness has no location, recognize that the sense of self is a construction — is substantially the same across Advaita, Dzogchen, and Sam's secular framing. The vocabulary differs but the finger is pointing at the same moon.

Where I find genuine differences: the relationship to tradition, lineage, and ritual (Sam decouples completely); the handling of ethics (Sam treats it as largely separable from insight, which is contested in Buddhist traditions); and the role of the teacher-student relationship (Sam minimizes it, traditional systems foreground it).

None of these are purely rhetorical. They reflect actual choices about what the practice is for and how it works.`,
        author_wallet: SEED_AUTHORS[0],
      },
      {
        body: `The Theravada tradition does de-emphasize the "direct recognition" approach and focuses more on gradual cultivation through stages (jhanas, the progress of insight). That's a real methodological difference, not just framing.

Sam's approach is more aligned with non-dual traditions (Advaita, Dzogchen, Zen) that emphasize direct recognition of the nature of awareness as a starting point rather than an endpoint. This can produce faster results for some people and miss others entirely — it depends heavily on whether the pointing lands.

The secular framing removes a lot of cultural scaffolding that helps some practitioners and confuses others. That's also a substantive choice, not just packaging.`,
        author_wallet: SEED_AUTHORS[1],
      },
      {
        body: `Worth noting: Sam's treatment of psychedelics as legitimate tools for insight and his openness about AI and consciousness are pretty unusual among mainstream meditation teachers. These feel like genuine differences in worldview, not just style.

Also the emphasis on skeptical epistemology — being willing to apply the same standards of evidence to meditation claims as to anything else — is distinctive and not universally appreciated in traditional contexts.

Whether these matter for practice is another question. They seem to matter for who finds the on-ramp accessible.`,
        author_wallet: SEED_AUTHORS[7],
      },
    ],
  },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) {
  process.stdout.write(msg + '\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
  log('🌱  Knowledge Commons seed script');
  log(`   Target: ${SUPABASE_URL}`);
  log('');

  // ── Idempotency check ──
  const { data: existing, error: checkErr } = await supabase
    .from('posts')
    .select('id')
    .in('author_wallet', [...SEED_AUTHORS])
    .limit(1);

  if (checkErr) {
    console.error('❌  Failed to query posts:', checkErr.message);
    process.exit(1);
  }

  if (existing && existing.length > 0) {
    log('✅  Seed data already present — skipping. (Run with --force to re-seed.)');
    if (!process.argv.includes('--force')) {
      process.exit(0);
    }
    log('   --force detected, removing existing seed data first...');
    await supabase.from('posts').delete().in('author_wallet', [...SEED_AUTHORS]);
    log('   Seed data removed.\n');
  }

  let totalPosts = 0;
  let totalReplies = 0;
  let totalVotes = 0;

  for (const postData of SEED_POSTS) {
    // ── Insert post ──
    const { data: post, error: postErr } = await supabase
      .from('posts')
      .insert({
        title: postData.title,
        body: postData.body,
        author_wallet: postData.author_wallet,
        votes: 0, // will be set via vote records below
        hidden: false,
      })
      .select('id, title')
      .single();

    if (postErr || !post) {
      console.error(`❌  Failed to insert post "${postData.title}":`, postErr?.message);
      process.exit(1);
    }

    totalPosts++;
    log(`📝  Post [${totalPosts}]: "${post.title.slice(0, 60)}…"`);

    // ── Insert replies ──
    for (const replyData of postData.replies) {
      const { error: replyErr } = await supabase.from('replies').insert({
        post_id: post.id,
        body: replyData.body,
        author_wallet: replyData.author_wallet,
        votes: 0,
      });

      if (replyErr) {
        console.error(`❌  Failed to insert reply:`, replyErr.message);
        process.exit(1);
      }
      totalReplies++;
    }
    log(`   ↳  ${postData.replies.length} replies inserted`);

    // ── Insert vote records (upvotes from seed voter wallets) ──
    const voteCount = postData.votes;
    const voters = SEED_VOTERS.slice(0, voteCount);

    const voteRows = voters.map((voter_wallet) => ({
      voter_wallet,
      target_type: 'post',
      target_id: post.id,
      direction: 1,
    }));

    const { error: votesErr } = await supabase
      .from('votes')
      .insert(voteRows)
      .select();

    if (votesErr) {
      console.error(`❌  Failed to insert votes:`, votesErr.message);
      process.exit(1);
    }

    // ── Update denormalized vote count ──
    const { error: updateErr } = await supabase
      .from('posts')
      .update({ votes: voteCount })
      .eq('id', post.id);

    if (updateErr) {
      console.error(`❌  Failed to update vote count:`, updateErr.message);
      process.exit(1);
    }

    totalVotes += voteCount;
    log(`   ↳  ${voteCount} votes inserted`);
  }

  log('');
  log('✅  Seed complete:');
  log(`   Posts:   ${totalPosts}`);
  log(`   Replies: ${totalReplies}`);
  log(`   Votes:   ${totalVotes}`);
}

seed().catch((err) => {
  console.error('❌  Unexpected error:', err);
  process.exit(1);
});
