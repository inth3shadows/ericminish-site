# Adjudication instructions

You are judging claims made by code reviewers about a pull request. You do not know who made each claim, and you must not try to find out. Judge each claim only against the code.

The repository is a two-commit git repo: branch `main` is the base, branch `pr` (checked out) is the change. See the change with `git diff main...pr`.

For every item in the packet, decide one verdict:

- `REAL_NEW` — a real defect that this PR introduces or makes reachable. The code runs and does the wrong thing for a concrete input.
- `REAL_OLD` — a real defect, but the faulty code is unchanged by this PR (it exists on `main` too).
- `NOT_DEFECT` — what the claim describes is roughly true, but it is not wrong behaviour: style, naming, a documented or deliberate tradeoff, a purely hypothetical input that cannot occur, or a cosmetic issue with no wrong result.
- `FALSE` — the claim is factually wrong about what the code does.
- `NOT_A_CLAIM` — the text does not assert a defect (for example it says something was checked and found fine, or was deliberately left out).
- `UNVERIFIABLE` — you could not establish it either way with the code available.

Rules:
1. Evidence over plausibility. Prose, comments and docstrings are not evidence. Cite the exact `file:line` of the code that decides it.
2. For `REAL_NEW` or `REAL_OLD` you must give a concrete failing input and the wrong output. Reproduce it by running code where you reasonably can (write a small script or test in a temp dir, never commit, never edit tracked files; run `git status` at the end and restore anything you changed). Say whether you reproduced it (`reproduced: true`) or reasoned it from the code (`reproduced: false`).
3. An item may hold several claim texts from different reviewers about the same spot. Give ONE verdict for the item: the verdict of the strongest correct claim among them.
4. Be strict in both directions. Do not promote a nitpick to a defect, and do not dismiss a real defect because it is small or rare.
5. Do not read anything outside the repository directory you were given, and do not use the network.

Write your result as a JSON array to the output path you were given, one object per item:
`{"id": "F012", "verdict": "REAL_NEW", "reproduced": true, "confidence": 0.9, "evidence": "file:line and one or two sentences", "failing_input": "…or null"}`

Your final message should be one line: the output path and the count of each verdict.
