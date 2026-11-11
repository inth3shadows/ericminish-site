---
name: dual-review
description: Use whenever the user asks for a code review — "code review", "review this", "review the diff/PR/branch", "look this over", or an explicit /code-review. Runs BOTH the /code-review skill AND a domain-briefed code-reviewer subagent in parallel, then merges and de-duplicates the findings. Measured: neither reviewer alone finds everything. Do NOT use for /security-review, /redteam, /audit, /logic, or /simplify — those are different lenses with their own skills.
---

> **Published copy, redacted.** This is the skill file the dual-review arms ran, with one passage about a
> private project replaced by a bracketed note. The file as run has SHA-256
> `1458a2e6127a7e9a5b0cac44ed7691594e2fd4193f834261f7ab4d4423178591` (see `../seeds/`); this copy does not.

# Dual Review

Two reviewers, run together, findings merged. This exists because on a real PR the union
was ~16 distinct defects and **neither reviewer alone found them all**.

## Why both (the evidence, so this isn't cargo cult)

[Redacted for publication: the name of a private project and pull request, and a description of the defects
each reviewer found only in it. One was a credential leak; the others were logic and dependency defects.]

Subagent findings were **deeper** — each carried a runnable reproduction. Skill findings were
**broader and shallower** (12 vs 8). Different instructions, different blind spots.

## Process

**0. Do not read the diff yourself.** Both reviewers read it; a third read by you is paid
for and finds nothing. Before launching you may run only `git diff --stat <base>...HEAD` (file
names and sizes) and read the README or docs for the rules the code must obey.

**1. Launch both, in parallel, in ONE message.**

- `Skill(skill="code-review", args="<level>")` — pass the level the user asked for; default
  `high` if unspecified. Preserve any `--comment` / `--fix` / PR-number argument verbatim.
- `Agent(subagent_type="code-reviewer", ...)` — briefed as below.

Do not wait for one before starting the other.

**2. Brief the subagent properly. This step is the whole ballgame.**

The measured quality gap was **mostly the prompt, not the model**. An unbriefed agent is not
better than the skill. Give it:

- **How to get the diff** — the exact command (`git diff <base>...HEAD`, a PR number, a path).
- **The domain/business rules the code must obey.** Not "review this fantasy football code"
  but the actual rules: what escalates, what is exempt, what the caps are. Most severe bugs
  are code that runs fine and computes the wrong thing, which is invisible without the rules.
- **An explicit instruction to verify by running code**, and to give a concrete failing input
  and the wrong output for every finding. Tell it which interpreter/test command to use.
- **Ask it to try to break things**, not to read for style. Say "report only defects you can
  demonstrate or that have a clear concrete failure scenario."

**3. Merge.** When both return, work only from what they wrote. Do not re-read the diff, do not
re-verify a finding, and do not rewrite one: copy each finding's location and claim as its
reviewer gave them.

- De-duplicate — the same defect will often appear at different severities. Take the **higher**
  severity and the **better reproduction**.
- Rank by severity, security first.
- **Attribute**: say which reviewer caught what. Disagreement is signal — if one clears a
  function the other flags, that is the thing to check by hand.
- Where both independently clear the same code, say so in one line.
- The report is the merged list and nothing else: no recap of the change, no summary of the
  reviewers' process.

**4. Then stop and let the user decide.** Do not start fixing unless asked. If they do ask,
treat the fix as its own review target — remediation commits are where new defects get born.

## Rounds: the ledger

A reviewer starts every round cold. Without a record of the round before, it re-raises what
was already ruled out, and the fix it is reviewing has nothing to say what must still work.
Measured over 15 days on two machines: about half of all later rounds were caused by the
previous fix, and a settled question was re-raised three rounds running on one PR.

After merging round 1, write the ledger to `.review/<branch>.md` in the repo under review
(untracked; do not commit it):

- **Findings** — id, severity, status, and the failing input or test for each.
- **Rulings** — what was judged not a bug, with the evidence. Not re-raised without new evidence.
- **Invariants** — behaviour that held before the fix and must still hold, including what no
  test covers and what only production data or another repo shows.
- **Fix map** — commit → the finding ids it claims to close.

Where a finding or invariant can be checked by a command, write the command next to it.
Run them all before the fix and after it: a check that flips from pass to fail is a
regression found without a reviewer, and a finding's check that still fails is not closed.

Before a fix starts, read the Invariants. Each finding gets a failing test first; the fix
turns it green. Changing an existing test to make it pass is a finding, not a fix.

**Round 2 is a verify round, not a second review.** Launch both reviewers as in step 1, but
the brief is the ledger plus the fix diff (`git diff <round-1 sha>..HEAD`), and it says:

- check each finding the fix claims to close, on every path and not only the one the new
  tests cover; report any still open;
- check each invariant still holds, by running code;
- do not re-raise a ruling unless you have evidence the ledger does not answer;
- report only defects in the fix and findings still open.

Update the ledger with what came back.

**When to stop.** Merge when the verify round finds nothing new that is high severity and
reachable on normal input; file the rest as issues. Run a third round only if the verify
round found something high severity *in the fix*. A second patch to the same block is the
signal to redesign it or split the PR, not to review again.

**The hook enforces this** (`review_round_gate.py`, PreToolUse). It counts `/code-review` and
`code-reviewer` launches (this skill itself is not one). Rounds are per repo and branch; per PR
(`.review/pr-<N>.md`) when the `/code-review` args are a PR number or URL, or the brief runs
`gh pr diff N`; per another repo when the args start with its path or the brief runs `git -C <repo>
diff`. A review from main/master that names no PR is not counted. One round is the skill and the
agent launched together (within 2 minutes); a second `/code-review` is a new round. From round 2 a
launch is denied until the ledger exists and has changed since the last round, and the
`code-reviewer` brief must name the ledger file. Round 3 is denied until the ledger gains a line
`round-3: <finding id, e.g. F4, and what the fix broke>`. Round 4 and later ask the user, and keep
asking on retries. Do not work around a denial; do what it says, or stop.

## Constraints

- **Never report a pending agent's results.** If one is still running, say so.
- **Preserve the user's level and flags.** `ultra` is billed and user-triggered; never
  substitute it, and never launch it yourself.
- Both reviewers are read-only. Neither edits, commits, or pushes.
- If the user explicitly wants only one ("just the skill", "only the agent"), honor that.
- Diff size is not a reason to skip either reviewer. Run both unless the user explicitly asks for one.
