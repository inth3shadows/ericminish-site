# Reviewer prompt

Every review received this prompt, preceded by one line that names the arm's skill or subagent.

Skill arms: "Use the `<skill>` skill for this task: invoke it with the Skill tool before doing anything else."
Subagent arms (ECC): "Use the `<agent>` subagent for this task: launch it with the Agent tool before doing anything else, then report its findings."
Bare arms: no preamble.

---

Review the pull request in this repository: branch `pr` against `main`.
Get the change with `git diff main...pr`; the PR description is `git log -1 --format=%B pr`.

Look for defects -- code that runs but computes the wrong thing, missed edge cases,
caller/callee assumption mismatches, security-relevant slips. Do not review style.
For every finding give a concrete failing input and the wrong output.

Report only defects with a concrete failure scenario. List each as one line:
`path:line -- the defect and the failing input`, where line is in the `pr` version
of the file. If you find none, say so.

