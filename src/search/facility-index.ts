import type {
  Facility,
  FacilitySearch,
  FacilitySearchResult,
  FacilitySummary,
} from '../domain/facility.js';
import { tokenize } from './tokenize.js';

const EMPTY = new Uint32Array(0);

/** Prefixes up to this length match so many words that their lists are built at startup. */
const SHORT_PREFIX_LENGTH = 3;

/**
 * In-memory search index over facility names and amenities.
 *
 * Facilities are sorted by name once, at construction, and each one is identified internally by
 * its position in that order (its "ordinal"). Every list of ordinals is kept in ascending order,
 * so any list of matches is already alphabetical: requests never sort facilities by name.
 */
export class FacilityIndex {
  /** Facilities by ordinal. */
  private readonly facilities: readonly Facility[];
  /** Normalised full name by ordinal. Sorted, because ordinals follow name order. */
  private readonly names: readonly string[];
  private readonly byId: ReadonlyMap<string, Facility>;
  /** Every distinct word that appears in a name, sorted. */
  private readonly words: readonly string[];
  /** postings[i] holds the ordinals of the facilities whose name contains words[i]. */
  private readonly postings: readonly Uint32Array[];
  /** 1–3 letter prefix → ordinals of the facilities with a name word starting with it. */
  private readonly shortPrefixes: ReadonlyMap<string, Uint32Array>;
  /** Lowercased amenity name → ordinals of the facilities that have it. */
  private readonly amenities: ReadonlyMap<string, Uint32Array>;
  /** 0 … N-1: the matches for a request with no query and no amenity filter. */
  private readonly allOrdinals: Uint32Array;
  /** Reused by every intersection, so a request allocates no lists of matches. */
  private readonly scratch: [Uint32Array, Uint32Array];

  constructor(facilities: readonly Facility[]) {
    const sorted = facilities
      .map((facility) => ({ facility, name: tokenize(facility.name).join(' ') }))
      .sort((a, b) => compare(a.name, b.name) || compare(a.facility.id, b.facility.id));
    this.facilities = sorted.map((entry) => entry.facility);
    this.names = sorted.map((entry) => entry.name);
    this.byId = new Map(this.facilities.map((facility) => [facility.id, facility]));
    this.allOrdinals = Uint32Array.from(this.facilities.keys());
    this.scratch = [
      new Uint32Array(this.facilities.length),
      new Uint32Array(this.facilities.length),
    ];

    const wordOrdinals = new Map<string, number[]>();
    const shortPrefixOrdinals = new Map<string, number[]>();
    const amenityOrdinals = new Map<string, number[]>();
    // Ordinals are visited in ascending order, so every list built here comes out sorted.
    this.facilities.forEach((facility, ordinal) => {
      const words = new Set(tokenize(facility.name));
      for (const word of words) {
        append(wordOrdinals, word, ordinal);
      }
      for (const prefix of shortPrefixesOf(words)) {
        append(shortPrefixOrdinals, prefix, ordinal);
      }
      for (const amenity of new Set(facility.amenities.map(normaliseAmenity))) {
        append(amenityOrdinals, amenity, ordinal);
      }
    });
    this.words = [...wordOrdinals.keys()].sort(compare);
    this.postings = this.words.map((word) => Uint32Array.from(wordOrdinals.get(word) ?? []));
    this.shortPrefixes = toPostings(shortPrefixOrdinals);
    this.amenities = toPostings(amenityOrdinals);
  }

  get size(): number {
    return this.facilities.length;
  }

  findById(id: string): Facility | undefined {
    return this.byId.get(id);
  }

  search({ q, amenities = [], limit, offset }: FacilitySearch): FacilitySearchResult {
    const terms = q === undefined ? [] : tokenize(q);
    // A query made only of punctuation can't match any name, so return nothing, not everything.
    if (q !== undefined && terms.length === 0) {
      return { items: [], total: 0 };
    }

    const lists = [
      ...unique(terms).map((term) => this.ordinalsWithWordPrefix(term)),
      ...unique(amenities.map(normaliseAmenity)).map(
        (amenity) => this.amenities.get(amenity) ?? EMPTY,
      ),
    ];
    // matches may be a view of a scratch buffer: it is read only before this method returns.
    const matches = lists.length === 0 ? this.allOrdinals : intersectAll(lists, this.scratch);
    const ranked =
      terms.length === 0 ? [matches] : this.rankNamePrefixFirst(matches, terms.join(' '));

    return {
      items: pageOf(ranked, offset, limit).map((ordinal) => this.summary(ordinal)),
      total: matches.length,
    };
  }

  /** Ordinals of the facilities with at least one name word starting with `prefix`. */
  private ordinalsWithWordPrefix(prefix: string): Uint32Array {
    // A 1–3 letter prefix can match many common words; merging their lists on every keystroke
    // would be the slowest path and would churn the garbage collector.
    if (prefix.length <= SHORT_PREFIX_LENGTH) {
      return this.shortPrefixes.get(prefix) ?? EMPTY;
    }
    // Words starting with the prefix sit together in the sorted list; find where they start and end.
    const start = partitionPoint(this.words, (word) => word < prefix);
    const end = partitionPoint(this.words, (word) => word < prefix || word.startsWith(prefix));
    return unionAll(this.postings.slice(start, end));
  }

  /**
   * Splits the matches into names that start with the whole query, then the rest, each group
   * still in name order. Names starting with the query sit together in name order, so they are
   * one run of ordinals: binary search finds it without checking every match.
   */
  private rankNamePrefixFirst(matches: Uint32Array, query: string): Uint32Array[] {
    const first = partitionPoint(this.names, (name) => name < query);
    const last = partitionPoint(this.names, (name) => name < query || name.startsWith(query));
    const from = partitionPoint(matches, (ordinal) => ordinal < first);
    const to = partitionPoint(matches, (ordinal) => ordinal < last);
    return [matches.subarray(from, to), matches.subarray(0, from), matches.subarray(to)];
  }

  private summary(ordinal: number): FacilitySummary {
    const { id, name, address } = this.facilities[ordinal];
    return { id, name, address };
  }
}

function normaliseAmenity(amenity: string): string {
  return amenity.trim().toLowerCase();
}

/** Plain code-unit order: deterministic and locale-independent. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function append(map: Map<string, number[]>, key: string, ordinal: number): void {
  const list = map.get(key);
  if (list) {
    list.push(ordinal);
  } else {
    map.set(key, [ordinal]);
  }
}

function toPostings(map: Map<string, number[]>): Map<string, Uint32Array> {
  return new Map([...map].map(([key, ordinals]) => [key, Uint32Array.from(ordinals)]));
}

/** The 1- to 3-letter prefixes of the given words. */
function shortPrefixesOf(words: Iterable<string>): Set<string> {
  const prefixes = new Set<string>();
  for (const word of words) {
    for (let length = 1; length <= SHORT_PREFIX_LENGTH; length++) {
      prefixes.add(word.slice(0, length));
    }
  }
  return prefixes;
}

/**
 * Binary search over ordered items: the index of the first item for which `isBefore` is false.
 * `isBefore` must be true for a leading run of items and false for the rest.
 */
function partitionPoint<T>(items: ArrayLike<T>, isBefore: (item: T) => boolean): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (isBefore(items[middle])) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/** The ordinals at positions offset … offset + limit - 1 of the lists laid end to end. */
function pageOf(lists: readonly Uint32Array[], offset: number, limit: number): number[] {
  const page: number[] = [];
  let skip = offset;
  for (const list of lists) {
    if (page.length === limit) break;
    if (skip >= list.length) {
      skip -= list.length;
      continue;
    }
    page.push(...list.subarray(skip, skip + limit - page.length));
    skip = 0;
  }
  return page;
}

/** Combines ascending lists into one ascending list with no duplicates, merging pairs of lists
 * round by round as merge sort does: O(P log k) for P ordinals in k lists. */
function unionAll(lists: readonly Uint32Array[]): Uint32Array {
  let round = [...lists];
  while (round.length > 1) {
    const next: Uint32Array[] = [];
    for (let i = 0; i < round.length; i += 2) {
      next.push(i + 1 < round.length ? merge(round[i], round[i + 1]) : round[i]);
    }
    round = next;
  }
  return round[0] ?? EMPTY;
}

/** Merges two ascending lists into one, keeping each ordinal once. */
function merge(a: Uint32Array, b: Uint32Array): Uint32Array {
  const result = new Uint32Array(a.length + b.length);
  let i = 0;
  let j = 0;
  let filled = 0;
  while (i < a.length && j < b.length) {
    if (a[i] < b[j]) {
      result[filled++] = a[i++];
    } else if (a[i] > b[j]) {
      result[filled++] = b[j++];
    } else {
      result[filled++] = a[i++];
      j++;
    }
  }
  result.set(a.subarray(i), filled);
  filled += a.length - i;
  result.set(b.subarray(j), filled);
  filled += b.length - j;
  return result.subarray(0, filled);
}

/**
 * Intersects ascending lists, shortest first, so the working set only ever shrinks. Each step
 * writes into the scratch buffer that the previous step did not, so no input is overwritten.
 */
function intersectAll(
  lists: readonly Uint32Array[],
  scratch: readonly [Uint32Array, Uint32Array],
): Uint32Array {
  const [shortest = EMPTY, ...rest] = [...lists].sort((a, b) => a.length - b.length);
  let result = shortest;
  for (let step = 0; step < rest.length && result.length > 0; step++) {
    result = intersect(result, rest[step], scratch[step % 2]);
  }
  return result;
}

/** Two-pointer intersection of two ascending lists, written into the start of `result`. */
function intersect(a: Uint32Array, b: Uint32Array, result: Uint32Array): Uint32Array {
  let i = 0;
  let j = 0;
  let found = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result[found++] = a[i];
      i++;
      j++;
    } else if (a[i] < b[j]) {
      i++;
    } else {
      j++;
    }
  }
  return result.subarray(0, found);
}
