#!/usr/bin/env python3
"""Derive the stylesheet cache-bust from the stylesheet's own hash.

Run before every deploy. Nothing enforces the manual bump, and shipping a
stylesheet change behind an unchanged ?v= means returning visitors keep the
old CSS -- which has already happened once.
"""
import hashlib, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
css = root / "assets" / "site.css"
tag = hashlib.sha256(css.read_bytes()).hexdigest()[:8]

changed = 0
for page in root.rglob("*.html"):
    text = page.read_text()
    new = re.sub(r"site\.css\?v=[0-9a-z]+", f"site.css?v={tag}", text)
    if new != text:
        page.write_text(new)
        changed += 1

print(f"site.css -> v={tag} ({changed} page(s) updated)")
sys.exit(0)
