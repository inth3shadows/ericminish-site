# Defect attribution instructions

The packet is one review task. It lists the task's planted defects (`planted`, ids P1, P2, ...: deliberate
mutations whose effect a test suite verified), the clusters that two independent judges both judged REAL with
each judge's evidence (`real_items`), and every distinct claim the reviewers made in this task that the judges
examined (`claims`), at any location.

The repository is a two-commit git repo: branch `main` is the base, branch `pr` (checked out) is the change.

Step 1. List the distinct defects. A defect is one faulty behaviour with one cause.
- Every planted defect is a defect; keep its id (P1, ...). If a real item is a consequence of a planted defect
  (fixing the plant fixes it), list that item under the plant instead of as a separate defect.
- For each other real item, read both judges' evidence. If both describe the same defect, it is one defect. If
  they describe different defects, list each and set `"both_judges": false` on any defect only one judge's
  evidence supports. If two items describe the same defect (the same faulty code doing the same wrong thing),
  list it once with both item ids. Give these ids D1, D2, ...
- For every defect set `"pre_existing"`: true if the faulty behaviour also exists on `main` (the change did not
  introduce or expose it), false otherwise. Planted defects are false.
- Do not add defects that no judge accepted and that are not planted.

Step 2. Map every claim. For each claim id, give the list of defect ids it identifies: the same faulty behaviour
from the same cause, even if worded differently, less completely, or described at a caller. A claim that
describes two defects lists both. A claim that identifies none of them, only names a location, or describes a
cause the judges rejected gets an empty list.

You may read and run the code to decide. Do not read anything outside the repository, and do not use the network.

Write one JSON object to the output path you were given:
`{"defects": [{"id": "P1", "items": ["G274"], "both_judges": true, "pre_existing": false, "description": "..."},
              {"id": "D1", "items": ["G105"], "both_judges": true, "pre_existing": true, "description": "..."}],
  "claims": {"G104:c1": ["D1"], "G104:c2": [], "G274:c2": ["P1"]}}`
Every claim id in the packet must appear in `claims`.

Your final message should be one line: the output path, defects listed (planted, other, single-judge), claims
mapped to at least one defect, to two or more, and to none.
