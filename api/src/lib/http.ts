import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { badRequest } from './errors.js';

/** Wrap an async handler so rejections reach the error middleware. */
export function h(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path.length ? `${first.path.join('.')}: ` : '';
    throw badRequest(`${where}${first?.message ?? 'Invalid request'}`, r.error.issues);
  }
  return r.data;
}
