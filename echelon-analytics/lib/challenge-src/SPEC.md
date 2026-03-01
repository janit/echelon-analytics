# Echelon Analytics — WASM Challenge Module Specification

## Overview

The challenge module is a WebAssembly binary that implements a deterministic
hash function. It's used for proof-of-work bot detection: the client computes a
token from a server-provided challenge, and the server verifies it using the
same WASM binary.

**Key design:** Each deployment generates its own random WASM blob every 6
hours. The algorithm structure is public (SipHash-inspired mixing), but the
magic constants and rotation amounts are randomized per-generation. This makes
cross-deployment bot toolkits impractical — a spammer targeting site A can't
reuse their bypass for site B.

## WASM Exports

| Export   | Type     | Signature                                                   |
| -------- | -------- | ----------------------------------------------------------- |
| `memory` | Memory   | min 1 page (64KB)                                           |
| `solve`  | Function | `(input_ptr: i32, input_len: i32, output_ptr: i32) -> void` |

## Input Format

UTF-8 bytes of `challenge + ":" + sid + ":" + siteId`

Where:

- `challenge` — 32 hex chars from `HMAC-SHA-256(minute_bucket, SECRET)`
- `sid` — session ID (UUID from `sessionStorage`)
- `siteId` — site identifier from `data-site` attribute

## Output

16 bytes written at `output_ptr`, hex-encoded by the client as the `tok`
parameter (32 hex chars).

## Requirements

- **Deterministic:** Same input must always produce the same output
- **Fast:** Must complete in <50ms on mobile devices
- **Memory safe:** Only read from `[input_ptr, input_ptr + input_len)` and write
  to `[output_ptr, output_ptr + 16)`

## Default Algorithm

The default implementation uses a SipHash-inspired construction:

1. Initialize 4 × 64-bit state words with random magic constants
2. Absorb input in 8-byte blocks:
   - XOR block into v3
   - 2 mixing rounds (add + rotl + xor across state words)
   - XOR block into v0
3. Handle remaining bytes with length folding
4. Finalize: v2 ^= 0xff, then 4 mixing rounds
5. Output: (v0 ^ v1) || (v2 ^ v3)

## Runtime Generation

The WASM binary is generated at runtime by `lib/challenge-wasm.ts`:

```ts
import { buildChallengeWasm, generateParams } from "./challenge-wasm.ts";

const seed = crypto.getRandomValues(new Uint8Array(64));
const params = generateParams(seed);
const wasmBytes = buildChallengeWasm(params);
```

Parameters randomized per generation:

- 4 magic constants (64-bit each, from seed bytes 0-31)
- 5 rotation amounts (7-53 range, from seed bytes 32-36)

## Rotation Schedule

- New WASM blob generated every 6 hours
- Previous blob kept for verification overlap
- Challenge string (HMAC of minute bucket) rotates every minute
- Verification window: `CHALLENGE_WINDOW_MINUTES` (default 120)
- Cache-Control on `/ea.js`: `max-age=300` (5 minutes)

## Client Flow

1. `/ea.js` response includes inline WASM blob (base64) + challenge string
2. Client instantiates WASM, computes
   `solve(challenge + ":" + sid + ":" + siteId)`
3. Result hex-encoded as `tok`, cached in `sessionStorage._etok`
4. Token sent with beacon (`&tok=...`) and events (`body.tok`)
5. On subsequent loads: reuse cached token if challenge matches (90%), recompute
   (10%)

## Server Verification

1. Extract `tok` from request
2. For each active WASM instance (current + previous):
   - For each minute bucket in the challenge window:
     - Recompute challenge = HMAC(bucket)
     - Compute expected = solve(challenge + ":" + sid + ":" + siteId)
     - If expected == tok → valid
3. Scoring: valid = +0, missing = +15, invalid = +25 (added to bot score)

## Standalone Build Tool

For testing: `deno run -A lib/challenge-src/build-wasm.ts`

Generates a `lib/challenge.wasm` with random parameters and runs self-tests.
