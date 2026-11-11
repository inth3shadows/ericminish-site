# Defect attribution instructions

The packet is one review task. Two independent judges have already examined every reviewer claim and agreed
that the `real_items` are real defects; for each item you get both judges' evidence. You also get every distinct
claim the reviewers made in this task, at any location, whether or not its item was judged real.

The repository is a two-commit git repo: branch `main` is the base, branch `pr` (checked out) is the change.

Step 1. List the distinct defects. A defect is one faulty behaviour with one cause. Read both judges' evidence for
each real item. If both judges describe the same defect, it is one defect. If they describe different defects at
the same item, list each separately and set `"both_judges": false` on any defect that only one judge's evidence
supports. If two items describe the same defect (the same faulty code doing the same wrong thing), list it once
with both item ids. Give each defect an id (D1, D2, ...), the item ids it comes from, and a one-sentence
description. Do not add defects that neither judge accepted.

Step 2. Map every claim. For each claim id, give the id of the defect it identifies (the same faulty behaviour
from the same cause, even if worded differently or less completely), or null if it identifies none of them. A
claim at one item may identify a defect listed under another item; map it there. A claim that only names a
location, or describes a cause the judges rejected, maps to null.

You may read and run the code to decide. Do not read anything outside the repository, and do not use the network.

Write one JSON object to the output path you were given:
`{"defects": [{"id": "D1", "items": ["G105"], "both_judges": true, "description": "..."}],
  "claims": {"G104:c1": "D1", "G104:c2": null}}`
Every claim id in the packet must appear in `claims`.

Your final message should be one line: the output path, defects listed (and how many single-judge), claims
mapped to a defect and to null.
