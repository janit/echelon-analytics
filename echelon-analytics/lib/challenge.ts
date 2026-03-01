// Echelon Analytics — Challenge Generation + Verification
//
// Runtime-generated WASM PoW challenges that rotate every 6 hours.
// Each deployment/rotation produces a unique WASM blob, making
// cross-deployment bot toolkits impractical.

import {
  CHALLENGE_WINDOW_MINUTES,
  constantTimeEquals,
  SECRET,
} from "./config.ts";
import { buildChallengeWasm, generateParams } from "./challenge-wasm.ts";

const ROTATION_MS = 6 * 60 * 60 * 1000; // 6 hours
const encoder = new TextEncoder();

// ── HMAC key (derived from SECRET, stable across restarts) ───────────────────

if (!SECRET) {
  console.warn(
    "[echelon] WARNING: ECHELON_SECRET not set. Challenge tokens will not survive restarts or work across workers. Set a secret for production use.",
  );
}

let hmacKey: CryptoKey | null = null;

async function getHmacKey(): Promise<CryptoKey> {
  if (hmacKey) return hmacKey;
  const keyMaterial = SECRET
    ? encoder.encode(SECRET)
    : crypto.getRandomValues(new Uint8Array(32));
  hmacKey = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hmacKey;
}

// ── Challenge generation (HMAC of minute bucket) ────────────────────────────

function minuteBucket(offsetMinutes = 0): string {
  const now = Math.floor(Date.now() / 60_000) + offsetMinutes;
  return String(now);
}

/** Generate a challenge string for the current minute bucket. */
export async function generateChallenge(): Promise<string> {
  const key = await getHmacKey();
  const data = encoder.encode(minuteBucket());
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return Array.from(new Uint8Array(sig).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── WASM instance management ────────────────────────────────────────────────

interface WasmSlot {
  wasm: Uint8Array;
  wasmB64: string;
  instance: WebAssembly.Instance;
  createdAt: number;
}

let currentSlot: WasmSlot | null = null;
let previousSlot: WasmSlot | null = null;
let rotationPromise: Promise<WasmSlot> | null = null;

async function createSlot(): Promise<WasmSlot> {
  const seed = crypto.getRandomValues(new Uint8Array(64));
  const params = generateParams(seed);
  const wasm = buildChallengeWasm(params);
  const module = await WebAssembly.compile(wasm.buffer as ArrayBuffer);
  const instance = await WebAssembly.instantiate(module);
  // Base64 encode the WASM for embedding in the tracker JS
  const wasmB64 = btoa(String.fromCharCode(...wasm));
  return { wasm, wasmB64, instance, createdAt: Date.now() };
}

function ensureCurrentSlot(): Promise<WasmSlot> {
  // Guard against concurrent rotation: if a rotation is in progress, await it
  if (rotationPromise) return rotationPromise;

  const now = Date.now();
  if (!currentSlot || now - currentSlot.createdAt >= ROTATION_MS) {
    rotationPromise = (async () => {
      if (currentSlot) previousSlot = currentSlot;
      currentSlot = await createSlot();
      rotationPromise = null;
      return currentSlot;
    })();
    return rotationPromise;
  }
  return Promise.resolve(currentSlot);
}

/** Get the current WASM blob as base64 (for embedding in tracker JS). */
export async function getWasmBase64(): Promise<string> {
  const slot = await ensureCurrentSlot();
  return slot.wasmB64;
}

/** Get the WASM generation ID (timestamp-based, for cache busting). */
export async function getWasmGeneration(): Promise<string> {
  const slot = await ensureCurrentSlot();
  return String(slot.createdAt);
}

// ── Solve using a WASM instance ─────────────────────────────────────────────

function solveWith(
  instance: WebAssembly.Instance,
  input: string,
): string {
  const memory = instance.exports.memory as WebAssembly.Memory;
  const solve = instance.exports.solve as (
    ptr: number,
    len: number,
    out: number,
  ) => void;
  const inputBytes = encoder.encode(input);
  const mem = new Uint8Array(memory.buffer);
  mem.set(inputBytes, 0);
  solve(0, inputBytes.length, 2048);
  return Array.from(mem.slice(2048, 2064))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Token verification ──────────────────────────────────────────────────────

/**
 * Verify a PoW token. Returns "valid", "missing", or "invalid".
 *
 * Tries the current + previous WASM instances against
 * the last CHALLENGE_WINDOW_MINUTES minute buckets.
 */
export async function verifyToken(
  tok: string | null,
  siteId: string,
  sid: string,
): Promise<"valid" | "missing" | "invalid"> {
  if (!tok) return "missing";
  if (!/^[0-9a-f]{32}$/.test(tok)) return "invalid";

  const slot = await ensureCurrentSlot();
  const key = await getHmacKey();

  // Collect active WASM slots
  const slots = [slot];
  if (previousSlot) slots.push(previousSlot);

  // Try each minute bucket within the challenge window
  for (let offset = 0; offset >= -CHALLENGE_WINDOW_MINUTES; offset--) {
    const bucket = minuteBucket(offset);
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(bucket));
    const challenge = Array.from(new Uint8Array(sig).slice(0, 16))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const input = challenge + ":" + sid + ":" + siteId;

    for (const s of slots) {
      const expected = solveWith(s.instance, input);
      if (constantTimeEquals(expected, tok)) return "valid";
    }
  }

  return "invalid";
}

/** Bot score penalty for token verification result. */
export function tokenPenalty(result: "valid" | "missing" | "invalid"): number {
  if (result === "valid") return 0;
  if (result === "missing") return 15;
  return 25; // invalid
}
