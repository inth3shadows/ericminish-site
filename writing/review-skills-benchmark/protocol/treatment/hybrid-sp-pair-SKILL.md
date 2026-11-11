---
name: sp-pair
description: Use whenever the user asks for a code review — "code review", "review this", "review the diff/PR/branch". Runs two independent reviewer subagents at the same time (a deep Opus reviewer and a terse Sonnet code-reviewer), then a verifier that merges and checks every finding. Reports a Confirmed list and an Unconfirmed list.
---

# Paired review, verified

Two independent reviewers with different instructions, run at the same time, then one verifier.

**Do not read the diff yourself.** The reviewers and the verifier read it. You may run only
`git diff --stat <base>...<head>` and read the PR description or README for the rules the code must obey.

## 1. Launch both reviewers in ONE message, both in the background

- `Agent(subagent_type="general-purpose", model="opus", run_in_background=true, prompt=...)`: fill the
  brief in [reviewer.md](reviewer.md) with the diff command, the PR description and the rules.
- `Agent(subagent_type="code-reviewer", run_in_background=true, prompt=...)`, briefed with:
  - the diff command, the PR description and the rules;
  - verify by running code; a concrete failing input and the wrong output for every finding;
  - try to break things; no style;
  - report every defect with a concrete failure scenario, and do not drop one because you are unsure:
    a verifier checks every finding after you;
  - output one line per finding: `path:line -- the defect. The failing input -> the wrong output.`
    No preamble, no hedging, no summary.

Wait for both to return. Never go on with one.

## 2. Verify

Launch `Agent(subagent_type="review-verifier")` with: the diff command, the rules, and both reviewers'
findings copied verbatim (each reviewer's list as it gave it).

## 3. Report

Your final message is the verifier's report (its Confirmed and Unconfirmed lists and the JSON block after them), unchanged.
