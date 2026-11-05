/**
 * Rumus skor — Fase 2 (plan bagian 6).
 *
 * Fungsi murni (tanpa DB, tanpa HTTP) agar mudah diuji dengan bun test.
 * - maxLevel satu sesi = nilai v terbesar di session_scale_levels sesi itu.
 * - Skor satu elemen = rata-rata value indikator yang terisi di elemen itu.
 * - Skor keseluruhan sesi = rata-rata value semua indikator yang terisi.
 * - Skor 0–100 = skor / maxLevel * 100.
 * - Nilai akhir sesi = skor keseluruhan dalam skala 100.
 * - Predikat = label dari session_predicates yang rentangnya memuat nilai
 *   akhir; bila tidak ada rentang yang memuat, predikat = "—".
 */

export type ScoredIndicator = {
  value: number | null;
  element_code: string;
  element_title: string;
};

export type PredicateRange = { min: number; max: number; label: string };

export function maxLevel(scaleLevels: { v: number }[]): number {
  if (scaleLevels.length === 0) return 4;
  return Math.max(...scaleLevels.map((l) => l.v));
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Rata-rata per elemen (hanya indikator yang sudah berskor). */
export function elementScores(
  indicators: ScoredIndicator[],
): { element_code: string; element_title: string; average: number | null; filled: number; total: number }[] {
  const groups = new Map<string, { title: string; values: number[]; total: number }>();
  for (const ind of indicators) {
    const g = groups.get(ind.element_code) ?? { title: ind.element_title, values: [], total: 0 };
    g.total += 1;
    if (ind.value !== null) g.values.push(ind.value);
    groups.set(ind.element_code, g);
  }
  return [...groups.entries()].map(([code, g]) => ({
    element_code: code,
    element_title: g.title,
    average: avg(g.values),
    filled: g.values.length,
    total: g.total,
  }));
}

/** Skor keseluruhan sesi (rata-rata semua indikator yang terisi), atau null bila belum ada skor. */
export function overallScore(indicators: ScoredIndicator[]): number | null {
  return avg(indicators.filter((i) => i.value !== null).map((i) => i.value as number));
}

/** Ubah skor mentah (dalam skala templat) menjadi skala 0–100. */
export function toScore100(score: number | null, max: number): number | null {
  if (score === null || max <= 0) return null;
  return (score / max) * 100;
}

/** Nilai akhir sesi dalam skala 100 (null bila belum ada indikator berskor). */
export function finalScore100(
  indicators: ScoredIndicator[],
  scaleLevels: { v: number }[],
): number | null {
  return toScore100(overallScore(indicators), maxLevel(scaleLevels));
}

/** Predikat untuk nilai akhir; "—" bila tidak ada rentang yang memuat. */
export function predicateFor(score100: number | null, predicates: PredicateRange[]): string {
  if (score100 === null) return "—";
  const hit = predicates.find((p) => score100 >= p.min && score100 <= p.max);
  return hit ? hit.label : "—";
}

/** Label level yang paling sering muncul (untuk pratinjau narasi). */
export function mostFrequentLabel(
  indicators: { value: number | null }[],
  scaleLevels: { v: number; label: string }[],
): string | null {
  const counts = new Map<number, number>();
  for (const ind of indicators) {
    if (ind.value === null) continue;
    counts.set(ind.value, (counts.get(ind.value) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best: number | null = null;
  let bestCount = -1;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return scaleLevels.find((l) => l.v === best)?.label ?? null;
}
