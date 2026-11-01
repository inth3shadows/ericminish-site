#!/usr/bin/env python3
"""Build the /writing/ index, the Atom feed and sitemap entries from the posts,
and check every internal link and #anchor on the site.

Each post is writing/<slug>/index.html. Its metadata comes from tags it already
has: og:title, meta description, article:published_time, article:modified_time.
Reading time is computed from the text of its <article> and written into the
post between <!-- auto:start readtime --> markers.

Usage:
  python tools/gen-writing.py          write the index, feed, sitemap and reading times
  python tools/gen-writing.py --check  change nothing; exit 1 if anything is stale
                                       or any internal link or anchor is broken
"""
import html, math, pathlib, re, sys
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = "https://www.ericminish.com"
WPM = 230


def meta(text, key):
    m = re.search(rf'<meta (?:name|property)="{re.escape(key)}" content="([^"]*)"', text)
    return html.unescape(m.group(1)) if m else None


class Text(HTMLParser):
    """Collects visible words inside <article>, skipping <pre>, <svg>, <details>."""
    SKIP = {"pre", "svg", "details", "script", "style"}

    def __init__(self):
        super().__init__()
        self.depth = self.skip = 0
        self.words = 0

    def handle_starttag(self, tag, attrs):
        if tag == "article":
            self.depth += 1
        elif self.depth and tag in self.SKIP:
            self.skip += 1

    def handle_endtag(self, tag):
        if tag == "article":
            self.depth -= 1
        elif self.depth and tag in self.SKIP:
            self.skip -= 1

    def handle_data(self, data):
        if self.depth and not self.skip:
            self.words += len(data.split())


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs, self.ids = [], set()

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get("id"):
            self.ids.add(a["id"])
        if tag == "a" and a.get("href"):
            self.hrefs.append(a["href"])


def posts():
    out = []
    for page in sorted(ROOT.glob("writing/*/index.html")):
        text = page.read_text()
        slug = page.parent.name
        p = {"slug": slug, "page": page, "text": text,
             "title": meta(text, "og:title"), "summary": meta(text, "description"),
             "published": meta(text, "article:published_time"),
             "modified": meta(text, "article:modified_time") or meta(text, "article:published_time"),
             "url": f"{SITE}/writing/{slug}/"}
        missing = [k for k in ("title", "summary", "published") if not p[k]]
        if missing:
            sys.exit(f"{page}: missing meta {missing}")
        t = Text(); t.feed(text)
        p["minutes"] = max(1, math.ceil(t.words / WPM))
        out.append(p)
    return sorted(out, key=lambda p: p["published"], reverse=True)


def replace_block(text, name, body, path):
    start, end = f"<!-- auto:start {name} -->", f"<!-- auto:end {name} -->"
    if text.count(start) != 1 or text.count(end) != 1:
        sys.exit(f"{path}: expected one {start} / {end} pair")
    return re.sub(re.escape(start) + r".*?" + re.escape(end), lambda _: f"{start}{body}{end}", text, flags=re.S)


def human(date):
    y, m, d = date[:10].split("-")
    months = "January February March April May June July August September October November December".split()
    return f"{int(d)} {months[int(m) - 1]} {y}"


def build(ps):
    """Return {path: new_text} for every generated file."""
    out = {}
    for p in ps:
        out[p["page"]] = replace_block(p["text"], "readtime", f'<span>{p["minutes"]} min read</span>', p["page"])

    items = "\n".join(
        f'        <li>\n          <p class="post-meta"><time datetime="{p["published"]}">{human(p["published"])}</time>'
        f'<span>{p["minutes"]} min read</span></p>\n'
        f'          <h2><a href="/writing/{p["slug"]}/">{html.escape(p["title"])}</a></h2>\n'
        f'          <p>{html.escape(p["summary"])}</p>\n        </li>' for p in ps)
    index = ROOT / "writing" / "index.html"
    out[index] = replace_block(index.read_text(), "posts", f"\n{items}\n        ", index)

    updated = max((p["modified"] for p in ps), default="2026-11-01")
    entries = "".join(
        f"""  <entry>
    <title>{html.escape(p["title"])}</title>
    <link href="{p["url"]}"/>
    <id>{p["url"]}</id>
    <published>{p["published"][:10]}T00:00:00Z</published>
    <updated>{p["modified"][:10]}T00:00:00Z</updated>
    <summary>{html.escape(p["summary"])}</summary>
  </entry>
""" for p in ps)
    out[ROOT / "writing" / "feed.xml"] = f"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Eric Minish — Writing</title>
  <link href="{SITE}/writing/feed.xml" rel="self"/>
  <link href="{SITE}/writing/"/>
  <id>{SITE}/writing/</id>
  <updated>{updated[:10]}T00:00:00Z</updated>
  <author><name>Eric Minish</name></author>
{entries}</feed>
"""

    sm_path = ROOT / "sitemap.xml"
    sm = sm_path.read_text()
    for url in [f"{SITE}/writing/"] + [p["url"] for p in ps]:
        if f"<loc>{url}</loc>" not in sm:
            sm = sm.replace("</urlset>", f"  <url><loc>{url}</loc></url>\n</urlset>")
    out[sm_path] = sm
    return out


def check_links():
    pages = {}
    for f in ROOT.rglob("*.html"):
        if ".git" in f.parts:
            continue
        lp = Links(); lp.feed(f.read_text())
        pages[f] = lp
    broken = []
    for f, lp in pages.items():
        for href in lp.hrefs:
            if href.startswith(("http:", "https:", "mailto:", "tel:")):
                continue
            path, _, frag = href.partition("#")
            path = path.split("?")[0]
            if not path:
                target = f
            elif path.startswith("/"):
                target = ROOT / path.lstrip("/")
            else:
                target = f.parent / path
            if target.is_dir() or path.endswith("/"):
                target = target / "index.html"
            if not target.exists():
                broken.append(f"{f.relative_to(ROOT)}: {href} (no such file)")
            elif frag and target.suffix == ".html":
                ids = pages.get(target.resolve()) or pages.get(target)
                if ids is None:
                    lp2 = Links(); lp2.feed(target.read_text()); ids = lp2
                if frag not in ids.ids:
                    broken.append(f"{f.relative_to(ROOT)}: {href} (no #{frag})")
    return broken


def main():
    check = "--check" in sys.argv
    ps = posts()
    stale = []
    for path, new in build(ps).items():
        old = path.read_text() if path.exists() else None
        if old != new:
            stale.append(str(path.relative_to(ROOT)))
            if not check:
                path.write_text(new)
    broken = check_links()
    for b in broken:
        print(f"broken link: {b}")
    if check:
        for s in stale:
            print(f"stale: {s} (run python tools/gen-writing.py)")
        print(f"writing: {len(ps)} post(s), {len(stale)} stale file(s), {len(broken)} broken link(s)")
        sys.exit(1 if stale or broken else 0)
    print(f"writing: {len(ps)} post(s); updated {stale or 'nothing'}; {len(broken)} broken link(s)")
    sys.exit(1 if broken else 0)


if __name__ == "__main__":
    main()
