#!/usr/bin/env python3
"""Check whether the Now page (status/index.html) has gone stale.

Each card on the page carries data-card="<key>" and data-as-of="YYYY-MM-DD".
CARDS below maps each key to the GitHub repositories whose activity the card
describes. The check warns when:

  age       a card's as-of date is older than its max age
  activity  a card's sources merged more pull requests since its as-of date
            than MAX_MERGED_SINCE (the titles are listed, so the edit is quick)
  dormant   a card's sources show no activity for DORMANT_DAYS (it is no
            longer "in progress")
  uncovered one of my repositories merged UNCOVERED_MIN pull requests in the
            last 30 days and has no card

It only reads. With --issue it also keeps ONE open issue on this repo titled
ISSUE_TITLE in step with the warnings: created when warnings appear, its body
replaced while they last, closed when they clear. This repo is public, so the
issue never names a private repository that has no card on the page and never
shows a private repository's pull-request titles, only counts.

Warn-only by default: any API failure prints "now-check: skipped" and exits 0,
so a GitHub outage never blocks a deploy. --strict exits 1 on warnings or
errors.

Needs `gh` authenticated as the profile owner.
With --write it instead fills each card's <!-- auto:start now-KEY --> block with generated facts:
the last change date, pull requests merged in the last 30 days, and (public repos only) a link to them.

Usage: python tools/gen-now.py --check [--issue] [--strict] [--root DIR] [--today YYYY-MM-DD]
       python tools/gen-now.py --write [--strict] [--root DIR] [--today YYYY-MM-DD]
"""
import datetime as dt, json, pathlib, re, subprocess, sys, time

USER = "inth3shadows"
SITE_REPO = f"{USER}/ericminish-site"
ISSUE_TITLE = "Now page needs an update"
MAX_AGE_DAYS = 45
MAX_MERGED_SINCE = 10
DORMANT_DAYS = 60
UNCOVERED_MIN = 8
# Active repositories that should never get a card (tooling, the site itself,
# and anything that would advertise what I am doing privately).
IGNORE_UNCOVERED = {f"{USER}/{r}" for r in (
    "ericminish-site", "job-scout", "tooling", "codegraph-qa", "comp-intel", "competitive-intel",
    "linkedin-writer", "shared-terminal", "litellm", "homelab-media-stack")}
CARDS = {
    "day-job": {"sources": [], "max_age_days": 90},
    "codegraph": {"sources": [{"repo": "colbymchenry/codegraph", "author": USER}, {"repo": f"{USER}/codegraph", "count": False}]},
    "terse": {"sources": [{"repo": f"{USER}/terse"}]},
    "runecho": {"sources": [{"repo": f"{USER}/runecho"}]},
    "modelbench": {"sources": [{"repo": f"{USER}/modelbench"}]},
    "flight-recorder": {"sources": [{"repo": f"{USER}/flight-recorder"}]},
    "testgraph": {"sources": [{"repo": f"{USER}/testgraph"}]},
    "secret-broker": {"sources": [{"repo": f"{USER}/secret-broker"}]},
    "harness": {"sources": [{"repo": f"{USER}/harness"}]},
    "knowledge-base": {"sources": [{"repo": f"{USER}/kb-mcp"}]},
    "soundings": {"sources": [{"repo": f"{USER}/soundings"}]},
}
CARD_RE = re.compile(r'<article class="timeline" data-card="([a-z0-9-]+)" data-as-of="(\d{4}-\d{2}-\d{2})">')


class ApiError(Exception):
    pass


def gh(*args, stdin=None):
    for attempt in (1, 2):
        r = subprocess.run(["gh", *args], input=stdin, capture_output=True, text=True, timeout=60)
        if r.returncode == 0:
            return json.loads(r.stdout) if r.stdout.strip() else None
        # Search allows 30 requests a minute; one run makes about 16. Wait out a busy minute once.
        if attempt == 1 and "rate limit" in r.stderr.lower():
            time.sleep(61)
            continue
        raise ApiError(f"gh {' '.join(args[:3])}: {r.stderr.strip()[:200]}")


class GitHub:
    """The few GitHub reads and writes the check needs. Tests replace it."""

    def merged_prs(self, query, pages=1):
        """Merged PRs for a search query: (total_count, [(merged_date, title), ...] newest first, raw items).

        One page is 100 results; search returns at most 10 pages (1,000 results)."""
        items, total = [], 0
        for page in range(1, pages + 1):
            d = gh("api", "-X", "GET", "search/issues", "-f", f"q={query} is:pr is:merged",
                   "-f", "sort=created", "-f", "order=desc", "-f", "per_page=100", "-f", f"page={page}")
            total = d["total_count"]
            items += d["items"]
            if len(d["items"]) < 100:
                break
        dates = [((i.get("pull_request") or {}).get("merged_at") or i["closed_at"])[:10] for i in items]
        return total, sorted(zip(dates, [i["title"] for i in items]), reverse=True), items

    def repo(self, full):
        d = gh("api", f"repos/{full}")
        return {"private": d["private"], "pushed": d["pushed_at"][:10]}

    def find_issue(self):
        d = gh("api", "-X", "GET", f"repos/{SITE_REPO}/issues", "-f", "state=open", "-f", f"creator={USER}",
               "-f", "per_page=100")
        hits = [i for i in d if i["title"] == ISSUE_TITLE and "pull_request" not in i]
        return hits[0]["number"] if hits else None

    def create_issue(self, body):
        gh("api", f"repos/{SITE_REPO}/issues", "--input", "-", stdin=json.dumps({"title": ISSUE_TITLE, "body": body}))

    def update_issue(self, number, body=None, close=False):
        patch = {"body": body} if body is not None else {}
        if close:
            patch["state"] = "closed"
        gh("api", "-X", "PATCH", f"repos/{SITE_REPO}/issues/{number}", "--input", "-", stdin=json.dumps(patch))


def days(a, b):
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days


def check(page_html, api, today):
    """Return (warnings, details). Each warning is a dict with the public and private text kept apart."""
    cards = dict(CARD_RE.findall(page_html))
    warnings = []
    for key in cards:
        if key not in CARDS:
            warnings.append({"card": key, "kind": "config", "text": f"card '{key}' is not in CARDS in tools/gen-now.py"})
    for key, cfg in CARDS.items():
        if key not in cards:
            warnings.append({"card": key, "kind": "config", "text": f"CARDS has '{key}' but the page has no such card"})
            continue
        as_of = cards[key]
        age = days(as_of, today)
        limit = cfg.get("max_age_days", MAX_AGE_DAYS)
        if age > limit:
            warnings.append({"card": key, "kind": "age", "text": f"{key}: written {as_of}, {age} days ago (limit {limit})"})
        newest, merged, titles, private = None, 0, [], False
        for src in cfg["sources"]:
            info = api.repo(src["repo"]) if src["repo"].startswith(USER + "/") else {"private": False, "pushed": None}
            private = private or info["private"]
            q = f"repo:{src['repo']} merged:>={as_of} author:{src.get('author', USER)}"
            n, prs, _ = api.merged_prs(q)
            merged += n if src.get("count", True) else 0
            titles += [(d, t, info["private"]) for d, t in prs]
            last = [info["pushed"]] if info["pushed"] else []
            if not last:
                _, recent, _ = api.merged_prs(f"repo:{src['repo']} author:{src.get('author', USER)}")
                last = [recent[0][0]] if recent else []
            newest = max([newest] + last if newest else last, default=None)
        if merged > MAX_MERGED_SINCE:
            titles.sort(reverse=True)
            warnings.append({"card": key, "kind": "activity", "private": private, "count": merged, "titles": titles[:15],
                             "text": f"{key}: {merged} pull requests merged since {as_of}"})
        if cfg["sources"] and newest and days(newest, today) > DORMANT_DAYS:
            warnings.append({"card": key, "kind": "dormant",
                             "text": f"{key}: no activity since {newest}, {days(newest, today)} days (limit {DORMANT_DAYS})"})
    covered = {s["repo"] for c in CARDS.values() for s in c["sources"]}
    since = (dt.date.fromisoformat(today) - dt.timedelta(days=30)).isoformat()
    _, _, items = api.merged_prs(f"user:{USER} author:{USER} merged:>={since}", pages=10)
    per_repo = {}
    for i in items:
        full = i["repository_url"].split("/repos/", 1)[1]
        per_repo[full] = per_repo.get(full, 0) + 1
    for full, n in sorted(per_repo.items(), key=lambda kv: -kv[1]):
        if n >= UNCOVERED_MIN and full not in covered and full not in IGNORE_UNCOVERED:
            private = api.repo(full)["private"]
            warnings.append({"card": None, "kind": "uncovered", "private": private, "repo": full, "count": n,
                             "text": f"{full}: {n} pull requests merged in the last 30 days, and no card"})
    return warnings


def render(warnings, today, public):
    """Plain text for the terminal (public=False) or the public issue body (public=True)."""
    if not warnings:
        return f"now-check {today}: the Now page is current."
    out = [f"now-check {today}: {len(warnings)} warning(s). The Now page is status/index.html; "
           "update a card's text and its data-as-of date."]
    hidden = 0
    for w in warnings:
        if public and w["kind"] == "uncovered" and w["private"]:
            hidden += 1
            continue
        out.append(f"- {w['text']}")
        if w["kind"] == "activity":
            shown = [(d, t) for d, t, priv in w["titles"] if not (public and priv)]
            out += [f"    {d}  {t}" for d, t in shown]
            if public and len(shown) < len(w["titles"]):
                out.append(f"    ({len(w['titles']) - len(shown)} private titles not shown)")
    if hidden:
        out.append(f"- {hidden} private repositor{'y' if hidden == 1 else 'ies'} with recent merges and no card "
                   "(names not shown; run tools/gen-now.py --check locally)")
    return "\n".join(out)


def sync_issue(api, warnings, today):
    number = api.find_issue()  # a failed lookup raises before anything is written
    body = render(warnings, today, public=True)
    if warnings and number is None:
        api.create_issue(body)
        return "created"
    if warnings:
        api.update_issue(number, body=body)
        return f"updated #{number}"
    if number is not None:
        api.update_issue(number, body=body, close=True)
        return f"closed #{number}"
    return "none"


MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December")


def long_date(iso):
    d = dt.date.fromisoformat(iso)
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


def facts(api, today):
    """Per card with sources: {"last": iso date, "merged30": int, "link": url or None}.

    The link points at the merged pull requests of the card's first public repository; a card whose
    sources are all private gets no link. Raises ApiError on any failure, before anything is written."""
    since = (dt.date.fromisoformat(today) - dt.timedelta(days=30)).isoformat()
    out = {}
    for key, cfg in CARDS.items():
        if not cfg["sources"]:
            continue
        last, merged, link = None, 0, None
        for src in cfg["sources"]:
            author = f" author:{src.get('author', USER)}"  # my own pull requests; bots such as Dependabot do not count
            n, prs, _ = api.merged_prs(f"repo:{src['repo']} merged:>={since}{author}")
            # A source with "count": False (my fork of codegraph) dates the card but adds no merges:
            # the codegraph card counts pull requests merged upstream, as its case study does.
            merged += n if src.get("count", True) else 0
            dates = [prs[0][0]] if prs else []
            if src["repo"].startswith(USER + "/"):
                info = api.repo(src["repo"])
                dates.append(info["pushed"])
                private = info["private"]
            else:
                private = False
            if not dates:
                _, recent, _ = api.merged_prs(f"repo:{src['repo']}{author}")
                dates = [recent[0][0]] if recent else []
            last = max([last] + dates if last else dates, default=None)
            if link is None and not private:
                q = f"is%3Apr+is%3Amerged+author%3A{src.get('author', USER)}"
                link = f"https://github.com/{src['repo']}/pulls?q={q}"
        out[key] = {"last": last, "merged30": merged, "link": link}
    return out


def fact_line(f):
    parts = []
    if f["last"]:
        parts.append(f"Last change {long_date(f['last'])}")
    n = f["merged30"]
    parts.append(f"{n} pull request{'' if n == 1 else 's'} merged in the last 30 days")
    line = " · ".join(parts)
    if f["link"]:
        line += f' · <a href="{f["link"]}">merged changes</a>'
    return f'<p class="fine">{line}</p>'


def write_facts(page_html, card_facts):
    """Rewrite each card's <!-- auto:start now-KEY --> block. Every card with sources must have one."""
    for key, f in card_facts.items():
        start, end = f"<!-- auto:start now-{key} -->", f"<!-- auto:end now-{key} -->"
        if page_html.count(start) != 1 or page_html.count(end) != 1:
            raise ValueError(f"status/index.html needs exactly one {start} ... {end} block")
        a = page_html.index(start) + len(start)
        b = page_html.index(end)
        page_html = page_html[:a] + fact_line(f) + page_html[b:]
    return page_html


def main(argv):
    root = pathlib.Path(__file__).resolve().parent.parent
    if "--root" in argv:
        root = pathlib.Path(argv[argv.index("--root") + 1]).resolve()
    today = argv[argv.index("--today") + 1] if "--today" in argv else dt.date.today().isoformat()
    strict = "--strict" in argv
    page = root / "status" / "index.html"
    if "--write" in argv:
        # Fail closed: any error leaves the page as committed (with its older facts) and does not block a deploy.
        try:
            new = write_facts(page.read_text(), facts(GitHub(), today))
        except (ApiError, KeyError, ValueError, subprocess.TimeoutExpired) as e:
            print(f"now-facts: not written ({e})")
            return 1 if strict else 0
        changed = new != page.read_text()
        page.write_text(new)
        print(f"now-facts {today}: {'updated' if changed else 'unchanged'}")
        return 0
    if "--check" not in argv:
        print(__doc__.strip().splitlines()[-1]); return 2
    api = GitHub()
    try:
        warnings = check(page.read_text(), api, today)
        print(render(warnings, today, public=False))
        if "--issue" in argv:
            print(f"now-check issue: {sync_issue(api, warnings, today)}")
    except (ApiError, KeyError, ValueError, subprocess.TimeoutExpired) as e:
        print(f"now-check: skipped ({e})")
        return 1 if strict else 0
    return 1 if (strict and warnings) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
