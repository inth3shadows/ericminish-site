---
name: sp-inline
description: Use whenever the user asks for a code review — "code review", "review this", "review the diff/PR/branch". A single-agent review in two passes, deep and then terse, followed by an in-place verification pass that checks every finding. No subagents. Reports a Confirmed list and an Unconfirmed list.
---

# Inline review, verified

The same instructions as the paired review, done by you in one session with no subagents.

## 1. Get the change and the rules

Get the diff (`git diff <base>...<head>`) and the PR description. Note the rules the code must obey, from
the PR description and docs. The spec is a vision document: for behavior it is silent on, judge by what a
reasonable person using this software would expect.

## 2. Pass A: deep

Look for defects: code that runs but computes the wrong thing, missed edge cases, caller/callee assumption
mismatches, error paths, security-relevant slips. Not style. Try to break things. Before your findings,
list every behavior you considered and set aside, one line each, with the reason.

## 3. Pass B: a second, terse look

Re-read the diff hunk by hunk, looking for what pass A missed: each changed condition, each caller of a
changed function, each new error path. One line per finding: `path:line -- the defect. The failing input
-> the wrong output.`

Do not drop a finding in either pass because you are unsure: step 4 checks them all.

## 4. Verify every finding

Merge duplicates (same defect, same spot or same root cause). Then check each item against the code, by
running it where possible: write a small script in a temp dir (`mktemp -d`), never edit tracked files, and
run `git status` at the end. Give each one verdict:

- `CONFIRMED` (ran it), `BY_READING` (cannot be run here, but the code plainly does the wrong thing on a
  reachable path), or `UNPROVEN` (could not tell): these stay in the main list.
- `NOT_A_DEFECT` (true, but nothing goes wrong for a realistic input: a deliberate trade-off, an input no
  caller can produce, a test-only gap, duplication, a stale comment, style) or `REFUTED` (factually wrong):
  these move to Unconfirmed.

A rare but reachable wrong result is a defect. Your own reasoning from passes A and B is not evidence; the
code is.

## 5. Report

```
## Confirmed
- `path:line` -- the defect, the failing input and the wrong output (CONFIRMED | BY_READING | UNPROVEN)

## Unconfirmed
- `path:line` -- the claim, in a few words -- why not (NOT_A_DEFECT | REFUTED)
```

Most severe first in each list. If a list is empty, write `- none`.

```json
{"confirmed": [{"loc": "src/app.py:42", "claim": "the defect in one sentence: what goes wrong, for which input", "check": "CONFIRMED"}],
 "unconfirmed": [{"loc": "src/app.py:57", "claim": "the defect in one sentence: what goes wrong, for which input", "why_not": "why it is not a defect", "check": "NOT_A_DEFECT"}]}
```

End the report with this JSON block, after both lists, with exactly these keys whatever format
your passes used: one object per list item, in the same order, with an
empty list `[]` where a list is `- none`. `loc` is the item's `path:line`. `check` is the item's tag
(`CONFIRMED`, `BY_READING` or `UNPROVEN` for Confirmed; `NOT_A_DEFECT` or `REFUTED` for Unconfirmed). In
`claim`, state the defect itself in one sentence, the same way in both lists, as a reader who has not seen
your verdict needs it: never say whether or how it was checked, what you decided, or why. The reason
belongs only in `why_not`.
