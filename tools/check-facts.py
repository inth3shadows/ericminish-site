#!/usr/bin/env python3
"""Check that a figure repeated on several pages says the same thing everywhere.

Why: the codegraph case study moved from 111 to 131 issues filed, and the home
page, the portfolio index, the resume page and the resume PDF source all kept
saying 111. Each page is hand-written, so nothing tied the copies together.

tools/facts.json lists each repeated figure as {id, value, note, occurrences},
where an occurrence is a page and a regular expression with ONE capture group
around the number as written there (for example "Of ([\\d,]+) issues filed").
For every occurrence the pattern must match exactly once in the file, and the
captured number (commas and a trailing % dropped, number words such as "four"
read as digits) must equal the fact's value. A mismatch prints
`file: fact-id says X, facts.json says Y`; a pattern that matches nothing, or
more than once, is also a finding. Exit 1 on any finding.

Values are maintained by hand. This checks consistency between pages; it does
not know the true figure. When a figure changes, change facts.json and every
page it lists in the same commit. A figure that only looks alike on two pages
(a different quantity) does not belong here.

Usage: python3 tools/check-facts.py [--root DIR] [--list]
"""
import json, pathlib, re, sys

WORDS = {w: str(i) for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve".split())}


def normalize(text):
    """'2,568' -> '2568', '59%' -> '59', 'four' -> '4', '38.8' -> '38.8'."""
    t = text.strip().lower().replace(",", "").rstrip("%")
    return WORDS.get(t, t)


def check(facts, root):
    """Return a list of finding strings; empty means every occurrence agrees."""
    findings = []
    for fact in facts:
        want = normalize(str(fact["value"]))
        for occ in fact["occurrences"]:
            path = root / occ["file"]
            where = f"{occ['file']}: {fact['id']}"
            try:
                text = path.read_text()
            except OSError as e:
                findings.append(f"{where}: cannot read file ({e.strerror})")
                continue
            hits = re.findall(occ["pattern"], text)
            if len(hits) != 1:
                findings.append(f"{where}: pattern {occ['pattern']!r} matched {len(hits)} times, need exactly 1")
                continue
            got = normalize(hits[0] if isinstance(hits[0], str) else "?")
            if got != want:
                findings.append(f"{where} says {hits[0].strip()}, facts.json says {fact['value']}")
    return findings


def main(argv):
    here = pathlib.Path(__file__).resolve().parent
    root = pathlib.Path(argv[argv.index("--root") + 1]).resolve() if "--root" in argv else here.parent
    facts = json.loads((root / "tools" / "facts.json").read_text())
    if "--list" in argv:
        for f in facts:
            print(f"{f['id']} = {f['value']}  ({len(f['occurrences'])} places) {f.get('note', '')}")
        return 0
    findings = check(facts, root)
    for line in findings:
        print(line)
    print(f"facts: {len(facts)} checked, {len(findings)} finding(s)")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
