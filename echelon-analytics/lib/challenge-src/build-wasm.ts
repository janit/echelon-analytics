#!/usr/bin/env -S deno run -A
// Echelon Analytics — WASM Challenge Builder (standalone test tool)
//
// Generates a challenge.wasm with random parameters and verifies it.
// Usage: deno run -A lib/challenge-src/build-wasm.ts

import { buildChallengeWasm, generateParams } from "../challenge-wasm.ts";

// Generate random seed
const seed = crypto.getRandomValues(new Uint8Array(64));
const params = generateParams(seed);

console.log("[build-wasm] Magic constants:");
for (let i = 0; i < 4; i++) {
  console.log(`  m${i} = 0x${params.magic[i].toString(16).padStart(16, "0")}`);
}
console.log(`[build-wasm] Rotations: [${params.rotations.join(", ")}]`);

const wasm = buildChallengeWasm(params);

if (!WebAssembly.validate(wasm)) {
  console.error("[build-wasm] FATAL: invalid WASM binary");
  Deno.exit(1);
}
console.log(`[build-wasm] WASM validated (${wasm.length} bytes)`);

const { instance } = await WebAssembly.instantiate(wasm);
const memory = instance.exports.memory as WebAssembly.Memory;
const solve = instance.exports.solve as (
  ptr: number,
  len: number,
  out: number,
) => void;

// Self-test
const testInput = new TextEncoder().encode("challenge:session:site");
const mem = new Uint8Array(memory.buffer);
mem.set(testInput, 0);
solve(0, testInput.length, 1024);
const hex1 = Array.from(mem.slice(1024, 1040))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

// Determinism check
mem.fill(0, 0, 2048);
mem.set(testInput, 0);
solve(0, testInput.length, 1024);
const hex2 = Array.from(mem.slice(1024, 1040))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

console.log(`[build-wasm] solve("challenge:session:site") = ${hex1}`);
if (hex1 !== hex2) {
  console.error("[build-wasm] FATAL: non-deterministic!");
  Deno.exit(1);
}
console.log("[build-wasm] Determinism OK");

// Write output
const outPath = new URL("../challenge.wasm", import.meta.url);
await Deno.writeFile(outPath, wasm);
console.log(`[build-wasm] Wrote ${wasm.length} bytes → ${outPath.pathname}`);
