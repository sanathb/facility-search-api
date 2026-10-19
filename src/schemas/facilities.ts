import { Type } from 'typebox';
import { FACILITY_ID_MAX_LENGTH, FACILITY_ID_PATTERN } from '../domain/facility.js';

export const MAX_AMENITY_FILTERS = 20;
export const DEFAULT_LIMIT = 20;

export const FacilitySummarySchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  address: Type.String(),
});

export const FacilitySchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  address: Type.String(),
  location: Type.Object({ latitude: Type.Number(), longitude: Type.Number() }),
  amenities: Type.Array(Type.String()),
});

export const SearchFacilitiesQuerySchema = Type.Object({
  q: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 100,
      description: 'Matches facilities whose name has a word starting with each typed word',
      examples: ['city fit'],
    }),
  ),
  amenities: Type.Optional(
    Type.String({
      maxLength: 1000,
      description: `Comma-separated amenity names (at most ${MAX_AMENITY_FILTERS}); results have all of them`,
      examples: ['Pool,Sauna'],
    }),
  ),
  // Optional so the OpenAPI document doesn't mark them required; validation fills in the defaults.
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: DEFAULT_LIMIT })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export const SearchFacilitiesResponseSchema = Type.Object({
  data: Type.Array(FacilitySummarySchema),
  page: Type.Object({
    limit: Type.Integer(),
    offset: Type.Integer(),
    total: Type.Integer({ description: 'Number of matches across all pages' }),
  }),
});

export const FacilityParamsSchema = Type.Object({
  id: Type.String({
    minLength: 1,
    maxLength: FACILITY_ID_MAX_LENGTH,
    pattern: FACILITY_ID_PATTERN,
  }),
});
