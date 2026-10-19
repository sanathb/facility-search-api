import { readFile } from 'node:fs/promises';
import { Type } from 'typebox';
import { Compile } from 'typebox/compile';
import { FACILITY_ID_MAX_LENGTH, FACILITY_ID_PATTERN, type Facility } from '../domain/facility.js';

/** The record shape in assets/facilities.json. */
const RawFacilitySchema = Type.Object({
  // The same rule as the detail route, so every loaded facility can be fetched by id.
  id: Type.String({
    minLength: 1,
    maxLength: FACILITY_ID_MAX_LENGTH,
    pattern: FACILITY_ID_PATTERN,
  }),
  name: Type.String({ minLength: 1 }),
  address: Type.String({ minLength: 1 }),
  location: Type.Object({
    latitude: Type.Number({ minimum: -90, maximum: 90 }),
    longitude: Type.Number({ minimum: -180, maximum: 180 }),
  }),
  facilities: Type.Array(Type.String({ minLength: 1 })),
});

const rawFacility = Compile(RawFacilitySchema);

export class DataLoadError extends Error {
  override name = 'DataLoadError';
}

/** Reads and validates the facilities file. Throws DataLoadError rather than serve partial data. */
export async function loadFacilities(filePath: string): Promise<Facility[]> {
  let contents: unknown;
  try {
    contents = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new DataLoadError(`Could not read facilities from ${filePath}`, { cause: error });
  }
  return parseFacilities(contents);
}

/** Validates raw records and maps them to the domain shape (`facilities` becomes `amenities`). */
export function parseFacilities(contents: unknown): Facility[] {
  if (!Array.isArray(contents)) {
    throw new DataLoadError('Facilities data must be a JSON array');
  }
  const seenIds = new Set<string>();
  return contents.map((record: unknown, index) => {
    if (!rawFacility.Check(record)) {
      const [problem] = rawFacility.Errors(record);
      throw new DataLoadError(
        `Invalid facility at index ${index}: ${problem.instancePath || '/'} ${problem.message}`,
      );
    }
    if (seenIds.has(record.id)) {
      throw new DataLoadError(`Duplicate facility id "${record.id}" at index ${index}`);
    }
    seenIds.add(record.id);
    return {
      id: record.id,
      name: record.name,
      address: record.address,
      location: { latitude: record.location.latitude, longitude: record.location.longitude },
      amenities: [...record.facilities],
    };
  });
}
