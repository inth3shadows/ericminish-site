---
name: dual-fast
description: Use whenever the user asks for a code review — "code review", "review this", "review the diff/PR/branch". Runs the /code-review skill and a briefed code-reviewer subagent at the same time, then a verifier that merges and checks every finding. Reports a Confirmed list and an Unconfirmed list.
---

# Dual review, parallel and verified

Two independent reviewers, run at the same time, then one verifier. Neither reviewer alone finds
everything; the verifier removes what is not a real defect without deleting it.

**Do not read the diff yourself.** The reviewers and the verifier read it. You may run only
`git diff --stat <base>...<head>` and read the PR description or README for the rules the code must obey.

## 1. Launch both reviewers in ONE message, agent first

- `Agent(subagent_type="code-reviewer", run_in_background=true, ...)`, briefed as in step 2.
- `Skill(skill="code-review", args="high <base>...<head>")` second, e.g. `args="high main...pr"`: the level dual-review
  passes. The skill blocks until it finishes; the agent is already running.

## 2. The agent's brief

- How to get the diff: the exact command.
- The rules the code must obey, from the PR description and docs.
- Verify by running code; give a concrete failing input and the wrong output for every finding.
- Try to break things; do not review style.
- Report every defect with a concrete failure scenario. Do not drop one because you are unsure:
  a verifier checks every finding after you.

## 3. Verify

When the skill has finished and the agent has returned, launch `Agent(subagent_type="review-verifier")`
with: the diff command, the rules from step 2, and both reviewers' findings copied verbatim (each
reviewer's list as it gave it).

## 4. Report

Your final message is the verifier's report (its Confirmed and Unconfirmed lists and the JSON block after them), unchanged.
