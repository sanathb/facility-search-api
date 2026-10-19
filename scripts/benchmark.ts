/**
 * Measures the search index against a full scan on synthetic data.
 *
 *   npm run bench            # 100,000 facilities
 *   npm run bench -- 500000  # any size
 *
 * Data comes from a seeded generator, so every run searches the same facilities.
 */
import { loadFacilities } from '../src/data/load-facilities.js';
import type { Facility, FacilitySearch } from '../src/domain/facility.js';
import { FacilityIndex } from '../src/search/facility-index.js';
import { tokenize } from '../src/search/tokenize.js';

const COUNT = Number(process.argv[2] ?? 100_000);
const ITERATIONS = 1_000;
const WARM_UP = 200;

const SYLLABLES = ['ka', 'lo', 'mi', 'ra', 'ten', 'vo', 'zu', 'ber', 'dax', 'fin', 'gor', 'hal'];
const KINDS = ['Fitness', 'Gym', 'Health Club', 'Strength', 'Wellness', 'Athletic Club', 'Yoga'];
const PLACES = ['Sydney', 'Parramatta', 'Bondi', 'Manly', 'Melbourne', 'Fitzroy', 'Geelong'];

const QUERIES: Record<string, Omit<FacilitySearch, 'limit' | 'offset'>[]> = {
  '1 letter': [{ q: 's' }, { q: 'f' }, { q: 'k' }, { q: 'm' }],
  '2 letters': [{ q: 'fi' }, { q: 'ka' }, { q: 'sy' }, { q: 'gy' }],
  '3 letters': [{ q: 'fit' }, { q: 'ber' }, { q: 'gym' }, { q: 'syd' }],
  // "kalo" and "berka" each start 13 brand words: the case that merges lists per request.
  '4+ letters': [{ q: 'kalo' }, { q: 'berka' }, { q: 'fitn' }, { q: 'wellness' }],
  'multi-word': [{ q: 'ka fit' }, { q: 'gym bondi' }, { q: 'health club syd' }],
  'with amenities': [{ q: 'fit', amenities: ['Pool', 'Sauna'] }, { amenities: ['Spa'] }],
  'no match': [{ q: 'zzzz' }, { q: 'qux' }],
};

/** mulberry32: a tiny seeded random number generator. */
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generate(count: number, amenityNames: string[]): Facility[] {
  const random = seededRandom(42);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const brand = () => {
    const word = Array.from({ length: 2 + Math.floor(random() * 2) }, () => pick(SYLLABLES)).join(
      '',
    );
    return word[0].toUpperCase() + word.slice(1);
  };
  return Array.from({ length: count }, (_, i) => ({
    id: `facility-${i + 1}`,
    name: `${brand()} ${pick(KINDS)} ${pick(PLACES)}`,
    address: `${i + 1} Example St, ${pick(PLACES)}`,
    location: { latitude: -33 - random(), longitude: 151 + random() },
    amenities: amenityNames.filter(() => random() < 0.2),
  }));
}

/** The simplest alternative: check every facility on every request. No ranking or sorting. */
function fullScan(names: string[], amenitySets: Set<string>[], params: FacilitySearch): number {
  const terms = params.q === undefined ? [] : tokenize(params.q);
  const amenities = (params.amenities ?? []).map((a) => a.toLowerCase());
  let total = 0;
  for (let i = 0; i < names.length; i++) {
    if (!terms.every((term) => names[i].includes(term))) continue;
    if (amenities.every((a) => amenitySets[i].has(a))) total++;
  }
  return total;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function time(run: (params: FacilitySearch) => unknown, queries: FacilitySearch[]): number[] {
  globalThis.gc?.(); // start each measurement with a clean heap
  for (let i = 0; i < WARM_UP; i++) run(queries[i % queries.length]);
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    run(queries[i % queries.length]);
    samples.push(performance.now() - start);
  }
  return samples.sort((a, b) => a - b);
}

const ms = (value: number) => `${value.toFixed(3)} ms`;

/** JS heap plus typed-array storage, which lives outside the heap. */
function memoryInUse(): number {
  const { heapUsed, arrayBuffers } = process.memoryUsage();
  return heapUsed + arrayBuffers;
}

const amenityNames = [
  ...new Set((await loadFacilities('assets/facilities.json')).flatMap((f) => f.amenities)),
];
const facilities = generate(COUNT, amenityNames);
// Prepared once, like the index, so only per-request work is timed.
const names = facilities.map((f) => tokenize(f.name).join(' '));
const amenitySets = facilities.map((f) => new Set(f.amenities.map((a) => a.toLowerCase())));

globalThis.gc?.();
const memoryBefore = memoryInUse();
const buildStart = performance.now();
const index = new FacilityIndex(facilities);
const buildMs = performance.now() - buildStart;
globalThis.gc?.();
const indexMb = (memoryInUse() - memoryBefore) / 1024 / 1024;

console.log(`Facilities: ${COUNT.toLocaleString()} · Node ${process.version}`);
console.log(`Index build: ${buildMs.toFixed(0)} ms · Index memory: ${indexMb.toFixed(1)} MB\n`);
console.log(
  '| Query type | Index p50 | Index p95 | Index p99 | Index max | Full scan p50 | Full scan p95 |',
);
console.log('|---|---|---|---|---|---|---|');
for (const [label, partial] of Object.entries(QUERIES)) {
  const queries = partial.map((params) => ({ ...params, limit: 20, offset: 0 }));
  const indexed = time((params) => index.search(params), queries);
  const scanned = time((params) => fullScan(names, amenitySets, params), queries);
  console.log(
    `| ${label} | ${ms(percentile(indexed, 50))} | ${ms(percentile(indexed, 95))} | ${ms(percentile(indexed, 99))} | ${ms(indexed[indexed.length - 1])} | ${ms(percentile(scanned, 50))} | ${ms(percentile(scanned, 95))} |`,
  );
}
