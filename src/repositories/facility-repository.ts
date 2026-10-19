import type { Facility, FacilitySearch, FacilitySearchResult } from '../domain/facility.js';
import { FacilityIndex } from '../search/facility-index.js';

/**
 * Where routes get facility data from. Routes depend only on this interface, so a
 * database-backed implementation can replace the in-memory one without touching them.
 * Methods are async for the same reason, even though the in-memory version is synchronous.
 */
export interface FacilityRepository {
  search(params: FacilitySearch): Promise<FacilitySearchResult>;
  findById(id: string): Promise<Facility | undefined>;
  count(): Promise<number>;
}

export class InMemoryFacilityRepository implements FacilityRepository {
  private readonly index: FacilityIndex;

  constructor(facilities: readonly Facility[]) {
    this.index = new FacilityIndex(facilities);
  }

  search(params: FacilitySearch): Promise<FacilitySearchResult> {
    return Promise.resolve(this.index.search(params));
  }

  findById(id: string): Promise<Facility | undefined> {
    return Promise.resolve(this.index.findById(id));
  }

  count(): Promise<number> {
    return Promise.resolve(this.index.size);
  }
}
