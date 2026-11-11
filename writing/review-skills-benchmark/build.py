#!/usr/bin/env python3
"""Build index.html for the review-skill benchmark paper from data.json (numbers are never typed).

usage: python3 build.py            (reads data.json next to this file, writes index.html)
data.json comes from tooling personal/bench/skill-pilot/paper_analysis.py (version 4: plants in the defect
catalogue, multi-defect claims, full-list precision, per-defect provenance, task-cluster bootstrap). Site chrome is copied from
writing/measuring-coding-agents/index.html. protocol/ holds the non-secret instructions the paper cites.
"""
import html
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SLUG = "review-skills-benchmark"
TITLE = "Review skills on real code: a three-rep benchmark of Claude Code review setups"
DATE = "2026-11-11"
D = json.load(open(os.path.join(HERE, "data.json")))
A, C = D["arms"], D["comparisons"]

NAMES = {
    "dual_nocg": ("Dual review", "my dual-review skill: Claude Code's built-in /code-review and a briefed code-reviewer subagent, run in parallel and merged"),
    "dual_cg": ("Dual review + code graph", "the same bundle, with code-graph and symbol-index MCP tools available"),
    "superpowers": ("Superpowers", "obra/superpowers, requesting-code-review"),
    "sp_pair": ("Hybrid: pair + verifier", "a Superpowers-style reviewer and a terse reviewer, then a verifier that splits findings into Confirmed and Unconfirmed"),
    "dual_fast": ("Hybrid: parallel dual + verifier", "both halves of dual review launched in parallel, then the same verifier"),
    "sp_inline": ("Hybrid: single loop", "the pair's instructions in one loop with no subagents, ending in Confirmed and Unconfirmed lists"),
    "none": ("Bare (A)", "Claude Code with no review skill"),
    "none_b": ("Bare (B)", "the same setup, as a second independent arm"),
    "ponytail_review": ("Ponytail", "ponytail-review"),
    "caveman": ("Caveman", "caveman-review"),
    "tob_diffreview": ("Trail of Bits", "trailofbits/skills, differential-review"),
    "builtin": ("Built-in /code-review", "Claude Code's own review command"),
    "ecc": ("ECC", "everything-claude-code, code-reviewer agent"),
}
HYB = ("sp_pair", "dual_fast", "sp_inline")
ORDER = sorted(A, key=lambda a: -A[a]["real_scored_per_rep"]["value"])
LABEL = {"dual_nocg": "Dual review", "dual_cg": "Dual review + code graph", "none_b": "Bare (B)", "none": "Bare (A)",
         "superpowers": "Superpowers", "sp_pair": "Hybrid: pair", "dual_fast": "Hybrid: parallel dual",
         "sp_inline": "Hybrid: single loop"}


def f1(x):
    return f"{x:.1f}"


def sg(x):
    return ("+" if x > 0 else "−" if x < 0 else "") + f"{abs(x):.1f}"


def ci(c, f=f1):
    return f"{f(c['ci95'][0])} to {f(c['ci95'][1])}"


def name(a):
    return html.escape(NAMES[a][0])


def clear(c):
    return c["ci95"][0] > 0 or c["ci95"][1] < 0


AA_GAP = abs(C["none_b - none"]["value"])


def models(a):
    return " + ".join(("Opus 5.5" if "opus" in k else "Sonnet 5.5" if "sonnet" in k else k) for k in sorted(A[a]["models"]))


def table(head, rows, num_from=1):
    th = "".join(f'<th{" class=\"num\"" if i >= num_from else ""}>{h}</th>' for i, h in enumerate(head))
    body = "".join("<tr>" + "".join(f'<td{" class=\"num\"" if i >= num_from else ""}>{c}</td>' for i, c in enumerate(r))
                   + "</tr>" for r in rows)
    return f'<div class="table-scroll"><table><tr>{th}</tr>{body}</table></div>'


def contrast_label(k):
    for key in sorted(LABEL, key=len, reverse=True):
        k = re.sub(rf"\b{key}\b", LABEL[key], k)
    return html.escape(k)


def forest():
    arms = [a for a in ORDER if a != "none"]
    lo = min(A[a]["minus_bare"]["ci95"][0] for a in arms) - 2
    hi = max(A[a]["minus_bare"]["ci95"][1] for a in arms) + 2
    x0, x1, row = 220, 650, 30
    X = lambda v: x0 + (v - lo) / (hi - lo) * (x1 - x0)  # noqa: E731
    base = 20 + row * len(arms)
    out = [f'<svg viewBox="0 0 680 {base + 50}" role="img" aria-labelledby="t-forest" class="chart">',
           '<title id="t-forest">Real defects per rep, difference from bare Claude Code (A)</title>',
           f'<line class="c-zero" x1="{X(0):.1f}" x2="{X(0):.1f}" y1="10" y2="{base}"/>']
    for i, a in enumerate(arms):
        y, m = 30 + i * row, A[a]["minus_bare"]
        cls = "c-clear" if clear(m) else "c-unclear"
        out += [f'<text class="c-label" x="{x0 - 12}" y="{y + 4}" text-anchor="end">{name(a)}</text>',
                f'<line class="{cls}" x1="{X(m["ci95"][0]):.1f}" x2="{X(m["ci95"][1]):.1f}" y1="{y}" y2="{y}"/>',
                f'<circle class="{cls}" cx="{X(m["value"]):.1f}" cy="{y}" r="4.5"/>']
    t = int((lo // 5) * 5)
    while t <= hi:
        if t >= lo:
            out += [f'<line class="c-tick" x1="{X(t):.1f}" x2="{X(t):.1f}" y1="{base}" y2="{base + 5}"/>',
                    f'<text class="c-axis" x="{X(t):.1f}" y="{base + 18}" text-anchor="middle">{t:+d}</text>']
        t += 5
    out += [f'<text class="c-axis" x="{(x0 + x1) / 2:.0f}" y="{base + 38}" text-anchor="middle">'
            'Difference in real defects per rep (arm minus Bare A)</text>', '</svg>']
    return "\n".join(out)


def main():
    ag0, ag12 = D["agreement"]["r0"], D["agreement"]["r12"]
    s0, s12 = ag0["severity"], ag12["severity"]
    at0, at12 = D["attribution"]["r0"], D["attribution"]["r12"]
    tot, ntask, narms = D["totals"], len(D["tasks"]), len(A)
    dn, dc, sp, bare = A["dual_nocg"], A["dual_cg"], A["superpowers"], A["none"]
    cg, aa = C["dual_cg - dual_nocg"], C["none_b - none"]
    dfr, spr, sir = (C[f"{h} (reported) - dual_nocg"] for h in ("dual_fast", "sp_pair", "sp_inline"))
    n_def = at0["defects_both_judges"] + at12["defects_both_judges"]
    n_single = at0["defects_single_judge"] + at12["defects_single_judge"]
    n_claims = at0["claims_total"] + at12["claims_total"]
    n_mapped = at0["claims_mapped"] + at12["claims_mapped"]
    shifted = ag12["same_spot_as_round_before"] - ag12["same_real_call_as_round_before"]
    vs_bare = [a for a in ORDER if a not in ("none", "none_b")]
    worse = [a for a in vs_bare if clear(A[a]["minus_bare"]) and A[a]["minus_bare"]["value"] < 0]
    better = [a for a in vs_bare if clear(A[a]["minus_bare"]) and A[a]["minus_bare"]["value"] > 0]
    small = [a for a in better + worse if abs(A[a]["minus_bare"]["value"]) <= AA_GAP]
    planted = [A[a]["planted_per_rep"]["value"] for a in A]
    public = ("superpowers", "ponytail_review", "caveman", "tob_diffreview", "ecc", "builtin")
    better_public = [a for a in better if a in public]
    worse_public = [a for a in worse if a in public]
    n_primary = 2 * (narms - 1) + len([k for k in C if not k.endswith(" - none")])
    n_sens = sum(1 for a in A if a != "none" for k in ("minus_bare_reps12_only", "s1s2_reproduced_minus_bare") if k in A[a])
    n_plants = at0["plants"] + at12["plants"]
    n_multi = at0["claims_mapped_two_plus"] + at12["claims_mapped_two_plus"]
    n_items = at0["real_items"] + at12["real_items"]
    n_unrep = n_items - at0["real_items_both_reproduced"] - at12["real_items_both_reproduced"]
    prec = lambda a: f'{A[a]["precision_full_list"]:.2f}'  # noqa: E731
    sp_ratio = sp["minus_bare"]["value"] / abs(aa["value"]) if aa["value"] else None
    cost_ratio = dn["cost_estimate_per_review"]["value"] / bare["cost_estimate_per_review"]["value"]
    time_ratio = dn["secs_per_review"]["value"] / bare["secs_per_review"]["value"]
    jv = ag12["judge_verdicts"]

    def names_of(xs):
        xs = [NAMES[a][0] for a in xs]
        return ", ".join(xs[:-1]) + (" and " if len(xs) > 1 else "") + xs[-1] if xs else "none"

    t1 = table(["Arm", "What it is", "Models used"], [[name(a), html.escape(NAMES[a][1]), models(a)] for a in ORDER], num_from=9)
    t2 = table(["Arm", "Real / rep", "95% interval", "Minus Bare A", "95% interval", "Planted", "Other real",
                "of which pre-existing", "Precision", "Est. $ / review", "s / review"],
               [[name(a), f1(A[a]["real_scored_per_rep"]["value"]), ci(A[a]["real_scored_per_rep"]),
                 "" if a == "none" else sg(A[a]["minus_bare"]["value"]),
                 "" if a == "none" else ci(A[a]["minus_bare"], sg),
                 f1(A[a]["planted_per_rep"]["value"]), f1(A[a]["other_real_per_rep"]["value"]),
                 f1(A[a]["real_old_per_rep"]["value"]), prec(a),
                 f'{A[a]["cost_estimate_per_review"]["value"]:.2f}', f'{A[a]["secs_per_review"]["value"]:.0f}'] for a in ORDER])
    t3 = table(["Comparison", "Difference in real defects / rep", "95% interval"],
               [[contrast_label(k), sg(v["value"]), ci(v, sg)] for k, v in C.items()])
    t4 = table(["Arm", "Scored list / rep", "Scored + Unconfirmed / rep", "Scored-list precision"],
               [[name(a), f1(A[a]["real_scored_per_rep"]["value"]), f1(A[a]["real_reported_per_rep"]["value"]),
                 prec(a)] for a in HYB]
               + [[name("dual_nocg"), f1(dn["real_scored_per_rep"]["value"]), "no Unconfirmed list", prec("dual_nocg")]])
    t5 = table(["Arm", "S1+S2 / rep", "95% interval", "Minus Bare A", "95% interval",
                "Clusters flagged reproduced / rep", "Minus Bare A", "95% interval"],
               [[name(a), f1(A[a]["s1s2_per_rep"]["value"]), ci(A[a]["s1s2_per_rep"]),
                 "" if a == "none" else sg(A[a]["s1s2_minus_bare"]["value"]),
                 "" if a == "none" else ci(A[a]["s1s2_minus_bare"], sg),
                 f1(A[a]["s1s2_reproduced_per_rep"]["value"]),
                 "" if a == "none" else sg(A[a]["s1s2_reproduced_minus_bare"]["value"]),
                 "" if a == "none" else ci(A[a]["s1s2_reproduced_minus_bare"], sg)]
                for a in sorted(A, key=lambda x: -A[x]["s1s2_per_rep"]["value"])])
    t6 = table(["Measure", "Round 1", "Round 2"], [
        ["Reviews", D["rounds"]["r0"]["cells"], D["rounds"]["r12"]["cells"]],
        ["Adjudicated clusters", ag0["items"], ag12["items"]],
        ["Same verdict from both judges", ag0["same_verdict"], ag12["same_verdict"]],
        ["Cohen's κ between the two judges' verdicts", ag0["kappa_6way"], ag12["kappa_6way"]],
        ["Cohen's κ, real vs not real", ag0["kappa_real_vs_not"], ag12["kappa_real_vs_not"]],
        ["Clusters assigned CONTESTED (one judge real, one not; counted not real)", ag0["contested"], ag12["contested"]],
        ["Real clusters / reproduced by both judges", f'{at0["real_items"]} / {at0["real_items_both_reproduced"]}',
         f'{at12["real_items"]} / {at12["real_items_both_reproduced"]}'],
        ["Catalogue: planted defects / other defects both judges accepted", f'{at0["plants"]} / {at0["defects_both_judges"]}',
         f'{at12["plants"]} / {at12["defects_both_judges"]}'],
        ["Other defects: accepted by one judge only (dropped) / pre-existing", f'{at0["defects_single_judge"]} / {at0["defects_pre_existing"]}',
         f'{at12["defects_single_judge"]} / {at12["defects_pre_existing"]}'],
        ["Distinct claims mapped to a defect / to two or more / to none",
         f'{at0["claims_mapped"]} / {at0["claims_mapped_two_plus"]} / {at0["claims_null"]}',
         f'{at12["claims_mapped"]} / {at12["claims_mapped_two_plus"]} / {at12["claims_null"]}'],
        ["Severity: real clusters / graded by both families", f'{s0["real_items"]} / {s0["both"]}', f'{s12["real_items"]} / {s12["both"]}'],
        ["Severity: exact / one apart / two or more apart", f'{s0["exact"]} / {s0["one_apart"]} / {s0["two_plus_apart"]}',
         f'{s12["exact"]} / {s12["one_apart"]} / {s12["two_plus_apart"]}'],
        ["Severity: linear-weighted κ", s0["kappa_linear"], s12["kappa_linear"]],
        ["Second severity grader", ", ".join(s0["codex_models"]), ", ".join(s12["codex_models"])],
    ])
    t7 = table(["Arm", "Rep 0", "Rep 1", "Rep 2", "SD across reps", "Minus Bare A, reps 1–2 only", "Equivalent-mutant flags",
                "Findings not adjudicated", "Reviews on API key / subscription"],
               [[name(a)] + [A[a]["real_by_rep"].get(str(r), "") for r in (0, 1, 2)] +
                [A[a]["real_rep_sd"], "" if a == "none" else f'{sg(A[a]["minus_bare_reps12_only"]["value"])} ({ci(A[a]["minus_bare_reps12_only"], sg)})',
                 A[a]["equiv_mutant_flags"], A[a]["excluded_findings"],
                 f'{A[a]["auth"].get("key", 0)} / {A[a]["auth"].get("oauth", 0)}'] for a in ORDER])

    abstract = (
        f"Skill packs for Claude Code promise better code review, but they are rarely measured on their users' own code. "
        f"I ran {narms} review bundles (bare Claude Code twice, the built-in review command, five public skill packs, "
        f"my own dual-review skill with and without code-graph tools, and three exploratory hybrids) on {ntask} review "
        f"tasks built from real commits in four of my repositories, three times each: {tot['cells']} reviews. Two blind "
        f"Claude Opus 5.5 judges adjudicated the findings that matched no planted defect, except {tot['excluded_findings']} "
        f"next to dropped plant candidates (Cohen's κ {ag12['kappa_6way']} "
        f"on the larger round); the planted and accepted defects were then listed per task, and each review was credited once "
        f"for each listed defect it hit by location or identified in a claim. Dual review found {f1(dn['real_scored_per_rep']['value'])} real defects per rep against "
        f"{f1(bare['real_scored_per_rep']['value'])} for bare Claude Code, a difference of {sg(dn['minus_bare']['value'])} "
        f"(95% interval {ci(dn['minus_bare'], sg)}), including {sg(dn['s1s2_minus_bare']['value'])} serious (S1–S2) "
        f"defects per rep ({ci(dn['s1s2_minus_bare'], sg)}). Its estimated token cost per review was about "
        f"{cost_ratio:.1f} times that of bare Claude Code and its elapsed time {time_ratio:.1f} times, and the two dual-review bundles had the "
        f"lowest precision of those tested. Of the public packs and the built-in command, {names_of(better_public)} scored "
        f"above bare Claude Code, while {names_of(worse_public)} scored below it, all with 95% intervals that exclude zero; two identical "
        f"bare arms also differed by {sg(aa['value'])} ({ci(aa, sg)}), so differences of that size arise between reruns. "
        f"These are comparisons of "
        f"whole bundles, which differ in "
        f"models, instructions and compute as well as in skill.")

    body = f"""
      <header class="post-header">
        <p class="post-kicker">Preprint · Agent evaluation · Software engineering</p>
        <h1>{html.escape(TITLE)}</h1>
        <p class="post-meta">
          <span>By <a href="/about/">Eric Minish</a></span>
          <span>Draft <time datetime="{DATE}">11 November 2026</time></span>
          <!-- auto:start readtime --><span>18 min read</span><!-- auto:end readtime -->
        </p>
      </header>

      <div class="note"><p><b>Status.</b> Draft, version 5. Before publication, each version is checked independently against the data file by two
        models from other families for factual and statistical errors. Versions 1 to 4 were reviewed
        this way and changed substantially; see <a href="#corrections">Corrections</a>. Every number on this page is
        generated from <a href="data.json">data.json</a>.</p></div>

      <div class="summary"><p><b>Abstract.</b> {html.escape(abstract)}</p></div>

      <nav class="toc" aria-label="Contents">
        <p>Contents</p>
        <ol>
          <li><a href="#intro">Introduction</a></li>
          <li><a href="#related">Related work</a></li>
          <li><a href="#method">Method</a></li>
          <li><a href="#results">Results</a></li>
          <li><a href="#analysis">Analysis</a></li>
          <li><a href="#limits">Limitations</a></li>
          <li><a href="#conclusion">Conclusion</a></li>
          <li><a href="#appendix">Appendix</a></li>
          <li><a href="#corrections">Corrections</a></li>
          <li><a href="#cite">How to cite</a></li>
        </ol>
      </nav>

      <h2 id="intro">1 Introduction <a class="anchor" href="#intro" aria-label="Link to this section">#</a></h2>
      <p>Claude Code skills package instructions, agents, hooks and scripts that change how the agent works, and review
        skills are among the most installed. Their claims are usually supported by examples rather than measurement, and
        the measurements that exist use other people's code. I wanted to know which review setup to run on my own work.</p>
      <p>This paper contributes: (1) a review benchmark built from real commits in the repositories I work in, with
        planted defects, clean controls and equivalent-mutant traps; (2) a three-rep comparison of {narms} bundles, with
        bare Claude Code run as two independent arms; (3) blind two-judge adjudication of findings, followed by a
        defect-level attribution step that credits a reviewer only for what it actually said; (4) two-family severity
        grading of the real defects; and (5) the estimated cost and runtime of each bundle.</p>

      <h2 id="related">2 Related work <a class="anchor" href="#related" aria-label="Link to this section">#</a></h2>
      <p>SWE-bench and its successors score agents on resolving issues in open-source repositories by whether a test
        suite passes. METR's study of maintainer review found that many changes passing that grader would not be merged,
        which is the gap a reviewer is meant to close. Project-level benchmarks such as ProjDevBench fold review
        compliance into a score. Mutation testing supplies the planted-defect method used here, and its equivalent mutants
        (changes that alter no behaviour) supply a false-alarm trap. The closest work is kamui's code-review-bench
        (<a href="https://github.com/kamui/code-review-bench">github.com/kamui/code-review-bench</a>), which compares
        Claude Code and Codex review setups, including review skills, on 16 open-source pull requests. Its reference
        problems are checked by reproduction before and after the change, and it reports detection, claim reliability,
        clean-change silence and cost separately, with no blended score. When I checked it in November 2026 its
        scorecard was marked a preview. This paper differs in using my own repositories, planted defects
        and three reps per arm.</p>

      <h2 id="method">3 Method <a class="anchor" href="#method" aria-label="Link to this section">#</a></h2>
      <h3>3.1 Tasks</h3>
      <p>Each task is a pull-request-sized change from the history of one of four repositories of mine: a Python
        market-intelligence pipeline, a Python knowledge-base MCP server, this benchmark's own Python harness, and a Go
        code-index tool. A task is materialised as a two-commit repository (base and change) with history squashed, so the
        reviewer cannot read the answer from the log. Of the {ntask} tasks, 8 carry planted defects (mutations that a test
        suite shows change behaviour), 4 are clean real commits, and 2 carry an equivalent mutant, which no correct reviewer
        should flag. Real defects already present in the original commits are counted too.</p>
      <h3>3.2 Arms</h3>
      <p>An arm is a whole bundle: skill, agents, hooks and scripts, installed into a fresh sandboxed Claude Code home.
        The main agent is Claude Opus 5.5 in every arm and Claude Code is pinned to version 2.1.318, but five bundles also
        start subagents on Claude Sonnet 5.5 (Table 1), so the comparison is between bundles, not skills on a fixed model.
        The dual-review and hybrid files are published as run (Appendix), except for one redacted passage in the
        dual-review skill that describes a private project; the unredacted file is identified by its hash.
        Each review runs in a network-restricted sandbox with the same prompt, preceded by a line telling the agent to use
        the arm's skill (<a href="protocol/reviewer-prompt.md">protocol</a>). A guard checked every transcript for the
        skill or subagent call: every skill arm fired in every review.</p>
      <figure><figcaption>Table 1. The {narms} arms, with the models that appeared in their transcripts (all
        {A['none']['cells']} reviews of each arm).</figcaption>{t1}</figure>
      <h3>3.3 Runs</h3>
      <p>Round 1 ran rep 0 for the ten arms that existed then ({D['rounds']['r0']['cells']} reviews). The hybrids were
        designed after round 1, using round-1 transcripts, so they are exploratory. Round 2 ran reps 1 and 2 for all
        {narms} arms and rep 0 for the hybrids ({D['rounds']['r12']['cells']} reviews). Claude Code's own estimate of the
        token cost of all {tot['cells']} reviews, at API prices, is ${tot['cost_estimate']:.2f}; it is an estimate, not
        what was paid. {tot['auth']['key']} reviews ran on an API key under a batch spend limit ($85 and $13 for the
        two main key batches, with the 25 reviews of the second also capped at $2.50 per review by Claude Code's
        <code>--max-budget-usd</code>), and {tot['auth']['oauth']} ran on a subscription token. Every attempt that exited
        non-zero was rerun, whatever it had produced; two such parallel-dual attempts had done work before a usage limit
        stopped them, and their time and estimated cost ($0.39) are not in the per-review figures. The per-review timeout
        was 1500 s and the longest review took 1494 s. Launch settings, batches, limits, the rerun rule, file hashes for
        every arm and the finding-extraction rules are in the <a href="protocol/run-manifest.md">run manifest</a>. No review's estimated cost exceeded ${tot['max_review_cost_estimate']:.2f}, so no limit cut a
        review short. The credential type (API key or subscription) was set by batch rather than per arm, and the
        batches did not balance it across arms (Table A1).</p>
      <h3>3.4 Scoring</h3>
      <p><b>Planted defects.</b> A finding that names a planted defect's location counts as a hit; the rule does not
        check that the finding describes the planted fault (Section 6). A review is also credited with a planted defect
        when the attribution step below maps one of its claims to it.</p>
      <p><b>Adjudication.</b> Findings that match no planted defect are clustered with nearby findings from other arms by
        file and line, stripped of wording that reveals the arm, and judged blind by two independent Claude Opus 5.5 judges
        in separate copies of the repository (<a href="protocol/adjudication.md">protocol</a>). Each judge gives one of six
        verdicts (real and new, real and pre-existing, not a defect, false, not a claim, unverifiable; no judge used the
        last), cites the deciding
        line, and gives a failing input for a real verdict, running code where it can. A cluster is real only when both
        judges call it real (real and new if either judge says new, otherwise pre-existing). When one judge calls it
        real and the other does not, it is assigned CONTESTED and counted as not real; when both call it not real for
        different reasons, the first judge's verdict is recorded. {tot['excluded_findings']} findings that fell next
        to a dropped plant candidate were neither scored as hits nor adjudicated (Table A1).</p>
      <p><b>Defect attribution.</b> A cluster can hold several different claims, and two clusters can describe one
        defect. So, per task, a further blind Opus judge built a catalogue of defects: every planted defect
        ({n_plants} over both rounds), and each other defect that both judges' evidence supports ({n_def}; {n_single}
        supported by one judge only were dropped). A real cluster that is a consequence of a planted defect is listed
        under the plant, so it cannot count twice. The judge marked each defect pre-existing or introduced by the
        change, then mapped each of the {n_claims} distinct claims in the task, at any cluster, to every catalogue defect
        it identifies ({n_mapped} were mapped to at least one, {n_multi} of them to two or more;
        <a href="protocol/defect-attribution.md">protocol</a>). A review is credited once for each catalogue defect it
        hits by location or identifies in a mapped claim. One judge did this step per task. The catalogue and every mapping
        are published as <a href="attribution.json">attribution.json</a>, with texts given as SHA-256 hashes because
        the repositories are private.</p>
      <p><b>Severity.</b> Each real cluster was graded S1 (critical) to S4 (trivial) by Claude Opus 5.5 and by a Codex
        model (Table 6; <a href="protocol/severity.md">protocol</a>). Disagreements of one level take the more severe grade;
        disagreements of two or more levels take the less severe; a cluster graded by only one family takes that grade. A defect takes the most severe
        grade among its clusters; planted defects are not graded. The graders were told that both judges had reproduced
        every cluster, but in {n_unrep} of the {n_items} real clusters at least one judge did not report a reproduction.
        Table 5 therefore also counts serious defects using only clusters that both judges flagged as reproduced. The
        flag is per cluster: a cluster that supports several defects may not have reproduced each of them, and one
        cluster's grade can pass to several defects, so this is a sensitivity check, not a count of verified
        reproductions.</p>
      <p><b>Scored and reported lists.</b> The hybrids end with a Confirmed and an Unconfirmed list, and the reader sees
        both. The main results score the Confirmed list, as designed; Table 4 adds the Unconfirmed list.</p>
      <p><b>Precision</b> is over a bundle's whole scored list: findings that hit a planted defect plus adjudicated claim
        occurrences mapped to a catalogue defect, divided by all findings in the list except those near a dropped plant
        candidate. Equivalent-mutant flags and unmapped claims count against it.</p>
      <h3>3.5 Statistics</h3>
      <p>The quantity estimated is a bundle's expected yield per rep, that is per {ntask} reviews (one per task), on tasks
        like these. Per-rep figures sum each task's mean across reps. Intervals are 95% percentile
        intervals from a task-cluster bootstrap ({D['bootstrap']['resamples']:,} resamples, fixed seed): each arm's
        rep-averaged per-task values are resampled by task, with the same task resamples for every arm; reps are not
        resampled, since resampling them again within tasks double-counts their variance. Differences are paired by
        task and computed once. Treating the
        tasks as exchangeable is an assumption: they were chosen by hand and several share a repository. Rep 0 of the ten
        original arms ran in round 1 under a different adjudication batch, so Table A1 also gives each difference from
        reps 1–2 alone. The paper reports {n_primary} primary intervals for differences and {n_sens} sensitivity
        intervals (Tables 5 and A1); at the 95% level about one in twenty
        would exclude zero by chance even with no real difference, so single borderline results should be read as
        exploratory.</p>

      <h2 id="results">4 Results <a class="anchor" href="#results" aria-label="Link to this section">#</a></h2>
      <figure><figcaption>Table 2. Per-arm results over three reps; a rep is {ntask} reviews, one per task. Real defects are
        catalogue defects credited from the scored list; planted counts plants hit by location or by a mapped claim. Estimated cost is Claude Code's token-cost estimate at API prices.</figcaption>{t2}</figure>
      <figure><figcaption>Figure 1. Real defects per rep, each arm minus Bare (A), with 95% intervals. Grey intervals
        include zero.</figcaption>
{forest()}
      </figure>
      <figure><figcaption>Table 3. Other comparisons.</figcaption>{t3}</figure>
      <figure><figcaption>Table 4. Hybrids with and without their Unconfirmed lists.</figcaption>{t4}</figure>
      <figure><figcaption>Table 5. Serious (S1 or S2) non-planted defects per rep. Round-1 clusters graded by one family
        are included at that grade. The last three columns grade each defect only from clusters both judges
        flagged as reproduced (Section 3.4).</figcaption>{t5}</figure>
      <figure><figcaption>Table 6. Agreement between judges and graders. In round 2 the individual judges gave
        {jv.get('REAL_NEW', 0) + jv.get('REAL_OLD', 0)} real, {jv.get('NOT_DEFECT', 0)} not-a-defect, {jv.get('FALSE', 0)}
        false, {jv.get('NOT_A_CLAIM', 0)} not-a-claim and {jv.get('UNVERIFIABLE', 0)} unverifiable verdicts.</figcaption>{t6}</figure>

      <h2 id="analysis">5 Analysis <a class="anchor" href="#analysis" aria-label="Link to this section">#</a></h2>
      <h3>5.1 The two bare arms</h3>
      <p>Bare (A) and Bare (B) are the same setup. They differ by {sg(aa['value'])} real defects per rep
        ({ci(aa, sg)}){", an interval that excludes zero" if clear(aa) else ""}. A correctly calibrated 95% interval
        excludes zero for two identical arms about one time in twenty, so this one comparison cannot show whether the
        intervals are too narrow or this is chance. I report it as a negative control, not a threshold: it shows that a
        gap of this size can arise between identical setups, and differences of similar size below should be read with
        that in mind.</p>
      <h3>5.2 Which bundles differ from bare</h3>
      <p>{names_of(better)} are above bare Claude Code, while {names_of(worse)} are below it, all with intervals that
        exclude zero (Figure 1).{(" " + names_of(small) + (" differs" if len(small) == 1 else " differ") + " from bare by no more than the two bare arms differ from each other.") if small else ""}
        Superpowers' difference is {sg(sp['minus_bare']['value'])} ({ci(sp['minus_bare'], sg)}), about {sp_ratio:.1f}
        times the bare-arm gap, but how far it exceeds that gap is itself uncertain. Dual review's gain lies in real defects in the original commits
        ({f1(dn['other_real_per_rep']['value'])} per rep against {f1(bare['other_real_per_rep']['value'])}), not in planted
        ones, which all arms find at broadly similar rates ({min(planted):.1f} to {max(planted):.1f} per rep); {f1(dn['real_old_per_rep']['value'])} of its defects per rep are
        pre-existing, outside the change itself.</p>
      <h3>5.3 Cost, time and precision</h3>
      <p>Dual review took {dn['secs_per_review']['value']:.0f} s and an estimated ${dn['cost_estimate_per_review']['value']:.2f}
        per review, against {bare['secs_per_review']['value']:.0f} s and ${bare['cost_estimate_per_review']['value']:.2f} for
        bare. Its precision ({prec('dual_nocg')}) and that of its code-graph variant ({prec('dual_cg')}) are the lowest of all
        arms: about {1 - dn['precision_full_list']:.0%} and {1 - dc['precision_full_list']:.0%} of their scored findings
        identify no listed defect. The experiment does not show why
        the bundle finds more. It uses more compute, two reviewers and a second model, and no matched-compute baseline was
        run.</p>
      <h3>5.4 Code-graph tools</h3>
      <p>Adding code-graph tools changed real defects per rep by {sg(cg['value'])} ({ci(cg, sg)}). The interval is wide;
        the experiment cannot tell a moderate benefit or harm from none.</p>
      <h3>5.5 Hybrids</h3>
      <p>Counting their Unconfirmed lists, the hybrids report more real defects than their Confirmed lists alone (Table 4),
        but none has an interval above dual review's: {sg(dfr['value'])} ({ci(dfr, sg)}) for the parallel dual,
        {sg(spr['value'])} ({ci(spr, sg)}) for the pair, and {sg(sir['value'])} ({ci(sir, sg)}) for the single loop. The
        parallel dual uses dual review's two reviewers; its Confirmed list has precision
        {prec('dual_fast')} against dual review's {prec('dual_nocg')}, and it moves real defects
        into the Unconfirmed list. Because the hybrids also change instructions and orchestration, these comparisons do not
        isolate the verifier.</p>

      <h2 id="limits">6 Limitations <a class="anchor" href="#limits" aria-label="Link to this section">#</a></h2>
      <ul>
        <li><b>Judges from one family.</b> Adjudication and attribution were done by Claude Opus 5.5, grading Claude
          output, and attribution used one judge per task. No finding was labelled by a person or by a judge from another
          family.</li>
        <li><b>Labels move between rounds.</b> Of {ag12['same_spot_as_round_before']} round-2 clusters at a spot judged in
          round 1, {shifted} got a different real/not-real call. Wording and clustering differ, so this is not a pure
          test-retest measure, but it is measurement noise the intervals do not include.</li>
        <li><b>Severity is soft.</b> The two severity families agree only moderately (linear-weighted κ
          {s12['kappa_linear']} in round 2), and round 1 used a different Codex model, with {s0['real_items'] - s0['both']}
          of its {s0['real_items']} real clusters graded by one family. The graders were also told, wrongly for {n_unrep} of
          {n_items} clusters, that both judges had reproduced each one (Section 3.4).</li>
        <li><b>Coverage.</b> Planted hits are matched by location, not meaning (a mapped claim can also credit a plant),
          and {tot['excluded_findings']} findings near dropped plant candidates were not adjudicated.</li>
        <li><b>Bundles, not skills.</b> Arms differ in models, subagents, instructions, compute and credential mix;
          these effects cannot be separated from the bundle comparisons.</li>
        <li><b>A small, personal task set.</b> {ntask} tasks from four repositories I wrote, in Python and Go.</li>
        <li><b>I built one arm and the hybrids.</b> I wrote dual review, and designed the hybrids after seeing
          the round-1 results; they need held-out tasks before any claim about them generalises.</li>
        <li><b>Code is private.</b> The harness and analysis are in private repositories; the protocol files, the
          treatment files for dual review and the hybrids (one passage redacted), the run manifest with every arm's file hashes,
          <a href="attribution.json">attribution.json</a> and <a href="data.json">data.json</a> are public; transcripts
          and claim texts are not. The public packs are identified by file hash only, and the number of reviews running
          at once was not recorded per review.</li>
      </ul>

      <h2 id="conclusion">7 Conclusion <a class="anchor" href="#conclusion" aria-label="Link to this section">#</a></h2>
      <p>On my code, the dual-review bundle found {sg(dn['minus_bare']['value'])} more real defects per rep than bare Claude
        Code ({ci(dn['minus_bare'], sg)}), {"including more serious ones" if clear(dn['s1s2_minus_bare']) else "though its gain in serious defects is uncertain"}, at about {cost_ratio:.1f} times the estimated cost
        and {time_ratio:.1f} times the time per review, and with the lowest precision of the bundles tested apart from its
        code-graph variant. Superpowers also scored above bare Claude Code, by about {sp_ratio:.1f} times the gap between the two
        identical bare arms, while {names_of(worse_public)} scored below it. Code-graph tools did not change yield detectably. The
        hybrids did not show a yield gain over dual review; the parallel dual's Confirmed list was more precise
        ({prec('dual_fast')} against {prec('dual_nocg')}) at a lower scored yield, a trade-off these bundle comparisons
        cannot attribute to the verifier alone. Next steps are a replay on real past pull requests, a cross-family or human
        check of the adjudication, a matched-compute baseline, and held-out tasks for the hybrids.</p>

      <h2 id="appendix">Appendix <a class="anchor" href="#appendix" aria-label="Link to this section">#</a></h2>
      <figure><figcaption>Table A1. Per-rep totals, run-to-run spread, the difference from bare using reps 1–2 only,
        equivalent-mutant flags (on the two equivalent-mutant tasks over three reps), findings not adjudicated, and the
        credential split.</figcaption>{t7}</figure>
      <p>Protocol files: <a href="protocol/reviewer-prompt.md">reviewer prompt</a>,
        <a href="protocol/adjudication.md">adjudication</a>, <a href="protocol/defect-attribution.md">defect attribution</a>,
        <a href="protocol/severity.md">severity</a>, <a href="protocol/run-manifest.md">run manifest</a>. Treatment files:
        <a href="protocol/treatment/dual-review-SKILL.md">dual-review skill</a> (one passage about a private project
        redacted),
        <a href="protocol/treatment/code-reviewer.md">code-reviewer agent</a>, the hybrids'
        <a href="protocol/treatment/hybrid-sp-pair-SKILL.md">pair</a>
        (<a href="protocol/treatment/hybrid-sp-pair-reviewer.md">deep reviewer brief</a>),
        <a href="protocol/treatment/hybrid-dual-fast-SKILL.md">parallel dual</a>,
        <a href="protocol/treatment/hybrid-sp-inline-SKILL.md">single loop</a> and
        <a href="protocol/treatment/hybrid-review-verifier.md">verifier</a>; file hashes for every arm:
        <a href="protocol/seeds/round1-batches-c-d.json">round 1</a>,
        <a href="protocol/seeds/round1-code-graph-rerun.json">round 1 code-graph rerun</a>,
        <a href="protocol/seeds/round2.json">round 2</a>, <a href="protocol/seeds/round2-hybrid-rep0.json">round 2
        hybrids, rep 0</a>. <a href="data.json">data.json</a> holds every figure on this page with its interval, and
        <a href="attribution.json">attribution.json</a> the defect catalogue and claim mappings behind them.</p>

      <h2 id="corrections">Corrections <a class="anchor" href="#corrections" aria-label="Link to this section">#</a></h2>
      <p><b>Version 5 (11 November 2026).</b> The fourth review (Codex gpt-6.1-sol and GLM 5.3 Prime) found that version
        4's new rule, counting a difference from bare only when it exceeded the gap between the two bare arms, compared
        two noisy point estimates, and that Section 5.1 drew a conclusion about the intervals from one comparison. Version
        5 drops the rule and reports the bare arms as a negative control. It also corrects the run manifest's rerun rule,
        adds launch settings, file hashes and extraction rules, publishes the structure of the defect catalogue and the
        claim mappings (texts as hashes only), states
        the precision trade-off of the parallel-dual hybrid in the conclusion, relabels the reproduced-only severity count
        as a sensitivity check, and gives the abstract's adjudication exception. No number changed.</p>
      <p><b>Version 4.</b> The third review (Codex gpt-6.1-sol and GLM 5.3 Prime) found that planted
        defects were outside the defect catalogue, so a real cluster caused by a plant could count again as a separate
        defect; that each claim could map to only one defect; that precision left out planted hits; that provenance was
        set per cluster rather than per defect; that the two-level bootstrap counted within-task variance twice; that the
        severity graders were wrongly told every cluster was reproduced; and that the treatment files and run manifest
        were unpublished. Version 4 puts plants in the catalogue, maps claims to lists of defects, measures precision over
        the whole scored list, takes provenance from the attribution judge, uses a task-cluster bootstrap, adds a
        reproduced-only severity count, renames the CONTESTED row, publishes the treatment files and run manifest, and
        cites code-review-bench. Dual review's lead over bare is +17.7, and under the new
        intervals the two bare arms' gap excludes zero.</p>
      <p><b>Version 3.</b> The second review (GLM 5.3 Prime and Codex gpt-6.1-sol) found that version
        2's attribution judged each claim only against its own cluster's defect, which dropped correct claims about defects
        accepted at other clusters and merged two different defects in one case; and that precision collapsed several claims
        from one review into one. Version 3 lists the accepted defects per task and maps every claim to them, measures
        precision per claim, uses one shared set of resamples so each comparison has a single interval, states the estimand
        and the exchangeability assumption, labels costs as estimates, reports the reps-1–2-only differences, the findings
        not adjudicated and the credential imbalance, and publishes the protocol files. Superpowers' difference from bare
        now excludes zero, and dual review's lead is +17.7.</p>
      <p><b>Version 2.</b> The first review found that every reviewer in a cluster inherited the cluster's verdict, that
        one root cause could count twice, that the model mix was misstated, that the hybrids' Unconfirmed lists were
        ignored, and that an ad hoc noise floor was used. Claim-level attribution, two-level resampling and the other fixes
        lowered dual review's lead over bare from +22.0 to +15.3.</p>

      <h2 id="cite">How to cite <a class="anchor" href="#cite" aria-label="Link to this section">#</a></h2>
      <pre><code>@misc{{minish2026reviewskills,
  author = {{Eric Minish}},
  title  = {{{TITLE}}},
  year   = {{2026}},
  month  = {{nov}},
  url    = {{https://www.ericminish.com/writing/{SLUG}/}},
  note   = {{Draft, version 5}}
}}</code></pre>
"""
    tpl = open(os.path.join(HERE, "..", "measuring-coding-agents", "index.html"), encoding="utf-8").read()
    head = tpl[:tpl.index("<body>")]
    chrome = tpl[tpl.index("<body>"):tpl.index('<main class="post-shell"')]
    footer = tpl[tpl.index("</article>"):]
    desc = html.escape(abstract[:300].rsplit(" ", 1)[0] + "…", quote=True)
    head = head.replace("Measuring coding agents by what happens to their code", html.escape(TITLE))
    head = head.replace("measuring-coding-agents", SLUG).replace("2026-11-01", DATE)
    head = re.sub(r'(<meta name="description" content=")[^"]*', r"\g<1>" + desc, head)
    head = re.sub(r'(<meta (?:property="og|name="twitter):description" content=")[^"]*', r"\g<1>" + desc, head)
    page = head + chrome + '<main class="post-shell" id="main">\n    <article class="post">' + body + "    " + footer
    open(os.path.join(HERE, "index.html"), "w", encoding="utf-8").write(page)
    print("wrote", os.path.join(HERE, "index.html"))


if __name__ == "__main__":
    main()
