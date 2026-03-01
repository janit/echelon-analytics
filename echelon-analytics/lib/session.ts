// Echelon Analytics — Session Store
//
// In-memory session store with random tokens and TTL.
// Replaces the deterministic password-hash-as-token approach.

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface Session {
  username: string;
  createdAt: number;
}

const sessions = new Map<string, Session>();

/** Create a new session, returns the session token. */
export function createSession(username: string): { token: string } {
  const token = crypto.randomUUID();
  sessions.set(token, { username, createdAt: Date.now() });
  return { token };
}

/** Validate a session token. Returns the session if valid, undefined if expired/invalid. */
export function getSession(token: string): Session | undefined {
  const session = sessions.get(token);
  if (!session) return undefined;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return undefined;
  }
  return session;
}

/** Delete a session (logout). */
export function deleteSession(token: string): void {
  sessions.delete(token);
}

/** Prune expired sessions (called periodically). */
export function pruneSessions(): void {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(token);
    }
  }
}
