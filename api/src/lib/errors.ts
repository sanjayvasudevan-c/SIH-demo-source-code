export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Sign in to continue.') => new HttpError(401, msg);
export const forbidden = (msg: string) => new HttpError(403, msg);
export const notFound = (msg = "You don't have access to this page.") => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);
