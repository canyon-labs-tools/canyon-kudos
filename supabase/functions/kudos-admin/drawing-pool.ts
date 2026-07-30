// Builds the quarterly drawing pool: turns nomination rows into one entry per
// person, each routed to a site.
//
// Two things make this non-trivial:
//
//   1. Nominations are frequently written as a group — "Tammy Boudreau, Ollie
//      LaPierre, Tyler Boudreau" or "Jason LaPierre and Clint Christensen".
//      The slide deck and the weekly email keep those together (that is the
//      point of a group recognition), but the wheel gives away one gift card,
//      so every named person needs their own slice.
//
//   2. Nominations are typed by hand and use the name people go by, while the
//      HR roster carries the legal name — "Katie Conrad" vs "Katherine
//      Conrad", "Zach Simolo" vs "Zachary Simolo", "Sam Gomez" vs "Samuel
//      Gomez Gonzalez". Matching has to tolerate that without ever guessing
//      between two plausible people.
//
// Anything the ladder cannot resolve confidently comes back as unresolved so
// an admin assigns it by hand before spinning. Nobody is silently dropped and
// nobody is silently sent to the wrong meeting.

export type RosterEntry = {
  full_name: string;
  work_email: string | null;
  site: string | null;
};

export type Confidence = "manual" | "exact" | "likely" | "fuzzy" | "none";

export type PoolPerson = {
  /**
   * Identity key. Once a nomination resolves to the roster this is the roster
   * name, so "Nancy Rakiewicz" and "Nancy.Rakiewicz@canyonlabs.com" collapse
   * to one slice rather than handing her two shots at the gift card.
   */
  id: string;
  /** What to show on the wheel. */
  name: string;
  /** Every spelling seen in a nomination. Alias overrides are keyed off these. */
  aliasKeys: string[];
  /** As typed, for the admin's reference. */
  raw: string;
  site: string | null;
  confidence: Confidence;
  /** Roster name we matched to, when it differs from what was typed. */
  matchedTo: string | null;
  /** Nomination ids this person appears in, for recording the winner. */
  recognitionIds: string[];
  /** True when this person was one of several in a single nomination. */
  fromGroup: boolean;
};

// ── name normalisation ────────────────────────────────────────────────────

const stripAccents = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Lowercased, de-accented, punctuation-free, single-spaced. */
export function norm(s: string): string {
  return stripAccents(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9@.\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tokens = (s: string) =>
  norm(s).replace(/[.'-]/g, " ").replace(/\s+/g, " ").trim().split(" ")
    .filter(Boolean);

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/**
 * "wendy mach" -> "Wendy Mach" and the roster's "DOUGLAS Bolton" -> "Douglas
 * Bolton", while "McElroy" and "LaPierre" keep their deliberate inner capitals.
 * These names go on a screen in front of the whole site, so they should read
 * like names rather than like a payroll export.
 */
export function tidyName(s: string): string {
  return (s || "").trim().split(/\s+/)
    .map((w) => {
      if (w === w.toLowerCase()) return w.charAt(0).toUpperCase() + w.slice(1);
      if (w.length > 1 && w === w.toUpperCase()) {
        return w.charAt(0) + w.slice(1).toLowerCase();
      }
      return w;
    })
    .join(" ");
}

/** bo.rich@canyonlabs.com -> "Bo Rich" */
function nameFromEmail(email: string): string {
  return tidyName(
    email.split("@")[0].replace(/[._-]+/g, " ").replace(/\d+/g, "").trim(),
  );
}

/** One character of difference or less. Used only as a last resort, on surnames. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** "dan" matches "daniel"; "rich" matches "richard". Guards against "d" ~ "david". */
const prefixMatch = (a: string, b: string) =>
  a === b || (a.length >= 3 && b.startsWith(a)) || (b.length >= 3 && a.startsWith(b));

// ── splitting group nominations ───────────────────────────────────────────

/**
 * "Tammy Boudreau, Ollie LaPierre and Tyler Boudreau" -> three names.
 *
 * Guarded against the "Boudreau, Tammy" surname-first form, which would
 * otherwise split one person into two.
 */
export function splitRecipients(raw: string): string[] {
  // Collapse spaces and tabs but KEEP line breaks: a list pasted out of Teams
  // or a document is one name per line, and flattening it first would hide
  // everyone after the first.
  let text = (raw || "").replace(/[^\S\n]+/g, " ").trim();
  if (!text) return [];

  // "w/" means "with", i.e. another person. Without this the slash splits
  // mid-phrase and leaves a stray "w" welded to the first name.
  text = text.replace(/\s+w\/\s*/gi, " and ");

  const parts = text
    .split(/\s*[,;\/]\s*|\s+(?:and|&|\+)\s+|\n+/i)
    // "A, B, and C" — the comma branch consumes the comma first, stranding the
    // conjunction on the front of the last name ("and Alexis Au").
    .map((p) => p.trim().replace(/^(?:and|&|\+)\s+/i, "").trim())
    .filter(Boolean);

  if (parts.length < 2) return [text];

  // "Smith, John" is one person written surname-first. "Tanner and Eleesa" is
  // two colleagues who each go by a single name — and both of those are real
  // nominations here. Only the comma form can be a reversed name, so a
  // conjunction anywhere in the text rules the guard out.
  const commaOnly = !/\s(?:and|&|\+)\s|[;\/\n]/i.test(text);
  if (commaOnly && parts.length === 2 &&
      parts.every((p) => p.split(" ").length === 1) &&
      !parts.some(isEmail)) {
    return [text];
  }

  return parts;
}

// ── roster matching ───────────────────────────────────────────────────────

type Index = {
  byEmail: Map<string, RosterEntry>;
  byFull: Map<string, RosterEntry[]>;
  byEmailName: Map<string, RosterEntry[]>;
  byEmailNick: Map<string, RosterEntry[]>;
  byLast: Map<string, RosterEntry[]>;
  byFirst: Map<string, RosterEntry[]>;
  all: RosterEntry[];
};

const push = <T>(m: Map<string, T[]>, k: string, v: T) => {
  if (!k) return;
  const cur = m.get(k);
  if (cur) cur.push(v);
  else m.set(k, [v]);
};

export function buildIndex(roster: RosterEntry[]): Index {
  const ix: Index = {
    byEmail: new Map(), byFull: new Map(), byEmailName: new Map(),
    byEmailNick: new Map(), byLast: new Map(), byFirst: new Map(), all: roster,
  };
  for (const e of roster) {
    const t = tokens(e.full_name);
    if (!t.length) continue;
    if (e.work_email) ix.byEmail.set(norm(e.work_email), e);
    push(ix.byFull, norm(e.full_name), e);
    push(ix.byFirst, t[0], e);
    push(ix.byLast, t[t.length - 1], e);

    if (e.work_email) {
      const local = norm(e.work_email).split("@")[0];
      // The address itself often carries the name people actually use, and it
      // survives name changes the roster has already absorbed —
      // lin.elsbree@ still belongs to the row now reading "Linda Bensinger".
      const asName = local.replace(/[._-]+/g, " ").replace(/\d+/g, "").trim();
      if (asName.includes(" ")) push(ix.byEmailName, asName, e);
      // liz.steiner@ indexed as "liz|steiner" so the name people go by
      // resolves even when the roster carries "Elizabeth Steiner".
      const nick = local.split(/[._-]/)[0];
      if (nick && nick.length >= 2) push(ix.byEmailNick, `${nick}|${t[t.length - 1]}`, e);
    }
  }
  return ix;
}

/** Exactly one candidate, or nothing. Ambiguity is always handed to a human. */
const only = (xs: RosterEntry[] | undefined) =>
  xs && xs.length === 1 ? xs[0] : null;

/** The name in front of the @, e.g. steve.greene@ -> "steve". */
function emailNick(e: RosterEntry): string {
  if (!e.work_email) return "";
  return norm(e.work_email).split("@")[0].split(/[._-]/)[0];
}

/**
 * Does the given name the nomination used point at this roster row?
 *
 * Covers the shortening the roster does not carry ("Dan" for Daniel) and the
 * nickname only the email address knows ("Steve" for Stephen) — the roster
 * holds legal names, so without the second one Stephen Greene is only
 * reachable if somebody types "Stephen".
 */
function firstNameMatches(first: string, e: RosterEntry): boolean {
  const rosterFirst = tokens(e.full_name)[0] ?? "";
  if (prefixMatch(first, rosterFirst)) return true;
  const nick = emailNick(e);
  return !!nick && prefixMatch(first, nick);
}

export function matchPerson(
  rawName: string,
  ix: Index,
): { entry: RosterEntry | null; confidence: Confidence } {
  const raw = (rawName || "").trim();
  if (!raw) return { entry: null, confidence: "none" };

  // Submitted as an email address — the strongest signal available.
  if (isEmail(raw)) {
    const hit = ix.byEmail.get(norm(raw));
    if (hit) return { entry: hit, confidence: "exact" };
  }

  const name = isEmail(raw) ? nameFromEmail(raw) : raw;
  const t = tokens(name);
  if (!t.length) return { entry: null, confidence: "none" };
  const first = t[0];
  const last = t[t.length - 1];

  const exact = only(ix.byFull.get(norm(name)));
  if (exact) return { entry: exact, confidence: "exact" };

  const byAddr = only(ix.byEmailName.get(t.join(" ")));
  if (byAddr) return { entry: byAddr, confidence: "exact" };

  const nick = only(ix.byEmailNick.get(`${first}|${last}`));
  if (nick) return { entry: nick, confidence: "exact" };

  // Same surname, and the given name is a shortening of the roster's.
  const sameLast = ix.byLast.get(last) ?? [];
  if (sameLast.length) {
    const byFirst = sameLast.filter((e) => firstNameMatches(first, e));
    const hit = only(byFirst);
    if (hit) return { entry: hit, confidence: "likely" };
    if (byFirst.length > 1) return { entry: null, confidence: "none" };
  }

  // Every token typed appears in the roster name — catches middle names and
  // second surnames ("Angus Lam" in "Tin Long Angus Lam").
  if (t.length >= 2) {
    const subset = ix.all.filter((e) => {
      const rt = tokens(e.full_name);
      return t.every((tok) => rt.some((r) => prefixMatch(tok, r)));
    });
    const hit = only(subset);
    if (hit) return { entry: hit, confidence: "likely" };
  }

  // A lone first name, unique across the roster.
  if (t.length === 1) {
    const hit = only(ix.byFirst.get(first));
    if (hit) return { entry: hit, confidence: "likely" };
    return { entry: null, confidence: "none" };
  }

  // Typo in the surname. Deliberately last.
  const fuzzy = ix.all.filter((e) => {
    const rt = tokens(e.full_name);
    return withinOneEdit(last, rt[rt.length - 1]) && firstNameMatches(first, e);
  });
  const fuzzyHit = only(fuzzy);
  if (fuzzyHit) return { entry: fuzzyHit, confidence: "fuzzy" };

  // "Greene, Steve" — surname first. Only tried once everything else has
  // failed, so a genuine two-word name is never reinterpreted.
  if (t.length === 2) {
    const swapped = matchSwapped(t[1], t[0], ix);
    if (swapped) return { entry: swapped, confidence: "fuzzy" };
  }

  return { entry: null, confidence: "none" };
}

/** Second pass for a name written surname-first. */
function matchSwapped(
  first: string,
  last: string,
  ix: Index,
): RosterEntry | null {
  const exact = only(ix.byFull.get(`${first} ${last}`));
  if (exact) return exact;
  const sameLast = ix.byLast.get(last) ?? [];
  return only(sameLast.filter((e) => firstNameMatches(first, e)));
}

// ── pool assembly ─────────────────────────────────────────────────────────

export type Recognition = {
  id: string;
  recipient_name: string;
  core_value?: string | null;
};

export type Alias = {
  alias_key: string;
  display_name: string | null;
  site: string | null;
};

/**
 * One entry per person, deduplicated across nominations. Someone recognised
 * three times still gets a single slice — the wheel awards one gift card per
 * site, and equal slices have to mean equal odds.
 */
export function buildPool(
  recognitions: Recognition[],
  roster: RosterEntry[],
  aliases: Alias[],
): PoolPerson[] {
  const ix = buildIndex(roster);
  const aliasBy = new Map(aliases.map((a) => [a.alias_key, a]));
  const byId = new Map<string, PoolPerson>();
  const rank: Record<Confidence, number> = {
    manual: 5, exact: 4, likely: 3, fuzzy: 2, none: 1,
  };

  for (const rec of recognitions) {
    const names = splitRecipients(rec.recipient_name || "");
    const fromGroup = names.length > 1;

    for (const rawName of names) {
      const aliasKey = norm(rawName);
      if (!aliasKey) continue;

      const alias = aliasBy.get(aliasKey);
      const { entry, confidence } = matchPerson(rawName, ix);

      // Identity, not spelling. Two nominations that resolve to the same
      // roster row are the same person and share one slice.
      const id = entry ? `roster:${norm(entry.full_name)}` : `raw:${aliasKey}`;
      const conf: Confidence = alias ? "manual" : confidence;

      const existing = byId.get(id);
      if (existing) {
        if (!existing.recognitionIds.includes(rec.id)) {
          existing.recognitionIds.push(rec.id);
        }
        if (!existing.aliasKeys.includes(aliasKey)) existing.aliasKeys.push(aliasKey);
        existing.fromGroup = existing.fromGroup || fromGroup;
        // A later, better-evidenced spelling upgrades the entry.
        if (rank[conf] > rank[existing.confidence]) {
          existing.confidence = conf;
          if (alias?.site ?? entry?.site) existing.site = alias?.site ?? entry?.site ?? null;
        }
        continue;
      }

      const display = alias?.display_name ??
        (entry ? tidyName(entry.full_name)
               : tidyName(isEmail(rawName) ? nameFromEmail(rawName) : rawName));

      byId.set(id, {
        id,
        name: display,
        aliasKeys: [aliasKey],
        raw: rawName,
        site: alias?.site ?? entry?.site ?? null,
        confidence: conf,
        matchedTo: entry && norm(entry.full_name) !== aliasKey ? tidyName(entry.full_name) : null,
        recognitionIds: [rec.id],
        fromGroup,
      });
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Which wheel a person belongs on. The Rochester meeting draws Rochester
 * staff; the Salt Lake meeting draws Salt Lake staff plus remote workers.
 */
export const MEETINGS: Record<string, string[]> = {
  ROC: ["ROC"],
  SLC: ["SLC", "Remote"],
};
