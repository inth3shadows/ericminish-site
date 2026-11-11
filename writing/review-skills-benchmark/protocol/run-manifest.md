# Run manifest

All 546 scored reviews ran under the same harness, one fresh sandboxed Claude Code home per review.

## Launch settings (every review)

- Claude Code 2.1.318, run as `claude -p <prompt> --model opus` (Claude Opus 5.5) with
  `--output-format stream-json --verbose --no-session-persistence --permission-mode bypassPermissions
  --strict-mcp-config --disallowedTools WebSearch,WebFetch`. MCP servers were loaded only for the code-graph arm.
- No effort flag was passed, so the main agent ran at Claude Code's default effort. Subagents ran at whatever
  model and effort their own files pin (for example the code-reviewer agent: Sonnet 5.5, high).
- Per-review timeout 1500 s. No review was cut off: the longest took 1494 s, and four parallel-dual hybrid
  reviews took over 1200 s.
- Several reviews ran at once on one machine. The number running at once was set per batch and is not recorded
  per review; it was not varied by arm within a batch.
- API-key reviews in batch r2key2 also ran with `--max-budget-usd 2.50`; no other batch had a per-review limit.

## Treatment files

Every arm's files were frozen and hashed (SHA-256) before each batch. The manifests are in `seeds/`:
`round1-batches-c-d.json`, `round1-code-graph-rerun.json`, `round2.json` (every round-2 batch has this same
manifest) and `round2-hybrid-rep0.json`. Round-1 batches a and b predate the manifest. The dual-review and hybrid
files are published in `treatment/`. The public packs are identified only by these hashes; their upstream
revisions were not recorded.

## Round 1: rep 0 of the ten original arms (140 reviews, all on a subscription token)

| Batch | Reviews run | Used | Note |
|---|---|---|---|
| a | 40 | 36 | 4 code-graph reviews superseded (the code-graph tool rules named the wrong tools) |
| b | 30 | 27 | 3 code-graph reviews superseded, same reason |
| code-graph rerun | 7 | 7 | the 7 superseded reviews, rerun with corrected rules |
| c | 40 | 40 | |
| d | 30 | 30 | |

The superseded reviews were kept apart and are not scored.

## Round 2: reps 1 and 2 of all 13 arms, rep 0 of the three hybrids (406 reviews)

| Batch | Reviews used | Credential | Limits |
|---|---|---|---|
| r2 | 2 | API key | account spend limit (about $2), which stopped the batch; the rest ran in later batches |
| r2b0 | 45 | subscription | none |
| r2key | 180 | API key | run spend limit $85 |
| r2key2 | 25 | API key | run spend limit $13; per-review limit $2.50 |
| hybrid-r0 | 18 | subscription | none |
| oauth | 82 | subscription | none |
| oauth2 | 54 | subscription | none |

No review in any batch had an estimated cost above $1.63.

## Reruns and excluded attempts

Every review attempt that exited non-zero was rerun from a fresh checkout and fresh tool state, whatever it had
produced; only attempts that exited cleanly are scored. There were 180 such attempts in batch r2 (the account
spend limit; the longest ran 34 s, and together they cost an estimated $0.23) and 24 in batch hybrid-r0 (the subscription's 5-hour usage limit). Of the 24,
22 failed at start with no cost. Two were parallel-dual hybrid reviews that had started work before the limit
stopped them (4 s and $0.04; 82 s and $0.34, estimated). Their time and cost are not in the paper's per-review
figures. API-key reviews that a run spend limit would have exceeded were not started on the key and ran later on a
subscription token (`--key-only`, so no key spend was recorded for them). Which credential a review used was set
by the batch, not by the arm (paper, Table A1).

## Finding extraction and planted-defect matching

- A finding is a line of the review's final message containing `path.ext:line` (regular expression
  `` `?([\w./-]+\.[A-Za-z]{1,5}):(\d+) ``).
- The three hybrids end with a JSON block of Confirmed and Unconfirmed items. The block is used when it is the
  message's last fenced block, comes after the lists, parses, has both lists, and every item has a `path:line`
  location, a non-empty claim and, if given, a verdict tag that belongs to its list. Its items are then the
  findings, even where they differ from the lists displayed above it (in one retained pair-hybrid review the JSON
  has five Confirmed items and the displayed list four; all five were scored). It is rejected only if it fails those
  checks or is empty while the displayed lists are not. Otherwise the message is split at its Confirmed and
  Unconfirmed headings and each part is read line by line as above. Text in code fences is never a heading, and the
  JSON block is not part of either list.
- A finding hits a planted defect when it names the plant's file and a line within 3 lines of the planted change
  (the nearest plant if several are in range). One finding credits at most one plant. A finding within 3 lines of
  a dropped plant candidate is excluded: neither a hit nor adjudicated (26 findings).
