// Hand-rolled fuzzy scorer. Goals:
//   - subsequence match (query chars appear in order in target, possibly with gaps)
//   - higher score for matches at the start, at word boundaries, and in runs
//   - returns null when no match, so callers can filter then sort by score desc
//
// Preferred over fuse.js because the bundle cost was unjustifiable for the
// ~30-line scorer we actually need here.

const WORD_BOUNDARY_CHARS = new Set([" ", "/", "-", "_", ".", "\\"]);

export interface FuzzyMatch {
  score: number;
  indices: number[];
}

export function fuzzyScore(query: string, target: string): FuzzyMatch | null {
  if (!query) return { score: 0, indices: [] };
  if (!target) return null;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let qi = 0;
  let score = 0;
  let lastMatchedAt = -2;
  let prevCharBoundary = true;
  const indices: number[] = [];

  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    const tc = t[ti] ?? "";
    if (tc === q[qi]) {
      indices.push(ti);
      // Start-of-string and word-boundary matches are worth more.
      let bonus = 1;
      if (ti === 0) bonus += 4;
      else if (prevCharBoundary) bonus += 2;
      // Consecutive matches build runs — weighted higher than word-boundary
      // hops so tight substring matches outrank scattered ones.
      if (lastMatchedAt === ti - 1) bonus += 3;
      score += bonus;
      lastMatchedAt = ti;
      qi += 1;
    }
    prevCharBoundary = WORD_BOUNDARY_CHARS.has(tc);
  }

  if (qi < q.length) return null;

  // Shorter targets beat longer ones for the same query — by a small amount.
  score -= Math.floor(t.length / 20);

  return { score, indices };
}
