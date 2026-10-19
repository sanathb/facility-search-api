import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DataLoadError, loadFacilities, parseFacilities } from '../../src/data/load-facilities.js';

const validRecord = {
  id: 'facility-001',
  name: 'City Fitness Central',
  address: '123 Market St, Sydney, NSW 2000',
  location: { latitude: -33.8703, longitude: 151.208 },
  facilities: ['Pool', 'Sauna'],
};

describe('loadFacilities', () => {
  it('loads the provided data file and renames facilities to amenities', async () => {
    const facilities = await loadFacilities('assets/facilities.json');
    expect(facilities).toHaveLength(100);
    expect(facilities[0]).toEqual({
      id: 'facility-001',
      name: 'City Fitness Central',
      address: '123 Market St, Sydney, NSW 2000',
      location: { latitude: -33.8703, longitude: 151.208 },
      amenities: ['Pool', 'Sauna', '24/7 Access', 'Yoga Classes'],
    });
  });

  it('fails when the file is missing', async () => {
    await expect(loadFacilities('does/not/exist.json')).rejects.toThrow(
      /Could not read facilities/,
    );
  });

  it('fails when the file is not valid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'facilities-'));
    try {
      const file = join(dir, 'broken.json');
      await writeFile(file, '[{ not json');
      await expect(loadFacilities(file)).rejects.toBeInstanceOf(DataLoadError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('parseFacilities', () => {
  it('rejects data that is not an array', () => {
    expect(() => parseFacilities({ facilities: [] })).toThrow(/must be a JSON array/);
  });

  it('names the index and field of an invalid record', () => {
    const invalid = {
      ...validRecord,
      id: 'facility-002',
      location: { latitude: 100, longitude: 0 },
    };
    expect(() => parseFacilities([validRecord, invalid])).toThrow(
      /index 1: \/location\/latitude must be <= 90/,
    );
  });

  it('rejects ids that could not be used in a URL', () => {
    expect(() => parseFacilities([{ ...validRecord, id: 'bad id' }])).toThrow(/index 0: \/id/);
  });

  it('rejects duplicate ids', () => {
    expect(() => parseFacilities([validRecord, validRecord])).toThrow(
      /Duplicate facility id "facility-001" at index 1/,
    );
  });
});
