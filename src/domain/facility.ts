/** Facility ids appear in URLs, so they are limited to URL-safe characters. */
export const FACILITY_ID_PATTERN = '^[A-Za-z0-9_-]+$';
export const FACILITY_ID_MAX_LENGTH = 64;

/** A fitness facility, as returned by the detail endpoint. */
export interface Facility {
  id: string;
  name: string;
  address: string;
  location: { latitude: number; longitude: number };
  amenities: string[];
}

/** The fields returned for each search result. */
export type FacilitySummary = Pick<Facility, 'id' | 'name' | 'address'>;

export interface FacilitySearch {
  /** Word-prefix query on the facility name. Omitted means "every facility". */
  q?: string;
  /** Amenity names a facility must all have (case-insensitive, whole-name match). */
  amenities?: string[];
  limit: number;
  offset: number;
}

export interface FacilitySearchResult {
  items: FacilitySummary[];
  /** Number of matches across all pages. */
  total: number;
}
