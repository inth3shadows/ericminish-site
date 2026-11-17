#!/usr/bin/env python3
"""Check every page's markup: tags balance, and the nav is the same everywhere.

Every page repeats the header and nav inline, so a nav change is an edit to
every file; this catches the one that was missed. aria-current and whitespace
are ignored. Exit 1 on any finding.

  python3 tools/check-pages.py [--root DIR]
"""
import argparse, collections, pathlib, re, sys
from html.parser import HTMLParser

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
        "polygon", "polyline", "line", "rect", "circle", "path", "stop", "use", "ellipse"}


class Balance(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack, self.errors = [], []

    def handle_starttag(self, tag, attrs):
        if tag not in VOID:
            self.stack.append((tag, self.getpos()[0]))

    def handle_startendtag(self, tag, attrs):
        pass  # <rect/> and the like open and close in one tag

    def handle_endtag(self, tag):
        if self.stack and self.stack[-1][0] == tag:
            self.stack.pop()
        else:
            self.errors.append(f"line {self.getpos()[0]}: </{tag}> does not close "
                               f"{'<%s> from line %d' % self.stack[-1] if self.stack else 'anything'}")


def nav(html):
    m = re.search(r"<nav\b.*?</nav>", html, re.S)
    return re.sub(r"\s+", " ", re.sub(r'\s*aria-current="page"', "", m.group(0))).strip() if m else None


def check(root):
    findings, navs = [], collections.defaultdict(list)
    pages = sorted(p for p in root.rglob("*.html")
                   if not any(part.startswith(".") for part in p.relative_to(root).parts))
    for p in pages:
        rel, html = p.relative_to(root), p.read_text(encoding="utf-8")
        b = Balance()
        b.feed(html)
        findings += [f"{rel}: {e}" for e in b.errors]
        findings += [f"{rel}: <{t}> from line {n} is never closed" for t, n in b.stack]
        navs[nav(html)].append(str(rel))
    if len(navs) > 1:
        common = max(navs, key=lambda k: len(navs[k]))
        for k, files in navs.items():
            if k != common:
                findings += [f"{f}: nav differs from the {len(navs[common])} other pages"
                             + ("" if k else " (no <nav>)") for f in files]
    return len(pages), findings


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=pathlib.Path(__file__).resolve().parent.parent, type=pathlib.Path)
    n, findings = check(ap.parse_args(argv).root)
    print("\n".join(findings + [f"pages: {n} checked, {len(findings)} finding(s)"]))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
