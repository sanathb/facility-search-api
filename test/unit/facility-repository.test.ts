import { describe, expect, it } from 'vitest';
import { InMemoryFacilityRepository } from '../../src/repositories/facility-repository.js';
import { facility } from '../helpers.js';

describe('InMemoryFacilityRepository', () => {
  const repository = new InMemoryFacilityRepository([
    facility('f1', 'City Fitness Central', ['Pool']),
    facility('f2', 'Harbour Gym'),
  ]);

  it('searches through the index', async () => {
    await expect(repository.search({ q: 'harb', limit: 20, offset: 0 })).resolves.toEqual({
      items: [{ id: 'f2', name: 'Harbour Gym', address: 'f2 Test St' }],
      total: 1,
    });
  });

  it('finds a facility by id', async () => {
    await expect(repository.findById('f1')).resolves.toMatchObject({ id: 'f1' });
    await expect(repository.findById('nope')).resolves.toBeUndefined();
  });

  it('counts the facilities', async () => {
    await expect(repository.count()).resolves.toBe(2);
  });
});
