// ---------------------------------------------------------------------
// Constant-time string comparison.
//
// `passcode === ADMIN_PASSCODE` short-circuits on the first differing
// byte, which in principle leaks the length of the shared prefix to a
// client that can measure response time. The comparison here always walks
// the whole input, so the only thing it reveals is the passcode's length —
// unavoidable without hashing both sides to a fixed width, and not useful
// on its own.
//
// Hashing to a fixed width with `crypto.timingSafeEqual` is the textbook
// version of this. It is also one more runtime dependency: `node:crypto`
// only exists on the Workers target because the generated wrangler config
// sets `nodejs_compat`, and a comparison that silently degrades to `===`
// on a runtime without it is worse than no comparison at all. XOR over
// UTF-8 bytes behaves identically on every runtime this app runs on.
// ---------------------------------------------------------------------

const encoder = new TextEncoder();

/**
 * Compares two strings without early exit.
 *
 * Lengths are folded into the accumulator with `^` rather than compared
 * with `if`, so a length mismatch still walks the longer of the two.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    // `?? 0` keeps the loop running for the shorter string instead of
    // returning early on the first out-of-range index.
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
