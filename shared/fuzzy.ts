export interface FuzzyMatch {
  score: number
  indices: number[]
}

const BOUNDARY = new Set(['/', '-', '_', '.', ' ', '(', ')', '[', ']'])

export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase()
  if (!q) return { score: 0, indices: [] }

  const t = target.toLowerCase()
  const indices: number[] = []
  let ti = 0
  let score = 0
  let streak = 0

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    if (ch === ' ') continue

    let found = -1
    for (let i = ti; i < t.length; i++) {
      if (t[i] === ch) {
        found = i
        break
      }
    }
    if (found === -1) return null

    if (indices.length > 0 && found === ti) streak++
    else streak = 0

    score += 16 + streak * 10
    const prev = found === 0 ? '/' : t[found - 1]
    if (BOUNDARY.has(prev)) score += 12
    if (found === 0) score += 8

    indices.push(found)
    ti = found + 1
  }

  score -= Math.floor(target.length / 10)
  score -= Math.floor(indices[indices.length - 1]! / 8)

  return { score, indices }
}

export function rankFuzzy(
  query: string,
  targets: string[],
  limit = 60,
): { path: string; score: number; indices: number[] }[] {
  const out: { path: string; score: number; indices: number[] }[] = []
  for (const path of targets) {
    const match = fuzzyMatch(query, path)
    if (match) out.push({ path, score: match.score, indices: match.indices })
  }
  out.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
  return out.slice(0, limit)
}
