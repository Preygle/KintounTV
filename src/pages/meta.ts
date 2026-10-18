import type { Featured } from "../api";

export function metaLine(f: Featured): string {
  const score = f.score != null && f.score !== "" ? `★ ${f.score}` : null;
  return [f.type, f.status, f.runtime, f.premiered, f.age, score].filter(Boolean).join("  •  ");
}
