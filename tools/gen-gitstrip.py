#!/usr/bin/env python3
"""Regenerate the home page's commit-history strip from the GitHub API.

The strip used to be pasted in by hand and went stale. This rewrites only the
text between <!-- auto:start gitstrip --> and <!-- auto:end gitstrip --> in
index.html. It fails closed: any API error, missing marker, or a private repo
name in the output exits non-zero and leaves the page untouched.

Bars count PUBLIC repositories only. Private work appears as one aggregate
number, never by repository name.

Needs `gh` authenticated as the profile owner.
Usage: python tools/gen-gitstrip.py [--root DIR]   (DIR defaults to this repo)
"""
import calendar, datetime as dt, json, pathlib, re, subprocess, sys

USER = "inth3shadows"
root = pathlib.Path(__file__).resolve().parent.parent
if "--root" in sys.argv:
    root = pathlib.Path(sys.argv[sys.argv.index("--root") + 1]).resolve()
page = root / "index.html"
START, END = "<!-- auto:start gitstrip -->", "<!-- auto:end gitstrip -->"

KINDS = ("commitContributionsByRepository", "issueContributionsByRepository",
         "pullRequestContributionsByRepository", "pullRequestReviewContributionsByRepository")
QUERY = """query($from: DateTime!, $to: DateTime!) { viewer { contributionsCollection(from: $from, to: $to) {
  totalCommitContributions contributionCalendar { totalContributions }
  %s } } }""" % " ".join(
    f"{k}(maxRepositories: 100) {{ repository {{ nameWithOwner isPrivate }} contributions {{ totalCount }} }}"
    for k in KINDS)


def fetch(start, end):
    out = subprocess.run(
        ["gh", "api", "graphql", "-f", f"query={QUERY}",
         "-f", f"from={start.isoformat()}T00:00:00Z", "-f", f"to={end.isoformat()}T23:59:59Z"],
        capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        sys.exit(f"gh api failed (exit {out.returncode}): {out.stderr.strip()[:200]}")
    return json.loads(out.stdout)["data"]["viewer"]["contributionsCollection"]


def summarise(cc):
    public, commits, repos, private_names = 0, 0, set(), set()
    for kind in KINDS:
        for row in cc[kind]:
            repo, n = row["repository"], row["contributions"]["totalCount"]
            if repo["isPrivate"]:
                private_names.add(repo["nameWithOwner"].split("/")[-1])
                continue
            public += n
            repos.add(repo["nameWithOwner"])
            if kind == KINDS[0]:
                commits += n
    return public, commits, repos, private_names


def months_back(today, n=12):
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        first = dt.date(y, m, 1)
        last = min(dt.date(y, m, calendar.monthrange(y, m)[1]), today)
        out.append((first, last))
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    return out[::-1]


def main():
    today = dt.date.today()
    months = months_back(today)
    per_month, all_repos, private_names, commits = [], set(), set(), 0
    for first, last in months:
        pub, c, repos, priv = summarise(fetch(first, last))
        per_month.append(pub)
        all_repos |= repos
        private_names |= priv
        commits += c
    year = fetch(months[0][0], today)
    total_all = year["contributionCalendar"]["totalContributions"]
    total_pub = sum(per_month)
    peak = max(per_month) or 1

    def fmt(n):
        return f"{n:,}"

    bars = []
    for i, ((first, last), n) in enumerate(zip(months, per_month)):
        now = i == len(months) - 1
        h = max(2, round(100 * n / peak))
        label = f"{first:%Y-%m} — {fmt(n)} contributions" + (f", to {last.day} {last:%B}" if now and last.day < calendar.monthrange(last.year, last.month)[1] else "")
        bars.append(f'          <div class="bar{" now" if now else ""}" title="{label}"><i style="height:{h}%"></i><span>{first:%b}</span></div>')

    block = "\n".join([
        START,
        '      <div class="gitstrip">',
        '        <div class="gitstrip-head">',
        "          <span>Public commit history</span>",
        f"          <span><b>{fmt(total_pub)}</b> contributions</span>",
        f"          <span><b>{fmt(commits)}</b> commits</span>",
        f"          <span><b>{len(all_repos)}</b> repositories</span>",
        f'          <span class="grow"><a href="https://github.com/{USER}">github.com/{USER}</a></span>',
        "        </div>",
        '        <div class="bars">',
        *bars,
        "        </div>",
        '        <p class="fine" style="margin-top:12px">',
        f"          {months[0][0]:%B %Y} to {today:%B %Y}, public repositories only. Counting private work",
        f"          too, it is {fmt(total_all)} contributions. Regenerated from the GitHub API on",
        f"          {today.day} {today:%B %Y} by <code>tools/gen-gitstrip.py</code>.",
        "        </p>",
        "      </div>",
        "      " + END,
    ])

    leaked = sorted(n for n in private_names if re.search(rf"\b{re.escape(n)}\b", block))
    if leaked:
        sys.exit(f"refusing to write: private repo name(s) in output: {leaked}")

    text = page.read_text()
    if text.count(START) != 1 or text.count(END) != 1:
        sys.exit(f"refusing to write: expected exactly one {START} / {END} pair in {page.name}")
    new = re.sub(re.escape(START) + r".*?" + re.escape(END), lambda _: block, text, flags=re.S)
    if new != text:
        page.write_text(new)
    print(f"gitstrip: {total_pub} public / {total_all} total contributions, {commits} commits, "
          f"{len(all_repos)} repos ({'updated' if new != text else 'unchanged'})")


if __name__ == "__main__":
    main()
