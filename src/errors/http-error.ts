/** An error that maps directly to an HTTP status and a message that is safe to show clients. */
export class HttpError extends Error {
  override name = 'HttpError';

  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
