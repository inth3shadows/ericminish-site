#!/usr/bin/env python3
"""Draft updates for stale Now-page cards and open them as ONE pull request. Never merges.

Run monthly by a systemd user timer (tools/systemd/). For each card that
tools/gen-now.py --check flags as old or busy, it:

  1. gathers sources: my pull requests merged into the card's repos since the
     card's data-as-of date (title and the start of the body), and the
     "Status" section of each owned repo's README;
  2. asks a model for a replacement "recent changes" paragraph that may use
     only those sources, with every sentence citing the sources it rests on;
  3. checks the draft without trusting the model: every sentence cites real
     sources, every number in it appears in a cited source (or is the date of
     a cited merge), it fits the length and copy rules, it carries nothing
     that looks like a host, address or credential, and a second model call
     confirms each sentence follows from its sources;
  4. writes the drafts that pass into a fresh worktree from origin/main, sets
     each card's data-as-of to today, and opens one pull request listing old
     text, new text and the sources of every sentence. Cards whose draft
     failed keep their text and are listed in the PR as needing a hand edit.

The site repo is public, so the PR body names a private repo's pull requests
by number only, never by title.

Needs `gh` (logged in as the profile owner) and the `claude` CLI.
Usage: python tools/draft-now.py [--dry-run] [--cards a,b] [--as-of YYYY-MM-DD] [--today YYYY-MM-DD]
  --dry-run  print the drafts and checks; no worktree, commit or PR
  --cards    draft these cards even if they are not stale (for testing)
  --as-of    treat every card as written on this date (for testing)
"""
import base64, datetime as dt, html, importlib.util, json, pathlib, re, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("gen_now", ROOT / "tools" / "gen-now.py")
gen_now = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen_now)
USER, SITE_REPO = gen_now.USER, gen_now.SITE_REPO

MODEL = "claude-opus-5-5"
CLAUDE_ARGS = ["-p", "--model", MODEL, "--strict-mcp-config", "--setting-sources", "project", "--tools", "",
               "--no-session-persistence", "--output-format", "json"]
MAX_WORDS = 70
BODY_CHARS = 1200
DENY = [re.compile(p, re.I) for p in (
    r"\b\d{1,3}(\.\d{1,3}){3}\b",          # IPv4 address
    r"\b[a-z0-9-]+\.(lan|local|internal)\b",  # internal host names
    r"\b(password|passwd|api[_ ]?key|secret value|bearer)\b",
    r"\b[A-Za-z0-9+/=_-]{32,}\b",            # long opaque strings (keys, tokens, hashes)
    r"@[a-z0-9-]+\.",                       # email-like
)]
CARD_ARTICLE = re.compile(
    r'(<article class="timeline" data-card="(?P<key>[a-z0-9-]+)" data-as-of=")(?P<asof>\d{4}-\d{2}-\d{2})(">.*?</article>)', re.S)
CASE_LINK = re.compile(r'\s*<a href="/portfolio/[a-z0-9-]+/">Case study</a>\.$')
STYLE = """House style (hard rules): plain, ordinary language for a reader who is not a specialist; explain any jargon
in a few words; no intensifiers (truly, genuinely, actually, quietly, real as emphasis); no "X, not Y" reversals; no
sentence opening with "Rather than"; no em dashes; no marketing words (leverage, robust, seamless, cutting-edge);
no self-praise. State a comparison with both numbers. Name dates as "28 October" or "Late October"."""


class DraftError(Exception):
    pass


def claude(prompt):
    r = subprocess.run(["claude", *CLAUDE_ARGS], input=prompt, capture_output=True, text=True, timeout=900, cwd="/tmp")
    if r.returncode != 0:
        raise DraftError(f"claude exited {r.returncode}: {r.stderr.strip()[:200]}")
    out = json.loads(r.stdout)["result"]
    m = re.search(r"\{.*\}", out, re.S)
    if not m:
        raise DraftError("model returned no JSON object")
    return json.loads(m.group(0))


class Sources:
    """The GitHub reads the drafter needs. Tests replace it."""

    def merged(self, repo, author, since):
        d = gen_now.gh("api", "-X", "GET", "search/issues", "-f",
                       f"q=repo:{repo} author:{author} is:pr is:merged merged:>={since}",
                       "-f", "sort=created", "-f", "order=desc", "-f", "per_page=40")
        return [{"repo": repo, "number": i["number"], "title": i["title"], "url": i["html_url"],
                 "merged": ((i.get("pull_request") or {}).get("merged_at") or i["closed_at"])[:10],
                 "body": (i.get("body") or "")[:BODY_CHARS]} for i in d["items"]]

    def readme_status(self, repo):
        try:
            d = gen_now.gh("api", f"repos/{repo}/readme")
        except gen_now.ApiError:
            return ""
        text = base64.b64decode(d["content"]).decode("utf-8", "replace")
        m = re.search(r"^#+\s*Status\s*$(.*?)(?=^#+\s|\Z)", text, re.M | re.S)
        return m.group(1).strip()[:1500] if m else ""

    def private(self, repo):
        return gen_now.GitHub().repo(repo)["private"] if repo.startswith(USER + "/") else False


def gather(key, as_of, src_api):
    items, private = [], {}
    for src in gen_now.CARDS[key]["sources"]:
        if not src.get("count", True):
            continue  # a fork that only dates the card (codegraph) adds no sources
        repo = src["repo"]
        private[repo] = src_api.private(repo)
        for pr in src_api.merged(repo, src.get("author", USER), as_of):
            items.append(("pr", pr))
        if repo.startswith(USER + "/"):
            status = src_api.readme_status(repo)
            if status:
                items.append(("status", {"repo": repo, "body": status}))
    sources = {}
    for n, (kind, it) in enumerate(items, 1):
        sid = f"S{n}"
        if kind == "pr":
            sources[sid] = {**it, "kind": "pr", "private": private[it["repo"]],
                            "text": f"Merged {it['merged']}. {it['title']}\n{it['body']}", "dates": {it["merged"]}}
        else:
            sources[sid] = {**it, "kind": "status", "private": private[it["repo"]], "text": it["body"], "dates": set()}
    return sources


def card_paragraphs(article):
    """(description paragraph, recent paragraph) inner HTML of a card, skipping the generated facts line."""
    ps = [p for p in re.findall(r"<p>(.*?)</p>", article, re.S)]
    if len(ps) < 2:
        raise DraftError("card has fewer than two hand-written paragraphs")
    return ps[-2], ps[-1]


def prompt_for(key, desc, recent, as_of, sources):
    listing = "\n\n".join(f"[{sid}] {'pull request merged ' + s['merged'] if s['kind'] == 'pr' else 'README Status section'}"
                          f" ({s['repo']})\n{s['text']}" for sid, s in sources.items())
    return f"""You update one card on a personal website's "Now" page. The card is about the project "{key}".

What the project is (keep; for context only):
{html.unescape(re.sub(r'<[^>]+>', '', desc))}

The card's current "recent changes" paragraph, written {as_of} (match its length and tone):
{html.unescape(re.sub(r'<[^>]+>', '', CASE_LINK.sub('', recent)))}

Write a replacement for that paragraph describing what changed since {as_of}, using ONLY the sources below. Pick the
one to three changes a hiring manager would care about most, start with a date phrase, and use no pull-request
numbers, branch names, file paths or names of other repositories. At most {MAX_WORDS} words, one to three sentences.
Every number you write must appear in a source you cite. If the sources do not support a useful update, return an
empty text.

{STYLE}

Sources:
{listing}

Return only JSON: {{"text": "<the paragraph>", "sentences": [{{"text": "<one sentence, exactly as in the paragraph>",
"sources": ["S1"]}}]}}"""


def numbers_ok(sentence, cited):
    pool = " ".join(s["text"] for s in cited).replace(",", "")
    dates = {d for s in cited for d in s["dates"]}
    allowed = {str(int(d[8:10])) for d in dates} | {d[:4] for d in dates}
    for n in re.findall(r"\d[\d,.]*\d|\d", sentence):
        bare = n.replace(",", "").rstrip(".")
        if bare not in allowed and not re.search(rf"(?<![\d.]){re.escape(bare)}(?![\d])", pool):
            return f"number {n} is not in its cited sources"
    return None


def validate(draft, sources):
    """Deterministic checks. Returns a list of problems; empty means the draft passes."""
    text = (draft.get("text") or "").strip()
    if not text:
        return ["the model found nothing worth an update"]
    problems = []
    if len(text.split()) > MAX_WORDS:
        problems.append(f"{len(text.split())} words, over {MAX_WORDS}")
    sentences = draft.get("sentences") or []
    if not sentences:
        problems.append("no sentences with sources")
    for s in sentences:
        st = s.get("text", "").strip()
        if st not in text:
            problems.append(f"sentence not in the paragraph: {st[:50]}")
        ids = s.get("sources") or []
        if not ids or any(i not in sources for i in ids):
            problems.append(f"sentence cites missing sources {ids}: {st[:50]}")
            continue
        bad = numbers_ok(st, [sources[i] for i in ids])
        if bad:
            problems.append(f"{bad}: {st[:50]}")
    covered = " ".join(s.get("text", "") for s in sentences)
    if len(re.sub(r"\W", "", covered)) < 0.9 * len(re.sub(r"\W", "", text)):
        problems.append("part of the paragraph has no cited sentence")
    for pat in DENY:
        if pat.search(text):
            problems.append(f"looks like a host, address or credential ({pat.pattern})")
    return problems


def judge(draft, sources):
    """Second model call: does each sentence follow from its cited sources? Returns a list of problems."""
    items = "\n\n".join(f"Sentence {n}: {s['text']}\nCited sources:\n" + "\n".join(
        f"[{i}] {sources[i]['text']}" for i in s["sources"]) for n, s in enumerate(draft["sentences"]))
    verdict = claude(f"""Check each sentence strictly against ONLY its cited sources. A sentence is supported when
every fact in it (what changed, numbers, dates, names) is stated in or directly follows from those sources. A date
phrase such as "28 October" or "Late October" is supported when a cited source's merge date falls on or in it.

{items}

Return only JSON: {{"verdicts": [{{"sentence": 0, "supported": true, "why": "<short reason>"}}]}}""")
    return [f"judge: sentence {v.get('sentence')} unsupported ({v.get('why', '')})"
            for v in verdict.get("verdicts", []) if not v.get("supported")]


def lint_findings(root):
    r = subprocess.run([sys.executable, "-I", str(root / "tools" / "lint-copy.py"), "--warn",
                        str(root / "status" / "index.html")], capture_output=True, text=True)
    m = re.search(r"(\d+) finding", r.stdout)
    return int(m.group(1)) if m else 0


def apply(page, key, new_text, today):
    """Replace a card's recent paragraph (keeping its Case study link) and set its data-as-of to today."""
    for m in CARD_ARTICLE.finditer(page):
        if m.group("key") != key:
            continue
        article = m.group(0)
        _, recent = card_paragraphs(article)
        link = CASE_LINK.search(recent)
        new_recent = html.escape(new_text, quote=False).replace("'", "&rsquo;") + (link.group(0) if link else "")
        new_article = article.replace(f"<p>{recent}</p>", f"<p>{new_recent}</p>", 1)
        new_article = new_article.replace(f'data-as-of="{m.group("asof")}"', f'data-as-of="{today}"', 1)
        return page.replace(article, new_article, 1)
    raise DraftError(f"no card {key}")


def source_line(sid, s):
    if s["kind"] == "status":
        return f"{sid}: README Status of {s['repo']}"
    if s["private"]:
        return f"{sid}: {s['repo']}#{s['number']} (private; title not shown), merged {s['merged']}"
    return f"{sid}: [{s['repo']}#{s['number']}]({s['url']}) {s['title']}, merged {s['merged']}"


def pr_body(results, today):
    out = [f"Monthly Now-page draft for {today}, written by `tools/draft-now.py`. Nothing here is merged automatically.",
           "", "Check each new paragraph against its sources, edit freely, then merge. The daily deploy publishes it."]
    for key, r in results.items():
        out += ["", f"### {key}"]
        if r["problems"]:
            out += ["**Needs a hand edit.** The draft failed its checks, so the card is unchanged:"]
            out += [f"- {p}" for p in r["problems"]]
            continue
        out += ["Old:", f"> {html.unescape(re.sub(r'<[^>]+>', '', r['old']))}", "", "New:", f"> {r['draft']['text']}", "",
                "Sources per sentence:"]
        for n, s in enumerate(r["draft"]["sentences"], 1):
            out.append(f"{n}. {s['text']}")
            out += [f"    - {source_line(i, r['sources'][i])}" for i in s["sources"]]
    return "\n".join(out)


def git(*args, cwd):
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        raise DraftError(f"git {' '.join(args[:2])}: {r.stderr.strip()[:200]}")
    return r.stdout


def main(argv):
    today = argv[argv.index("--today") + 1] if "--today" in argv else dt.date.today().isoformat()
    forced = argv[argv.index("--cards") + 1].split(",") if "--cards" in argv else []
    dry = "--dry-run" in argv
    page = (ROOT / "status" / "index.html").read_text()
    as_of = {m.group("key"): m.group("asof") for m in CARD_ARTICLE.finditer(page)}
    if "--as-of" in argv:  # testing: pretend every card was written on this date
        as_of = {k: argv[argv.index("--as-of") + 1] for k in as_of}
    try:
        warnings = gen_now.check(page, gen_now.GitHub(), today)
    except gen_now.ApiError as e:
        print(f"draft-now: skipped ({e})"); return 1
    stale = {w["card"] for w in warnings if w["kind"] in ("age", "activity") and w["card"]}
    targets = [k for k in gen_now.CARDS if gen_now.CARDS[k]["sources"] and (k in stale or k in forced)]
    dormant = [w["text"] for w in warnings if w["kind"] == "dormant"]
    if not targets:
        print(f"draft-now {today}: no card needs a draft"); return 0
    branch = f"now/draft-{today}"
    if not dry and gen_now.gh("api", "-X", "GET", f"repos/{SITE_REPO}/pulls", "-f", f"head={USER}:{branch}", "-f", "state=all"):
        print(f"draft-now: a pull request for {branch} already exists"); return 0
    src_api, results = Sources(), {}
    for key in targets:
        article = next(m.group(0) for m in CARD_ARTICLE.finditer(page) if m.group("key") == key)
        desc, recent = card_paragraphs(article)
        r = {"old": recent, "problems": [], "draft": None, "sources": {}}
        try:
            r["sources"] = gather(key, as_of[key], src_api)
            if not r["sources"]:
                raise DraftError("no merged pull requests or README status to draw on")
            r["draft"] = claude(prompt_for(key, desc, recent, as_of[key], r["sources"]))
            r["problems"] = validate(r["draft"], r["sources"]) or judge(r["draft"], r["sources"])
        except (DraftError, gen_now.ApiError, KeyError, ValueError, subprocess.TimeoutExpired) as e:
            r["problems"] = [str(e)]
        results[key] = r
        print(f"{key}: {'FAILED ' + '; '.join(r['problems']) if r['problems'] else 'ok: ' + r['draft']['text']}")
    passed = [k for k, r in results.items() if not r["problems"]]
    body = pr_body(results, today) + ("\n\n### Quiet cards\nConsider removing:\n" + "\n".join(f"- {d}" for d in dormant)
                                      if dormant else "")
    if dry:
        print("\n----- PR body -----\n" + body); return 0
    if not passed:
        print("draft-now: no draft passed its checks; nothing opened"); return 1
    wt = pathlib.Path(tempfile.mkdtemp(prefix="now-draft-"))
    git("fetch", "-q", "origin", cwd=ROOT)
    git("worktree", "add", "-q", "-b", branch, str(wt), "origin/main", cwd=ROOT)
    try:
        target = wt / "status" / "index.html"
        before = lint_findings(wt)
        text = target.read_text()
        for key in passed:
            text = apply(text, key, results[key]["draft"]["text"], today)
        target.write_text(text)
        after = lint_findings(wt)
        if after > before:
            raise DraftError(f"lint-copy findings rose from {before} to {after}; nothing pushed")
        git("add", "status/index.html", cwd=wt)
        git("commit", "-q", "-m", f"Now page: monthly draft for {', '.join(passed)} ({today})", cwd=wt)
        git("push", "-q", "-u", "origin", branch, cwd=wt)
        r = subprocess.run(["gh", "pr", "create", "-R", SITE_REPO, "--base", "main", "--head", branch, "--title",
                            f"Now page: monthly draft ({today})", "--body", body], capture_output=True, text=True)
        if r.returncode != 0:
            raise DraftError(f"gh pr create: {r.stderr.strip()[:200]}")
        print(f"draft-now: opened {r.stdout.strip()}")
    finally:
        subprocess.run(["git", "worktree", "remove", "--force", str(wt)], cwd=ROOT, capture_output=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
