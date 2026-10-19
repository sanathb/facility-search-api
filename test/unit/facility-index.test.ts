import { describe, expect, it } from 'vitest';
import type { FacilitySearch, FacilitySearchResult } from '../../src/domain/facility.js';
import { FacilityIndex } from '../../src/search/facility-index.js';
import { tokenize } from '../../src/search/tokenize.js';
import { facility } from '../helpers.js';

// Alphabetical order by normalised name:
// f2 "anytime city gym", f4 "cafe strength co", f5 "central aquatic centre",
// f1 "city fitness central", f6 "fit fit fitness", f3 "fitlife 24 7"
const index = new FacilityIndex([
  facility('f1', 'City Fitness Central', ['Pool', 'Sauna']),
  facility('f2', 'Anytime City Gym', ['Pool', 'Parking']),
  facility('f3', 'FitLife 24/7', ['24/7 Access']),
  facility('f4', 'Café Strength & Co', ['Sauna', 'Cafe']),
  facility('f5', 'Central Aquatic Centre', ['Olympic Pool']),
  facility('f6', 'Fit Fit Fitness', ['Pool']),
]);

function ids(params: Partial<FacilitySearch>): string[] {
  return index.search({ limit: 100, offset: 0, ...params }).items.map((item) => item.id);
}

describe('FacilityIndex.search — name matching', () => {
  it('matches the start of any word in the name', () => {
    expect(ids({ q: 'cit' })).toEqual(['f1', 'f2']);
  });

  it('ignores case', () => {
    expect(ids({ q: 'CITY' })).toEqual(['f1', 'f2']);
  });

  it('ranks names that start with the query first, then alphabetically', () => {
    // "cen" matches "central" (f1, f5) and "centre" (f5); f5's name starts with "cen".
    expect(ids({ q: 'cen' })).toEqual(['f5', 'f1']);
    // "fit" matches fit, fitness, fitlife; f6 and f3 start with "fit", f1 does not.
    expect(ids({ q: 'fit' })).toEqual(['f6', 'f3', 'f1']);
    // Longer prefixes merge the lists of every word they start: "cent" is central and centre.
    expect(ids({ q: 'cent' })).toEqual(['f5', 'f1']);
  });

  it('handles 1–3 letter prefixes, which use precomputed lists', () => {
    // "c": city (f1, f2), cafe and co (f4), central and centre (f1, f5); f4, f5, f1 start with "c".
    expect(ids({ q: 'c' })).toEqual(['f4', 'f5', 'f1', 'f2']);
    expect(ids({ q: 'C' })).toEqual(['f4', 'f5', 'f1', 'f2']);
    expect(ids({ q: 'fi' })).toEqual(['f6', 'f3', 'f1']);
    expect(ids({ q: 'ci ce' })).toEqual(['f1']);
    expect(ids({ q: 'q' })).toEqual([]);
    expect(ids({ q: 'zq' })).toEqual([]);
  });

  it('requires every typed word to match, in any order', () => {
    expect(ids({ q: 'city cen' })).toEqual(['f1']);
    expect(ids({ q: 'central city' })).toEqual(['f1']);
    expect(ids({ q: 'city aquatic' })).toEqual([]);
  });

  it('does not match the middle of a word', () => {
    expect(ids({ q: 'ness' })).toEqual([]);
    expect(ids({ q: 'life' })).toEqual([]);
  });

  it('matches accented names and numbers', () => {
    expect(ids({ q: 'cafe' })).toEqual(['f4']);
    expect(ids({ q: 'Café' })).toEqual(['f4']);
    expect(ids({ q: '24' })).toEqual(['f3']);
  });

  it('returns nothing for an unknown word or a punctuation-only query', () => {
    expect(index.search({ q: 'zzz', limit: 20, offset: 0 })).toEqual({ items: [], total: 0 });
    expect(index.search({ q: '&&', limit: 20, offset: 0 })).toEqual({ items: [], total: 0 });
  });

  it('returns a facility once even if a word repeats in its name', () => {
    expect(ids({ q: 'fit' }).filter((id) => id === 'f6')).toHaveLength(1);
  });
});

describe('FacilityIndex.search — amenity filter', () => {
  it('matches whole amenity names only', () => {
    // f5 has "Olympic Pool", which is not "Pool".
    expect(ids({ amenities: ['Pool'] })).toEqual(['f2', 'f1', 'f6']);
  });

  it('requires every amenity, ignoring case and surrounding spaces', () => {
    expect(ids({ amenities: ['  pool ', 'SAUNA'] })).toEqual(['f1']);
  });

  it('returns nothing for an unknown amenity', () => {
    expect(ids({ amenities: ['Helipad'] })).toEqual([]);
  });

  it('combines with the name query', () => {
    expect(ids({ q: 'city', amenities: ['Parking'] })).toEqual(['f2']);
  });
});

describe('FacilityIndex.search — listing and pagination', () => {
  it('lists every facility alphabetically when there is no query or filter', () => {
    expect(ids({})).toEqual(['f2', 'f4', 'f5', 'f1', 'f6', 'f3']);
  });

  it('returns the requested page and the total across all pages', () => {
    const page = index.search({ limit: 2, offset: 2 });
    expect(page.items.map((item) => item.id)).toEqual(['f5', 'f1']);
    expect(page.total).toBe(6);
  });

  it('pages across the ranked groups', () => {
    expect(ids({ q: 'c', limit: 2, offset: 1 })).toEqual(['f5', 'f1']);
    expect(ids({ q: 'c', limit: 2, offset: 3 })).toEqual(['f2']);
  });

  it('returns an empty page with the correct total when offset is past the end', () => {
    expect(index.search({ limit: 2, offset: 10 })).toEqual({ items: [], total: 6 });
  });

  it('returns only id, name and address for each result', () => {
    expect(index.search({ q: 'anytime', limit: 1, offset: 0 }).items).toEqual([
      { id: 'f2', name: 'Anytime City Gym', address: 'f2 Test St' },
    ]);
  });

  it('breaks ties between identical names by id', () => {
    const tied = new FacilityIndex([facility('b', 'Same Gym'), facility('a', 'Same Gym')]);
    expect(tied.search({ q: 'same', limit: 10, offset: 0 }).items.map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('FacilityIndex lookups', () => {
  it('finds a facility by id with all its details', () => {
    expect(index.findById('f1')).toEqual(facility('f1', 'City Fitness Central', ['Pool', 'Sauna']));
  });

  it('returns undefined for an unknown id', () => {
    expect(index.findById('nope')).toBeUndefined();
  });

  it('reports its size', () => {
    expect(index.size).toBe(6);
  });
});

describe('FacilityIndex.search — agrees with a brute-force reference', () => {
  // Seeded data with many shared prefixes, repeated words, accents and duplicate names.
  const SYLLABLES = ['ka', 'kal', 'lo', 'mi', 'fit', 'ness', 'Café', 'co', '24', '7'];
  const AMENITIES = ['Pool', 'Sauna', 'Spa', 'Olympic Pool'];
  let seed = 42;
  const random = () => {
    seed = (seed * 16807) % 2147483647; // Park–Miller: reproducible from the seed
    return seed / 2147483647;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const word = () => pick(SYLLABLES) + (random() < 0.5 ? pick(SYLLABLES) : '');
  const facilities = Array.from({ length: 300 }, (_, i) => {
    const words = Array.from({ length: 1 + Math.floor(random() * 3) }, word);
    return facility(
      `f${i}`,
      words.join(random() < 0.2 ? ' & ' : ' '),
      AMENITIES.filter(() => random() < 0.4),
    );
  });

  /** The spec's rules applied directly to every facility: slow, but obviously right. */
  function reference({ q, amenities = [], limit, offset }: FacilitySearch): FacilitySearchResult {
    const terms = q === undefined ? [] : tokenize(q);
    if (q !== undefined && terms.length === 0) return { items: [], total: 0 };
    const query = terms.join(' ');
    const wanted = amenities.map((amenity) => amenity.trim().toLowerCase());
    const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const matches = facilities
      .map((f) => ({ f, words: tokenize(f.name), name: tokenize(f.name).join(' ') }))
      .filter(
        ({ f, words }) =>
          terms.every((term) => words.some((w) => w.startsWith(term))) &&
          wanted.every((a) => f.amenities.some((has) => has.toLowerCase() === a)),
      )
      .sort(
        (a, b) =>
          Number(b.name.startsWith(query)) - Number(a.name.startsWith(query)) ||
          byText(a.name, b.name) ||
          byText(a.f.id, b.f.id),
      );
    return {
      items: matches
        .slice(offset, offset + limit)
        .map(({ f }) => ({ id: f.id, name: f.name, address: f.address })),
      total: matches.length,
    };
  }

  it('returns the same page and total for 500 random searches', () => {
    const subject = new FacilityIndex(facilities);
    for (let i = 0; i < 500; i++) {
      const terms = Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
        word().slice(0, 1 + Math.floor(random() * 4)),
      );
      const params: FacilitySearch = {
        q: random() < 0.1 ? undefined : terms.join(' '),
        amenities: random() < 0.3 ? AMENITIES.filter(() => random() < 0.3) : undefined,
        limit: 1 + Math.floor(random() * 20),
        offset: Math.floor(random() * 30),
      };
      expect(subject.search(params), JSON.stringify(params)).toEqual(reference(params));
    }
  });
});
