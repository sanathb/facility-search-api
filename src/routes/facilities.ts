import type { FastifyPluginCallbackTypebox } from '@fastify/type-provider-typebox';
import type { TokenVerifier } from '../auth/token-verifier.js';
import { HttpError } from '../errors/http-error.js';
import { createAuthenticate } from '../plugins/authenticate.js';
import type { FacilityRepository } from '../repositories/facility-repository.js';
import {
  DEFAULT_LIMIT,
  FacilityParamsSchema,
  FacilitySchema,
  MAX_AMENITY_FILTERS,
  SearchFacilitiesQuerySchema,
  SearchFacilitiesResponseSchema,
} from '../schemas/facilities.js';
import { ProblemResponse } from '../schemas/problem.js';

interface FacilityRoutesOptions {
  repository: FacilityRepository;
  tokenVerifier: TokenVerifier;
}

const protectedErrors = {
  400: ProblemResponse,
  401: ProblemResponse,
  429: ProblemResponse,
  500: ProblemResponse,
};

export const facilityRoutes: FastifyPluginCallbackTypebox<FacilityRoutesOptions> = (
  app,
  { repository, tokenVerifier },
  done,
) => {
  // Every route in this plugin requires a token. preValidation runs after the rate limiter
  // (onRequest) and before input validation, so a caller without a token learns nothing
  // about valid parameters and a flood of requests never reaches the slow verifier.
  app.decorateRequest('user', null);
  app.addHook('preValidation', createAuthenticate(tokenVerifier));

  app.get(
    '/facilities',
    {
      schema: {
        tags: ['facilities'],
        summary: 'Search facilities by name and amenities',
        security: [{ bearerAuth: [] }],
        querystring: SearchFacilitiesQuerySchema,
        response: { 200: SearchFacilitiesResponseSchema, ...protectedErrors },
      },
    },
    async (request) => {
      // Validation has already applied these defaults; repeating them satisfies the types.
      const { q, limit = DEFAULT_LIMIT, offset = 0 } = request.query;
      // Validation turns '1e400' into Infinity and skips minimum and maximum for it.
      if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(offset)) {
        throw new HttpError(400, 'limit and offset must be integers in range');
      }
      const amenities = parseAmenities(request.query.amenities);
      const { items, total } = await repository.search({ q, amenities, limit, offset });
      return { data: items, page: { limit, offset, total } };
    },
  );

  app.get(
    '/facilities/:id',
    {
      schema: {
        tags: ['facilities'],
        summary: 'Get one facility with all its details',
        security: [{ bearerAuth: [] }],
        params: FacilityParamsSchema,
        response: { 200: FacilitySchema, 404: ProblemResponse, ...protectedErrors },
      },
    },
    async (request) => {
      const facility = await repository.findById(request.params.id);
      if (!facility) {
        throw new HttpError(404, `Facility ${request.params.id} not found`);
      }
      return facility;
    },
  );
  done();
};

/** Splits the comma-separated amenities parameter, ignoring empty entries. */
function parseAmenities(raw: string | undefined): string[] {
  const amenities = (raw ?? '')
    .split(',')
    .map((amenity) => amenity.trim())
    .filter((amenity) => amenity.length > 0);
  if (amenities.length > MAX_AMENITY_FILTERS) {
    throw new HttpError(400, `amenities accepts at most ${MAX_AMENITY_FILTERS} entries`);
  }
  return amenities;
}
