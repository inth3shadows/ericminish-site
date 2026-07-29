# Technical Reference: ericminish-site

## Architecture

A hand-written static site. There is no build step, no framework, no
JavaScript, and no dependencies — the files in this repo are byte-for-byte the
files that get served.

```
repo (git)
  └── rsync ──▶ LXC 901 on nuc2 (192.168.9.9)
                  └── Docker + Caddy ──▶ /opt/ericminish/site
                        └── Cloudflare ──▶ ericminish.com
```

Every page is a complete HTML document that repeats the same header, nav, and
footer markup inline. That duplication is deliberate: with fewer than a dozen
pages, a templating layer would cost more than it saves, and the tradeoff is
that a nav change is a find-and-replace across every file.

All styling lives in one stylesheet, `assets/site.css`, linked with a manual
cache-busting query string. Both typefaces are self-hosted from
`assets/fonts/` — there is no third-party request on page load. Pages carry the class vocabulary that stylesheet
defines (`shell`, `hero`, `section`, `panel`, `prose`, `project-card`,
`code-window`, `timeline`, `note`); adding a page means reusing those classes
rather than writing new CSS.

## File Descriptions

| Path | Purpose |
|---|---|
| `index.html` | Home. Positioning and a prose summary of current work. |
| `about/index.html` | Background and working style. |
| `portfolio/index.html` | Case-study links, live sites, and listed work. |
| `portfolio/terse/index.html` | Case study — lossless MCP compression proxy. |
| `portfolio/origin-sentinel/index.html` | Case study — origin-health detection and staged self-heal. |
| `portfolio/llm-gateway/index.html` | Case study — multi-provider model routing with budget tracking. |
| `homelab/index.html` | Node map and service inventory. |
| `status/index.html` | The "Now" page — current focus, dated. |
| `contact/index.html` | Email and outbound links. |
| `assets/site.css` | The entire stylesheet, including the two `@font-face` declarations. |
| `assets/fonts/newsreader.woff2` | Newsreader, variable. Used for prose — anything argued. |
| `assets/fonts/azeret-mono.woff2` | Azeret Mono, variable. Used for data and labels — anything measured. |
| `assets/mark.svg`, `assets/favicon.svg` | Brand mark and favicon. |

## API Integrations

None. The site makes no outbound requests at runtime and has no backend, no
forms, and no analytics. Contact happens through a `mailto:` link.

## Configuration

No environment variables and no config files. The two values that behave like
configuration are both inline in the HTML:

- **Stylesheet cache-bust** — the `?v=` query on the `assets/site.css` link,
  derived from the stylesheet's own hash. Run `python tools/bump-cachebust.py`
  after any CSS change and before deploying.
- **Contact address** — `hi@ericminish.com`, repeated in every page footer and
  closing line.

Typography follows one rule: **Newsreader argues, Azeret Mono measures**, and
the two are never mixed inside a sentence.

## Deployment

Per `README.md`:

1. Back up the current live tree inside LXC 901.
2. Rsync this repo's site contents into `/opt/ericminish/site`.
3. Verify inside the container at `http://127.0.0.1:8080`.
4. Verify publicly at `ericminish.com`.

Rollback is restoring the backup taken in step 1 — there is no build artifact
to revert, only files.

## Maintenance Commands

There is no test suite. The checks worth running before a deploy:

```bash
# tag balance across every page
python -c "$(cat <<'EOF'
from html.parser import HTMLParser
import glob
VOID={'meta','link','br','img','hr','input','polygon','polyline','line','rect','circle','path','source'}
class P(HTMLParser):
    def __init__(s): super().__init__(); s.st=[]; s.err=[]
    def handle_starttag(s,t,a):
        if t not in VOID: s.st.append(t)
    def handle_endtag(s,t):
        if s.st and s.st[-1]==t: s.st.pop()
        else: s.err.append(t)
for f in sorted(glob.glob('**/*.html',recursive=True)):
    p=P(); p.feed(open(f).read())
    print(f, "OK" if not (p.err or p.st) else "BAD")
EOF
)"

# internal links that resolve to nothing
grep -rhoE 'href="/[a-z-]*/?[a-z-]*/"' --include=*.html . | sort -u \
  | tr -d '"' | sed 's/href=//' \
  | while read u; do [ -f ".${u}index.html" ] || echo "MISSING $u"; done
```

## Known Limitations

- **The resume PDF is content-addressed.** `tools/make-resume-pdf.py` names it
  `eric-minish-resume-<hash>.pdf`, deletes the previous one, and rewrites the
  link. The visitor still saves it as `Eric-Minish-Resume.pdf` via the
  `download` attribute. Cloudflare served a stale copy once before this.
- **The cache-bust is derived, not typed.** `tools/bump-cachebust.py` hashes
  `assets/site.css` and rewrites the `?v=` query on every page. It must be run
  before a deploy — nothing runs it automatically, and shipping a stylesheet
  change behind a stale query served three rounds of CSS work to nobody.
- **Header, nav, and footer are duplicated in every file.** A nav change is a
  mechanical edit across all pages, and nothing enforces that they stay in
  sync.
- **Dated pages rot silently.** `homelab/` and `status/` both state a
  last-updated month in their own copy. Nothing checks whether that date is
  still honest — it went three months stale before anyone noticed.
- **The homelab node table is hand-maintained**, not live data. It says so on
  the page. Uptime Kuma holds the real state; nothing pipes it here yet.
- **The home page's commit strip is a hand-taken snapshot.** Regenerate it
  with `gh api graphql` and edit the bars when the capture date gets old.
- **No automated deploy.** Deployment is a manual rsync, so the live tree can
  drift from `main` with no signal.

## Related Documentation

- [README](README.md) — what this is and how it's structured
- [Usage Guide](USAGE.md) — updating and publishing the site

<!-- docvet:anchors
newsreader.woff2 -> assets/site.css
azeret-mono.woff2 -> assets/site.css
sha256 -> tools/bump-cachebust.py
hi@ericminish.com -> contact/index.html
uv tool install terse-mcp -> portfolio/terse/index.html
-->
