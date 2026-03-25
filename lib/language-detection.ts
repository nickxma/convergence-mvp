import { francAll } from 'franc-min';

// franc ISO 639-3 codes for supported non-English languages
const FRANC_TO_LANG: Record<string, { code: string; name: string; deepl: string }> = {
  spa: { code: 'es', name: 'Spanish',    deepl: 'ES' },
  fra: { code: 'fr', name: 'French',     deepl: 'FR' },
  deu: { code: 'de', name: 'German',     deepl: 'DE' },
  por: { code: 'pt', name: 'Portuguese', deepl: 'PT' },
  jpn: { code: 'ja', name: 'Japanese',   deepl: 'JA' },
  kor: { code: 'ko', name: 'Korean',     deepl: 'KO' },
  cmn: { code: 'zh', name: 'Chinese',    deepl: 'ZH' },
  zho: { code: 'zh', name: 'Chinese',    deepl: 'ZH' },
};

const FRANC_SUPPORTED = ['eng', ...Object.keys(FRANC_TO_LANG)];

// Minimum query length for reliable franc detection of Latin-script languages
const MIN_LATIN_DETECT_LEN = 20;

export interface DetectedLanguage {
  code: string;   // ISO 639-1 (e.g. 'es', 'fr')
  name: string;   // Human-readable (e.g. 'Spanish')
  deepl: string;  // DeepL source/target code (e.g. 'ES')
}

/**
 * Detects the language of a query string.
 * Returns null if the language is English, cannot be determined with
 * sufficient confidence, or is not in the supported set.
 *
 * Detection strategy:
 * - CJK scripts (Japanese, Korean, Chinese) detected by Unicode ranges first —
 *   these are unambiguous even for short queries.
 * - Latin-script languages require ≥ 20 chars for reliable franc detection;
 *   shorter queries default to English.
 * - Overall confidence < 0.8 (undetermined franc output) defaults to English.
 */
export function detectQueryLanguage(text: string): DetectedLanguage | null {
  // CJK script detection — reliable independent of text length
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) {
    // Contains hiragana or katakana → Japanese
    return FRANC_TO_LANG.jpn ?? null;
  }
  if (/[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(text)) {
    // Contains hangul → Korean
    return FRANC_TO_LANG.kor ?? null;
  }
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text)) {
    // Contains CJK ideographs (no kana/hangul above) → Chinese
    return FRANC_TO_LANG.cmn ?? null;
  }

  // Latin-script: require minimum length for reliable detection
  if (text.length < MIN_LATIN_DETECT_LEN) return null;

  const results = francAll(text, { only: FRANC_SUPPORTED });
  if (!results.length) return null;

  const [topCode] = results[0];
  if (topCode === 'und' || topCode === 'eng') return null;

  return FRANC_TO_LANG[topCode] ?? null;
}

/**
 * Translates text to English using the DeepL API.
 * Returns the original text unchanged if DEEPL_API_KEY is not configured
 * or the API call fails (graceful degradation).
 */
export async function translateToEnglish(
  text: string,
  sourceLang: DetectedLanguage,
): Promise<string> {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) return text;

  // Pro accounts use api.deepl.com; free accounts use api-free.deepl.com
  const baseUrl = process.env.DEEPL_API_URL ?? 'https://api-free.deepl.com';

  try {
    const res = await fetch(`${baseUrl}/v2/translate`, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: [text],
        source_lang: sourceLang.deepl,
        target_lang: 'EN',
      }),
    });

    if (!res.ok) {
      console.warn(`[deepl] translate failed: ${res.status}`);
      return text;
    }

    const data = await res.json() as { translations: Array<{ text: string }> };
    return data.translations[0]?.text ?? text;
  } catch (err) {
    console.warn(`[deepl] translate error: ${err instanceof Error ? err.message : String(err)}`);
    return text;
  }
}
