#!/usr/bin/env python3
"""Add <lastmod> to every sitemap entry: the date of the last commit that changed that page.

Run by tools/regen-deploy.sh on the exported tree, so the committed sitemap.xml
stays free of dates and `gen-writing.py --check` (which also runs in a shallow
CI checkout with no history) is unaffected. Pages whose generated blocks change
daily (home, Now) still carry their last committed edit, which is the content a
search engine cares about.

  python3 tools/gen-lastmod.py --root DIR --repo REPO --ref SHA
"""
import argparse, pathlib, re, subprocess, sys

LOC = re.compile(r"<url><loc>(https://www\.ericminish\.com(/[^<]*))</loc>(?:<lastmod>[^<]*</lastmod>)?</url>")


def page_file(path):
    """URL path -> repo-relative file: "/" -> index.html, "/a/b/" -> a/b/index.html."""
    return (path.strip("/") + "/index.html").lstrip("/")


def add_lastmod(xml, date_of):
    """date_of(relpath) -> "YYYY-MM-DD" or None. Entries with no date are left without one."""
    def sub(m):
        d = date_of(page_file(m.group(2)))
        return f"<url><loc>{m.group(1)}</loc>" + (f"<lastmod>{d}</lastmod>" if d else "") + "</url>"
    return LOC.sub(sub, xml)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", required=True, type=pathlib.Path)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--ref", required=True)
    a = ap.parse_args(argv)

    def date_of(rel):
        out = subprocess.run(["git", "-C", a.repo, "log", "-1", "--format=%cs", a.ref, "--", rel],
                             capture_output=True, text=True, check=True).stdout.strip()
        return out or None

    sm = a.root / "sitemap.xml"
    xml = add_lastmod(sm.read_text(), date_of)
    sm.write_text(xml)
    print(f"lastmod: {xml.count('<lastmod>')} of {xml.count('<loc>')} sitemap entries dated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
