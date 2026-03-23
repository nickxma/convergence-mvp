/**
 * Query normalization, spell correction, and synonym expansion pipeline (OLU-792).
 *
 * Applied to user queries before embedding and retrieval:
 *   1. normalizeQuery   — expand contractions, lowercase, strip punctuation
 *   2. spellCorrect     — fix obvious typos against a mindfulness vocabulary
 *   3. expandSynonyms   — append top-2 synonyms for recognized domain terms
 *
 * All functions are pure with no external dependencies or network calls.
 */

// ── Contraction expansion ────────────────────────────────────────────────────

const CONTRACTIONS: Record<string, string> = {
  "what's": 'what is',
  "it's": 'it is',
  "that's": 'that is',
  "there's": 'there is',
  "here's": 'here is',
  "who's": 'who is',
  "how's": 'how is',
  "when's": 'when is',
  "where's": 'where is',
  "why's": 'why is',
  "he's": 'he is',
  "she's": 'she is',
  "i'm": 'i am',
  "you're": 'you are',
  "we're": 'we are',
  "they're": 'they are',
  "i've": 'i have',
  "you've": 'you have',
  "we've": 'we have',
  "they've": 'they have',
  "i'll": 'i will',
  "you'll": 'you will',
  "we'll": 'we will',
  "they'll": 'they will',
  "i'd": 'i would',
  "you'd": 'you would',
  "he'd": 'he would',
  "she'd": 'she would',
  "we'd": 'we would',
  "they'd": 'they would',
  "isn't": 'is not',
  "aren't": 'are not',
  "wasn't": 'was not',
  "weren't": 'were not',
  "don't": 'do not',
  "doesn't": 'does not',
  "didn't": 'did not',
  "can't": 'cannot',
  "couldn't": 'could not',
  "won't": 'will not',
  "wouldn't": 'would not',
  "shouldn't": 'should not',
  "haven't": 'have not',
  "hasn't": 'has not',
  "hadn't": 'had not',
};

// ── Vocabulary ────────────────────────────────────────────────────────────────
// All words that should NOT be spell-corrected (they are correct as-is).

/** Mindfulness / meditation domain terms. */
const DOMAIN_TERMS: readonly string[] = [
  // Core practice
  'meditation', 'mindfulness', 'awareness', 'consciousness', 'attention',
  'presence', 'contemplation', 'contemplative', 'practice', 'practitioner',
  // States and qualities
  'equanimity', 'clarity', 'stillness', 'silence', 'peace', 'calm', 'tranquility',
  'serenity', 'openness', 'spaciousness', 'freedom', 'liberation', 'awakening',
  'enlightenment', 'insight', 'wisdom', 'compassion', 'kindness', 'acceptance',
  'surrender', 'bliss', 'contentment',
  // Buddhist / Pali / Sanskrit
  'impermanence', 'anicca', 'transience', 'anatta', 'dukkha', 'suffering',
  'attachment', 'detachment', 'craving', 'aversion', 'selflessness',
  'nondual', 'nonduality', 'advaita', 'dzogchen', 'rigpa',
  'samadhi', 'jhana', 'nirvana', 'samsara', 'karma', 'dharma',
  'sangha', 'buddha', 'buddhism', 'buddhist',
  'vipassana', 'shamatha', 'metta', 'tonglen', 'koan', 'satori',
  'prajna', 'sunyata', 'emptiness',
  // Techniques and traditions
  'zen', 'tao', 'taoist', 'taoism', 'vedanta', 'yoga',
  'breathing', 'breath', 'breathwork', 'pranayama', 'mantra', 'visualization',
  'noting', 'labeling', 'inquiry',
  // Psychology / mental states
  'emotion', 'emotions', 'sensation', 'perception', 'cognition', 'metacognition',
  'rumination', 'anxiety', 'depression', 'stress', 'trauma', 'healing', 'wellbeing',
  'happiness', 'purpose', 'meaning', 'values', 'ethics',
  // Teacher / community
  'teacher', 'guru', 'master', 'tradition', 'lineage', 'retreat',
  'monastery', 'community', 'satsang',
];

/** High-frequency English words that are almost always correct. */
const COMMON_WORDS: readonly string[] = [
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'that', 'this',
  'these', 'those', 'it', 'its', 'he', 'she', 'they', 'we', 'you', 'i',
  'me', 'my', 'your', 'our', 'their', 'his', 'her', 'what', 'when',
  'where', 'who', 'why', 'how', 'which', 'if', 'then', 'than', 'so',
  'as', 'not', 'no', 'yes', 'all', 'any', 'some', 'more', 'most',
  'other', 'such', 'into', 'about', 'after', 'before', 'between',
  'through', 'during', 'over', 'under', 'again', 'while', 'because',
  'like', 'just', 'up', 'out', 'also', 'very', 'really', 'much',
  'get', 'make', 'go', 'know', 'think', 'feel', 'want', 'need',
  'help', 'use', 'see', 'look', 'come', 'work', 'way', 'time',
  'find', 'give', 'take', 'keep', 'let', 'try', 'put', 'mean',
  'become', 'stay', 'start', 'stop', 'move', 'live', 'seem', 'turn',
  'understand', 'learn', 'experience', 'people', 'person',
  'life', 'world', 'day', 'days', 'mind', 'body', 'heart', 'thoughts',
  'self', 'sense', 'things', 'thing', 'something', 'nothing',
  'everything', 'anything', 'without', 'within', 'between', 'always',
  'never', 'often', 'sometimes', 'usually', 'different', 'same',
  'good', 'bad', 'new', 'old', 'long', 'short', 'first', 'last',
  'own', 'right', 'real', 'true', 'false', 'open', 'deep', 'still',
  'change', 'focus', 'energy', 'nature', 'state', 'level', 'process',
  'simply', 'allow', 'notice', 'observe', 'release', 'relax',
];

/** All known-good words (combined set). */
const ALL_KNOWN: Set<string> = new Set([...DOMAIN_TERMS, ...COMMON_WORDS]);

// ── Levenshtein edit distance ────────────────────────────────────────────────

/** Compute the Levenshtein edit distance between two strings. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // Build two rows only to save memory
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// ── Contraction expansion ─────────────────────────────────────────────────────

/** Replace English contractions with their expanded forms. */
function expandContractions(text: string): string {
  return text.replace(/\b\w+'\w+\b/gi, (match) => {
    return CONTRACTIONS[match.toLowerCase()] ?? match;
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Normalize a query string:
 * - Expand contractions (what's → what is)
 * - Lowercase
 * - Strip punctuation except word-internal hyphens (non-dual, body-scan)
 * - Collapse whitespace
 */
export function normalizeQuery(text: string): string {
  let out = expandContractions(text);
  out = out.toLowerCase();
  // Keep hyphens only when surrounded by word characters (e.g. non-dual).
  // Remove: punctuation, leading/trailing hyphens, standalone hyphens.
  out = out.replace(/[^\w\s-]|(?<!\w)-|-(?!\w)/g, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Attempt to spell-correct a normalized query.
 *
 * Strategy: for each word not already in the known vocabulary, find the unique
 * closest match in that vocabulary at Levenshtein distance ≤ 1. If there is
 * exactly one such match, replace the word. Ambiguous or no-match cases are
 * left unchanged to avoid false positives.
 *
 * Words ≤ 3 characters are always skipped (too ambiguous at distance 1).
 */
export function spellCorrect(text: string): { corrected: string; changed: boolean } {
  const words = text.split(/\s+/);
  let changed = false;

  const correctedWords = words.map((word) => {
    // Skip short words and words already in vocabulary
    if (word.length <= 3 || ALL_KNOWN.has(word)) return word;

    let bestCandidates: string[] = [];
    let bestDist = 2; // Only correct at distance exactly 1 (threshold exclusive)

    for (const known of ALL_KNOWN) {
      // Prune: words with very different lengths can't match at distance 1
      if (Math.abs(known.length - word.length) > 1) continue;
      const d = levenshtein(word, known);
      if (d < bestDist) {
        bestDist = d;
        bestCandidates = [known];
      } else if (d === bestDist) {
        bestCandidates.push(known);
      }
    }

    // Only correct when there's a unique best match at distance 1
    if (bestCandidates.length === 1 && bestDist === 1) {
      changed = true;
      return bestCandidates[0];
    }
    return word;
  });

  return { corrected: correctedWords.join(' '), changed };
}

// ── Synonym map ───────────────────────────────────────────────────────────────
// Mirrors the query_synonyms DB table seeded in migration 072.
// Each entry: term → up to 2 synonyms to append during retrieval expansion.

export const SYNONYM_MAP: Readonly<Record<string, readonly [string, string]>> = {
  meditation: ['mindfulness', 'contemplation'],
  mindfulness: ['meditation', 'awareness'],
  awareness: ['mindfulness', 'consciousness'],
  consciousness: ['awareness', 'presence'],
  impermanence: ['anicca', 'transience'],
  anicca: ['impermanence', 'transience'],
  transience: ['impermanence', 'anicca'],
  anatta: ['selflessness', 'non-self'],
  selflessness: ['anatta', 'non-self'],
  dukkha: ['suffering', 'dissatisfaction'],
  suffering: ['dukkha', 'dissatisfaction'],
  equanimity: ['calm', 'serenity'],
  compassion: ['kindness', 'metta'],
  metta: ['loving-kindness', 'compassion'],
  enlightenment: ['awakening', 'liberation'],
  awakening: ['enlightenment', 'liberation'],
  liberation: ['awakening', 'enlightenment'],
  nonduality: ['non-dual', 'advaita'],
  advaita: ['nonduality', 'non-dual'],
  vipassana: ['insight', 'mindfulness'],
  insight: ['wisdom', 'vipassana'],
  wisdom: ['insight', 'prajna'],
  presence: ['awareness', 'now'],
  attachment: ['clinging', 'craving'],
  craving: ['attachment', 'desire'],
  breath: ['breathing', 'pranayama'],
  breathing: ['breath', 'pranayama'],
  pranayama: ['breathwork', 'breathing'],
  emptiness: ['sunyata', 'openness'],
  sunyata: ['emptiness', 'openness'],
  samadhi: ['concentration', 'absorption'],
  karma: ['action', 'intention'],
  dharma: ['teaching', 'truth'],
  sangha: ['community', 'practice'],
  retreat: ['silence', 'practice'],
};

/**
 * Expand a normalized query by appending top-2 synonyms for any recognized
 * domain terms. Synonyms that already appear in the query are skipped.
 */
export function expandSynonyms(text: string): string {
  const words = text.split(/\s+/);
  const seen = new Set(words);
  const additions: string[] = [];

  for (const word of words) {
    const syns = SYNONYM_MAP[word];
    if (!syns) continue;
    for (const syn of syns) {
      if (!seen.has(syn)) {
        additions.push(syn);
        seen.add(syn);
      }
    }
  }

  return additions.length > 0 ? `${text} ${additions.join(' ')}` : text;
}

// ── Full pipeline ─────────────────────────────────────────────────────────────

export interface QueryEnhancement {
  /** Spell-corrected and normalized query — used as the cache key and for display. */
  normalizedQuery: string;
  /** Synonym-expanded form of normalizedQuery — used as the embedding input. */
  enhancedQuery: string;
  /** True when spell correction changed one or more words. */
  spellCorrected: boolean;
  /**
   * The corrected query string to show in the "Did you mean?" UI banner.
   * Null when no corrections were applied.
   */
  correctedQuery: string | null;
}

/**
 * Run the full query enhancement pipeline on a raw user query.
 *
 * Typical latency: <1 ms (pure computation, no I/O).
 */
export function enhanceQuery(rawQuery: string): QueryEnhancement {
  const normalizedQuery = normalizeQuery(rawQuery);
  const { corrected, changed: spellCorrected } = spellCorrect(normalizedQuery);
  const enhancedQuery = expandSynonyms(corrected);
  return {
    normalizedQuery: corrected,
    enhancedQuery,
    spellCorrected,
    correctedQuery: spellCorrected ? corrected : null,
  };
}
