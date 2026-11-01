#!/usr/bin/env python3
"""Check the visible copy of every page against the site's plain-language rule.

Flags intensifiers and filler, "X, not Y" reversals, "rather than" openers,
self-praise phrases, and blocks with more than two em dashes. Text inside
<pre>, <code>, <svg>, <script> and <style> is ignored, as is <head>.

Usage:
  python tools/lint-copy.py           list findings, exit 1 if there are any
  python tools/lint-copy.py --warn    list findings, always exit 0
  python tools/lint-copy.py FILE ...  check only these files
"""
import pathlib, re, sys
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent.parent
RULES = [
    (r"\b(honest|honestly|quietly|genuinely|truly|actually)\b", "intensifier"),
    (r"\breal(ly)?\b(?!-time| (estate|world|users?|data|payloads?|API|bug-fix|model)\b)", "'real' as emphasis"),
    (r"\b(the whole point|what this demonstrates|it turns out|at its core|fundamentally|in short)\b", "filler phrase"),
    (r"\b(delve|leverage[sd]?|seamless(ly)?|robust|cutting-edge|game-?changer)\b", "stock AI word"),
    (r"\w, not (a |an |the )?\w+[.,;]", "'X, not Y' reversal"),
    (r"(^|[.!?]\s+)Rather than\b", "'Rather than' opener"),
    (r"\bIt(?:'s| is) not \w+[^.]*\. It(?:'s| is)\b", "'It's not X. It's Y.'"),
]
BLOCKS = {"p", "li", "h1", "h2", "h3", "td", "figcaption", "summary", "blockquote", "dd", "dt"}
SKIP = {"pre", "code", "svg", "script", "style", "head"}


class Copy(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip, self.buf, self.blocks, self.line = 0, [], [], 1

    def handle_starttag(self, tag, attrs):
        if tag in SKIP:
            self.skip += 1
        elif tag in BLOCKS:
            self.flush()
            self.line = self.getpos()[0]

    def handle_endtag(self, tag):
        if tag in SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag in BLOCKS:
            self.flush()

    def handle_data(self, data):
        if not self.skip:
            self.buf.append(data)

    def flush(self):
        text = " ".join("".join(self.buf).split())
        if text:
            self.blocks.append((self.line, text))
        self.buf = []


def lint(path):
    p = Copy(); p.feed(path.read_text()); p.flush()
    found = []
    for line, text in p.blocks:
        for pattern, why in RULES:
            for m in re.finditer(pattern, text, flags=re.I if "Rather" not in pattern and "It" not in pattern else 0):
                found.append((line, why, text[max(0, m.start() - 30):m.end() + 30]))
        if text.count("—") > 2:  # one aside in a pair of dashes is fine; more is a chain
            found.append((line, f"{text.count('—')} em dashes in one block", text[:70]))
    return found


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    files = [pathlib.Path(a) for a in args] or sorted(f for f in ROOT.rglob("*.html") if ".git" not in f.parts)
    total = 0
    for f in files:
        for line, why, snippet in lint(f):
            total += 1
            name = f.relative_to(ROOT) if f.is_relative_to(ROOT) else f
            print(f"{name}:{line}: {why}: …{snippet}…")
    print(f"lint-copy: {total} finding(s) in {len(files)} file(s)")
    sys.exit(0 if total == 0 or "--warn" in sys.argv else 1)


if __name__ == "__main__":
    main()
