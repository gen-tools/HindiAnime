/**
 * Fuzzy search utilities for smart anime search.
 *
 * Implements:
 * - Levenshtein edit distance (handles typos/misspellings)
 * - Trigram similarity (handles partial word matches)
 * - Token-based matching (handles word-order variation)
 * - Phonetic normalization (handles common transliteration variations)
 *
 * All zero-dependency — runs in browser and Node.js.
 */

// ─── Phonetic Normalization ───────────────────────────────────────────────────

/** Common anime transliteration aliases and phonetic equivalents */
const PHONETIC_MAP: [RegExp, string][] = [
  [/ou|oo/g, "o"],         // Naruto → naruto, Toukyou → tokyo
  [/uu/g, "u"],             // Kyuubi → kyubi
  [/sh/g, "s"],             // Shippuden → sippuden
  [/ch/g, "c"],             // Ichigo → icigo
  [/tsu/g, "zu"],           // Natsu → nazu
  [/aa/g, "a"],             // collapse double a
  [/ee/g, "e"],             // collapse double e
  [/ii/g, "i"],             // collapse double i
  [/[^a-z0-9 ]/g, ""],      // strip special chars
];

export function phoneticNormalize(s: string): string {
  let out = s.toLowerCase().trim();
  for (const [from, to] of PHONETIC_MAP) {
    out = out.replace(from, to);
  }
  return out;
}

// ─── Levenshtein Distance ─────────────────────────────────────────────────────

/** O(mn) dynamic programming edit distance */
export function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = 1 + Math.min(
          matrix[i - 1][j - 1], // replace
          matrix[i][j - 1],     // insert
          matrix[i - 1][j],     // delete
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/** Normalized edit distance: 0 = identical, 1 = completely different */
export function editSimilarity(a: string, b: string): number {
  const dist = levenshtein(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - dist / maxLen;
}

// ─── Trigram Similarity ───────────────────────────────────────────────────────

function trigrams(s: string): Set<string> {
  const padded = `  ${s.toLowerCase()}  `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let intersection = 0;
  for (const g of ta) {
    if (tb.has(g)) intersection++;
  }
  const union = ta.size + tb.size - intersection;
  if (union === 0) return 1;
  return intersection / union;
}

// ─── Combined Fuzzy Score ─────────────────────────────────────────────────────

export interface FuzzyScore {
  score: number; // 0–1, higher = better match
  reasons: string[];
}

export function fuzzyScore(query: string, target: string): FuzzyScore {
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase().trim();
  const qNorm = phoneticNormalize(q);
  const tNorm = phoneticNormalize(t);

  const reasons: string[] = [];
  let score = 0;

  // 1. Exact match — max score
  if (t === q) {
    return { score: 1.0, reasons: ["exact"] };
  }

  // 2. Starts-with match — very strong
  if (t.startsWith(q)) {
    score = Math.max(score, 0.95);
    reasons.push("starts-with");
  }

  // 3. Contains match — strong
  if (t.includes(q)) {
    score = Math.max(score, 0.85);
    reasons.push("contains");
  }

  // 4. Token-level matching — checks each word of query against title tokens
  const qTokens = q.split(/\s+/).filter(Boolean);
  const tTokens = t.split(/\s+/).filter(Boolean);
  let tokenMatches = 0;
  for (const qTok of qTokens) {
    for (const tTok of tTokens) {
      // Ignore one- and two-character fragments such as "no" inside an
      // unrelated query; they otherwise turn a weak accidental overlap into
      // an all-token match.
      if (
        (qTok.length >= 3 && tTok.includes(qTok)) ||
        (tTok.length >= 3 &&
          qTok.includes(tTok) &&
          tTok.length / qTok.length >= 0.6)
      ) {
        tokenMatches++;
        break;
      }
      // Levenshtein within tokens (1-char typo tolerance per word)
      const dist = levenshtein(qTok, tTok);
      const tolerance = qTok.length <= 4 ? 1 : 2;
      if (qTok.length >= 3 && tTok.length >= 3 && dist <= tolerance) {
        tokenMatches++;
        break;
      }
    }
  }
  if (tokenMatches > 0 && qTokens.length > 0) {
    const tokenScore = 0.7 * (tokenMatches / qTokens.length);
    score = Math.max(score, tokenScore);
    if (tokenMatches === qTokens.length) {
      // Prefer the concise title that matches the whole requested phrase over
      // a longer title that merely starts with the same words.
      const lengthPenalty = Math.min(0.12, Math.max(0, tTokens.length - qTokens.length) * 0.04);
      score = Math.max(score, 0.92 - lengthPenalty);
      reasons.push("all-tokens");
    } else {
      reasons.push(`${tokenMatches}/${qTokens.length}-tokens`);
    }
  }

  // 5. Trigram similarity — catches partial overlaps and character scrambles
  const tg = trigramSimilarity(q, t);
  score = Math.max(score, tg * 0.75);
  if (tg > 0.5) reasons.push(`trigram:${tg.toFixed(2)}`);

  // 6. Phonetic normalized match — catches transliteration variants
  const editNorm = qNorm && tNorm ? editSimilarity(qNorm, tNorm) : 0;
  if (editNorm > 0.75) {
    score = Math.max(score, editNorm * 0.80);
    reasons.push(`phonetic:${editNorm.toFixed(2)}`);
  }

  // 7. Levenshtein on full strings — global edit distance
  const edit = editSimilarity(q, t);
  score = Math.max(score, edit * 0.65);
  if (edit > 0.5) reasons.push(`edit:${edit.toFixed(2)}`);

  return { score: Math.min(score, 1), reasons };
}

// ─── Fuzzy Filter & Rank ──────────────────────────────────────────────────────

export interface FuzzyItem {
  id: string;
  title: string;
  alternativeTitle?: string;
  slug: string;
  poster?: string;
  genres?: string[];
  year?: number;
  rating?: number;
}

export interface RankedResult<T extends FuzzyItem> {
  item: T;
  score: number;
  reasons: string[];
}

/** Threshold below which results are excluded (tune 0–1) */
const SCORE_THRESHOLD = 0.25;

/**
 * Fuzzy-search and rank a list of FuzzyItem objects.
 * Scores against title + alternativeTitle.
 */
export function fuzzySearch<T extends FuzzyItem>(
  query: string,
  items: T[],
  threshold: number = SCORE_THRESHOLD
): RankedResult<T>[] {
  if (!query.trim()) return [];

  const q = query.trim();

  return items
    .map((item) => {
      const titleScore = fuzzyScore(q, item.title);
      const altScore = item.alternativeTitle
        ? fuzzyScore(q, item.alternativeTitle)
        : { score: 0, reasons: [] };

      // Also try slug (handles "naruto-shippuden" → "naruto shippuden")
      const slugScore = fuzzyScore(q, item.slug.replace(/-/g, " "));

      const best = [titleScore, altScore, slugScore].reduce((a, b) =>
        a.score >= b.score ? a : b
      );

      return {
        item,
        score: best.score,
        reasons: best.reasons,
      };
    })
    .filter((r) => r.score >= threshold)
    .sort((a, b) => {
      // Primary: fuzzy score (desc)
      if (b.score !== a.score) return b.score - a.score;
      // Secondary: rating (desc)
      return (b.item.rating ?? 0) - (a.item.rating ?? 0);
    });
}
