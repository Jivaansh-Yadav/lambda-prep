// ---------------------------------------------------------------------
// Static guard for the user-supplied regex in advanced search.
//
// Regex mode runs the pattern against every filename in the catalogue
// (~7,700) on each keystroke, and again inside the highlight helper for
// every card that renders. A pattern like `(a+)+$` doesn't just run slowly
// — it hangs the main thread with no way to interrupt it, so the tab stops
// responding until the user gives up and reloads (GH issue #4).
//
// There is no way to preempt a running RegExp in JS, so the defence is
// static: refuse the shapes that cause catastrophic backtracking, cap the
// pattern length, and (in advanced-search.ts) stop the scan if the whole
// match loop overruns a small time budget.
//
// This is intentionally conservative about *shapes*, not exhaustive: it
// catches nested quantifiers, repeated alternation under a quantifier, and
// backreferences, which together are the realistic accidental cases (the
// query box is used by students, not attackers, but a pasted pattern with
// a stray `+` should not freeze the page either).
// ---------------------------------------------------------------------

/** Long enough for real queries, short enough to keep backtracking bounded. */
export const MAX_PATTERN_LENGTH = 200;

export type PatternSafety = { safe: true } | { safe: false; reason: string };

/** Unbounded quantifiers: `+`, `*`, or `{n,}`. */
const UNBOUNDED = '(?:[*+]|\\{\\d+,\\})';

/**
 * A group that contains an unbounded quantifier and is itself quantified:
 * `(a+)+`, `(\d*)*`, `(ab{2,})+`. Bounded inner quantifiers are fine, hence
 * requiring `+`/`*`/`{n,}` specifically.
 */
const NESTED_QUANTIFIER = new RegExp(`\\([^()]*${UNBOUNDED}[^()]*\\)(?:[*+]|\\{\\d+,\\})`);

/** Alternation under a quantifier: `(a|a)+`, `(x|xy)*`. */
const QUANTIFIED_ALTERNATION = new RegExp(`\\([^()]*\\|[^()]*\\)(?:[*+]|\\{\\d+,\\})`);

/** Backreferences make the match state unbounded: `(a)\1`. */
const BACKREFERENCE = /\\[1-9]/;

export function checkPatternSafety(pattern: string): PatternSafety {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return {
      safe: false,
      reason: `Pattern is ${pattern.length} characters — keep it under ${MAX_PATTERN_LENGTH}.`,
    };
  }

  // Backreferences must be checked on the raw pattern: the pre-pass below
  // would erase them along with every other escape.
  if (BACKREFERENCE.test(pattern)) {
    return { safe: false, reason: 'Backreferences (\\1) are not supported here.' };
  }

  // Cheap pre-pass: strip escaped characters so `\(` isn't read as a group.
  const stripped = pattern.replace(/\\[\s\S]/g, "_");

  if (NESTED_QUANTIFIER.test(stripped)) {
    return {
      safe: false,
      reason: 'Nested repetition like (a+)+ can hang the page. Simplify the pattern.',
    };
  }
  if (QUANTIFIED_ALTERNATION.test(stripped)) {
    return {
      safe: false,
      reason: 'A repeated alternation like (a|b)+ is risky here. Simplify the pattern.',
    };
  }
  return { safe: true };
}
