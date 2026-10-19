import { Type } from 'typebox';

/** RFC 9457 Problem Details, the body of every error response. */
export const ProblemSchema = Type.Object(
  {
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer(),
    detail: Type.String(),
    requestId: Type.String(),
    errors: Type.Optional(
      Type.Array(
        Type.Object({
          in: Type.String({ description: 'querystring, params, body or headers' }),
          path: Type.String({ description: 'JSON Pointer to the invalid field' }),
          message: Type.String(),
        }),
      ),
    ),
  },
  { description: 'RFC 9457 Problem Details' },
);

/** An error response entry, documented with the media type the API really sends. */
export const ProblemResponse = {
  description: 'RFC 9457 Problem Details',
  content: { 'application/problem+json': { schema: ProblemSchema } },
};
