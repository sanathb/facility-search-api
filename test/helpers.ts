import type { Facility } from '../src/domain/facility.js';

export function facility(id: string, name: string, amenities: string[] = []): Facility {
  return {
    id,
    name,
    address: `${id} Test St`,
    location: { latitude: -33.87, longitude: 151.21 },
    amenities,
  };
}
