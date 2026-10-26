import jwt from 'jsonwebtoken';

export interface TokenClaims {
  sub: string;
  role: string;
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

export const TOKEN_TTL_SECONDS = 8 * 60 * 60;

export function signToken(claims: TokenClaims): string {
  return jwt.sign(claims, secret(), { expiresIn: TOKEN_TTL_SECONDS });
}

export function verifyToken(token: string): TokenClaims & { exp: number } {
  return jwt.verify(token, secret()) as TokenClaims & { exp: number };
}
