// Franchise map for the details page. The catalog only lists a title's direct relations (its
// `seasons` field: related titles labelled Sequel, Side Story, Summary, ...), so the relations are
// crawled into a graph and laid out as a watch order: the sequel/prequel line holding the main
// series, with every other title (movies, OVAs, recaps, spin-offs) under the step it belongs to.
import { api, type PostDetail } from "./api";

export interface FranchiseNode {
  id: number;
  title: string;
  type: string | null; // TV, ONA, Movie, OVA, Special, ...
  premiered: string | null; // "Spring 2013"
  status: string | null;
  runtime: string | null; // "24m"
  poster: string;
  links: { id: number; label: string }[];
  loaded: boolean; // false: its details failed to load; only the poster and relation are known
}

export interface Extra {
  node: FranchiseNode;
  label: string; // relation to the step (or to `via`), e.g. "Side Story"
  via: FranchiseNode | null; // set when only linked through another extra
}

export interface Step {
  node: FranchiseNode;
  extras: Extra[];
}

const MAX_TITLES = 80;
const PARALLEL = 6;
// Relations crawled further. The others (Alternative Setting, Character, Other) are shown but not
// expanded: they lead into separate franchises (shared universes, crossovers).
const FOLLOW = new Set(["Sequel", "Prequel", "Parent Story", "Side Story", "Summary", "Full Story", "Alternative Version", "Spin-off"]);
const PARENT = new Set(["Parent Story", "Full Story"]);
const INVERSE: Record<string, string> = {
  Sequel: "Prequel",
  Prequel: "Sequel",
  "Parent Story": "Side Story",
  "Side Story": "Parent Story",
  "Full Story": "Summary",
  Summary: "Full Story",
};
const SERIES = new Set(["TV", "ONA"]);
const SEASONS = ["winter", "spring", "summer", "fall"];

function toNode(p: PostDetail): FranchiseNode {
  return {
    id: p.id,
    title: p.title,
    type: p.type,
    premiered: p.premiered,
    status: p.status,
    runtime: p.runtime,
    poster: p.poster,
    links: (p.seasons ?? []).map((s) => ({ id: s.id, label: s.title })),
    loaded: true,
  };
}

/** Crawls the relations of `start` into a graph of up to MAX_TITLES titles. */
export function crawlFranchise(start: PostDetail, load: (id: number) => Promise<PostDetail> = api.post): Promise<Map<number, FranchiseNode>> {
  const nodes = new Map<number, FranchiseNode>();
  const hints = new Map<number, { poster: string; label: string }>(); // for titles that fail to load
  const follow = new Set([start.id]);
  const expanded = new Set<number>();
  const queued = new Set([start.id]);
  const queue: number[] = [];

  const expand = (node: FranchiseNode) => {
    if (expanded.has(node.id) || !follow.has(node.id)) return;
    expanded.add(node.id);
    for (const link of node.links) {
      if (FOLLOW.has(link.label)) follow.add(link.id);
      const known = nodes.get(link.id);
      if (known) {
        expand(known); // reached again through a followed relation
      } else if (!queued.has(link.id) && queued.size < MAX_TITLES) {
        queued.add(link.id);
        queue.push(link.id);
      }
    }
  };
  const add = (node: FranchiseNode) => {
    nodes.set(node.id, node);
    expand(node);
  };
  for (const s of start.seasons ?? []) hints.set(s.id, { poster: s.poster, label: s.title });
  add(toNode(start));

  return new Promise((resolve) => {
    let active = 0;
    const pump = () => {
      while (active < PARALLEL && queue.length) {
        const id = queue.shift()!;
        active++;
        load(id)
          .then((p) => {
            for (const s of p.seasons ?? []) if (!hints.get(s.id)?.poster) hints.set(s.id, { poster: s.poster, label: s.title });
            add(toNode(p));
          })
          .catch(() => {
            const hint = hints.get(id);
            nodes.set(id, { id, title: hint?.label ?? "Related", type: null, premiered: null, status: null, runtime: null, poster: hint?.poster ?? "", links: [], loaded: false });
          })
          .finally(() => {
            active--;
            pump();
          });
      }
      if (!active && !queue.length) resolve(nodes);
    };
    pump();
  });
}

export function isSeries(node: FranchiseNode): boolean {
  return SERIES.has(node.type ?? "");
}

/** Release order key from "Spring 2013" / "2013"; unknown dates sort last. */
function dateKey(node: FranchiseNode): number {
  const m = /(winter|spring|summer|fall)?\s*(\d{4})/i.exec(node.premiered ?? "");
  if (!m) return Number.MAX_SAFE_INTEGER;
  return Number(m[2]) * 4 + (m[1] ? SEASONS.indexOf(m[1].toLowerCase()) : 0);
}

const byDate = (a: FranchiseNode, b: FranchiseNode) => dateKey(a) - dateKey(b) || a.id - b.id;

/** The relation `from` declares to `to`, if any. */
function relation(from: FranchiseNode, to: number): string | undefined {
  return from.links.find((l) => l.id === to)?.label;
}

/** Relation of `to` as seen from `from`, using `to`'s own label when `from` doesn't list it. */
function relationBetween(from: FranchiseNode, to: FranchiseNode): string | undefined {
  const own = relation(from, to.id);
  if (own) return own;
  const back = relation(to, from.id);
  return back && (INVERSE[back] ?? back);
}

/** Lays the graph out as watch-order steps with their extras. */
export function layoutFranchise(nodes: Map<number, FranchiseNode>, startId: number): Step[] {
  const get = (id: number) => nodes.get(id)!;
  // Sequel/prequel edges, earlier -> later.
  const after = new Map<number, Set<number>>();
  const before = new Map<number, Set<number>>();
  const edge = (a: number, b: number) => {
    if (!nodes.has(a) || !nodes.has(b) || a === b) return;
    (after.get(a) ?? after.set(a, new Set()).get(a)!).add(b);
    (before.get(b) ?? before.set(b, new Set()).get(b)!).add(a);
  };
  for (const n of nodes.values()) {
    for (const l of n.links) {
      if (l.label === "Sequel") edge(n.id, l.id);
      else if (l.label === "Prequel") edge(l.id, n.id);
    }
  }

  // Sequel/prequel lines (connected components).
  const lineOf = new Map<number, number[]>();
  for (const id of nodes.keys()) {
    if (lineOf.has(id)) continue;
    const line: number[] = [];
    const stack = [id];
    while (stack.length) {
      const x = stack.pop()!;
      if (lineOf.has(x)) continue;
      lineOf.set(x, line);
      line.push(x);
      stack.push(...(after.get(x) ?? []), ...(before.get(x) ?? []));
    }
  }

  // The main line: the one holding this title if it has a series in it (a movie or OVA page shows
  // its parent's line), else the line with the most series.
  const seriesCount = (line: number[]) => line.filter((id) => isSeries(get(id))).length;
  const start = get(startId);
  let main = lineOf.get(startId)!;
  if (!seriesCount(main)) {
    const parents = start.links.filter((l) => PARENT.has(l.label) && nodes.has(l.id)).map((l) => lineOf.get(l.id)!);
    const lines = [...new Set(lineOf.values())].sort((a, b) => seriesCount(b) - seriesCount(a) || b.length - a.length);
    main = parents.find(seriesCount) ?? (seriesCount(lines[0]) ? lines[0] : main);
  }

  // Remasters: a line can fork into an original series and an "Alternative Version" series
  // (Dragon Ball continues as both Z and the Kai remaster). Keep the branch holding this title (else the
  // earlier one); the other branch, and whatever only follows from it, becomes extras below.
  const inMain = new Set(main);
  const parentInMain = start.links.find((l) => PARENT.has(l.label) && inMain.has(l.id))?.id;
  const anchorId = inMain.has(startId) ? startId : parentInMain;
  const leadsTo = (from: number, target: number) => {
    const seen = new Set<number>();
    const stack = [from];
    while (stack.length) {
      const x = stack.pop()!;
      if (x === target) return true;
      if (seen.has(x)) continue;
      seen.add(x);
      for (const n of after.get(x) ?? []) if (inMain.has(n)) stack.push(n);
    }
    return false;
  };
  const dropped = new Set<number>();
  for (const id of main) {
    for (const l of get(id).links) {
      if (l.label !== "Alternative Version" || !inMain.has(l.id)) continue;
      const [a, b] = [get(id), get(l.id)];
      if (!isSeries(a) || !isSeries(b)) continue; // a TV retelling of a movie is watched in sequence
      const aHolds = anchorId !== undefined && leadsTo(a.id, anchorId);
      const bHolds = anchorId !== undefined && leadsTo(b.id, anchorId);
      if (aHolds !== bHolds) dropped.add(aHolds ? b.id : a.id);
      else if (!aHolds) dropped.add(byDate(a, b) < 0 ? b.id : a.id);
    }
  }
  const sources = main.filter((id) => ![...(before.get(id) ?? [])].some((p) => inMain.has(p)));
  const kept = new Set<number>();
  const stack = sources.filter((id) => !dropped.has(id));
  while (stack.length) {
    const x = stack.pop()!;
    if (kept.has(x)) continue;
    kept.add(x);
    for (const n of after.get(x) ?? []) if (inMain.has(n) && !dropped.has(n)) stack.push(n);
  }
  if (!kept.size) main.forEach((id) => kept.add(id));
  if (anchorId !== undefined) kept.add(anchorId);

  // Watch order: sequels after prequels; parallel entries (a movie and the next season) by date.
  const waiting = new Map([...kept].map((id) => [id, [...(before.get(id) ?? [])].filter((p) => kept.has(p)).length]));
  const ready = [...kept].filter((id) => !waiting.get(id));
  const order: number[] = [];
  while (ready.length) {
    ready.sort((x, y) => byDate(get(x), get(y)));
    const id = ready.shift()!;
    order.push(id);
    for (const next of after.get(id) ?? []) {
      if (!kept.has(next)) continue;
      waiting.set(next, waiting.get(next)! - 1);
      if (!waiting.get(next)) ready.push(next);
    }
  }
  for (const id of [...kept].sort((x, y) => byDate(get(x), get(y)))) if (!order.includes(id)) order.push(id); // cycles

  // Every other title goes under the latest step it's directly related to (a recap of seasons 1-3
  // after season 3)...
  const stepOf = new Map(order.map((id, i) => [id, i]));
  const placed = new Map<number, { step: number; label: string; via: number | null }>();
  for (const node of nodes.values()) {
    if (stepOf.has(node.id)) continue;
    for (const [stepId, i] of stepOf) {
      const label = relationBetween(get(stepId), node);
      if (label && (placed.get(node.id)?.step ?? -1) < i) placed.set(node.id, { step: i, label, via: null });
    }
  }
  // ...and titles linked only through those inherit their step, nearest first.
  let frontier = [...placed.keys()];
  while (frontier.length) {
    const next: number[] = [];
    for (const viaId of frontier) {
      for (const node of nodes.values()) {
        if (stepOf.has(node.id) || placed.has(node.id)) continue;
        const label = relationBetween(get(viaId), node);
        if (!label) continue;
        placed.set(node.id, { step: placed.get(viaId)!.step, label, via: viaId });
        next.push(node.id);
      }
    }
    frontier = next;
  }

  const steps: Step[] = order.map((id) => ({ node: get(id), extras: [] }));
  for (const node of nodes.values()) {
    if (stepOf.has(node.id)) continue;
    const p = placed.get(node.id) ?? { step: 0, label: "Other", via: null };
    steps[p.step].extras.push({ node, label: p.label, via: p.via === null ? null : get(p.via) });
  }
  for (const step of steps) step.extras.sort((a, b) => byDate(a.node, b.node));
  return steps;
}
