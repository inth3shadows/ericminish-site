# Severity grading instructions

You are grading how much each defect matters. Every item below was already judged a REAL defect by two
independent judges who reproduced it; do not re-decide whether it is real unless it is plainly false, and
then say so in `why` and still give your best level. You do not know who reported each item and must not
try to find out.

The repository is a two-commit git repo: branch `main` is the base, branch `pr` (checked out) is the change.
See the change with `git diff main...pr`. The earlier judges' failing input is given with each item.

Grade each item on this scale, judging the realistic consequence in this project as it is used:

- `S1` critical: data loss or corruption, a security hole, or wrong results reaching users or production on a normal path.
- `S2` major: wrong behaviour on a normal input or a common path, or a crash or hang a user would hit.
- `S3` minor: wrong behaviour only on an edge-case or rare input, or a degraded but recoverable result.
- `S4` trivial: real but negligible: a misleading message or docstring, a test-only issue, a cosmetic wrong output.

Also give each item ONE bug type, the one that best names what goes wrong:

- `logic`: wrong computation, condition, ordering or result.
- `error_handling`: a missing or wrong guard, an unhandled exception, a crash or a silent failure.
- `data_integrity`: data lost, corrupted, overwritten or left inconsistent.
- `concurrency`: a race, a lost update, an ordering problem between processes or threads.
- `security`: injection, secret exposure, unsafe input handling, a permission hole.
- `resource`: a leak, unbounded growth, a hang, or a performance cliff.
- `contract`: code and its documented, typed or caller-facing contract disagree (docstring, help text, API shape).
- `config`: build, deploy, packaging or configuration.
- `test`: a defect only in tests or test fixtures.

Rules:
1. Judge reachability from the code: how often would a real user or caller hit this? Cite `file:line`.
2. An item may hold several claim texts about the same spot. Grade the defect, not the wording.
3. You may run code to check reachability (write scripts in a temp dir, never commit, never edit tracked
   files; run `git status` at the end and restore anything you changed).
4. Do not read anything outside the repository directory you were given, and do not use the network.

Write your result as a JSON array to the output path you were given, one object per item:
`{"id": "G101", "severity": "S2", "bug_type": "logic", "reachable_by": "the input or path that triggers it", "why": "one sentence, with file:line"}`

Your final message should be one line: the output path and the count of each level.
