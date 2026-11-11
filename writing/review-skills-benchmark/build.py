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
GH = "https://github.com"
GIST = "https://gist.github.com/inth3shadows/0d27a0c578e7e3db61f629f51cb105bc/7b7991ef572d4b759759907f9b0726c951422dcc"
# Pinned commits; every file that ran matches the file at that commit by SHA-256 (protocol/seeds/).
SOURCE = {
    "superpowers": (f"{GH}/obra/superpowers/tree/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/requesting-code-review", "obra/superpowers @ 8ca22db (2026-09-25)"),
    "ponytail_review": (f"{GH}/DietrichGebert/ponytail/tree/552acd5efd0aeae2583a12efe39373d2f076f25e/skills/ponytail-review", "DietrichGebert/ponytail @ 552acd5 (2026-10-05)"),
    "caveman": (f"{GH}/JuliusBrussee/caveman/tree/2e08b9177c07bb7249a8a2d1a6758e5db281d002/skills/caveman-review", "JuliusBrussee/caveman @ 2e08b91 (2026-10-08)"),
    "ecc": (f"{GH}/affaan-m/ECC/blob/ef648e01899ba3e8dc6371642deaaf64b4477775/agents/code-reviewer.md", "affaan-m/ECC @ ef648e0 (2026-10-02)"),
    "tob_diffreview": (f"{GH}/trailofbits/skills/tree/e1f86a390d4caf28bf1c377a7d86707b2898669c/plugins/differential-review", "trailofbits/skills @ e1f86a3 (2026-10-14)"),
    "dual_nocg": (GIST, "gist, revision of 2026-11-11"),
    "dual_cg": (GIST, "gist, revision of 2026-11-11, plus code-graph tools"),
    "sp_pair": ("protocol/treatment/hybrid-sp-pair-SKILL.md", "protocol/treatment"),
    "dual_fast": ("protocol/treatment/hybrid-dual-fast-SKILL.md", "protocol/treatment"),
    "sp_inline": ("protocol/treatment/hybrid-sp-inline-SKILL.md", "protocol/treatment"),
}


def source(a):
    if a in SOURCE:
        url, label = SOURCE[a]
        return f'<a href="{html.escape(url, quote=True)}">{html.escape(label)}</a>'
    return "built into Claude Code 2.1.318" if a == "builtin" else "none"
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


E = D["economics"]["steps"]
PER = D["economics"]["reviews_per_rep"]
VT = 100.0  # $/h assumed for the AI-cost term only; it moves break-evens by well under a minute


def breakeven(step, m, metric="real_per_rep", bound="value", wait=False, vt=VT):
    """Minutes of reader time a caught defect must be worth for the step to pay (Δ > 0), or the most it may be worth
    for a cheaper step that finds fewer to pay (Δ < 0). None: no finite threshold (Δ's bound at or past zero)."""
    e = E[step]
    d = (e[metric]["value"] if bound == "value" else e[metric]["ci95"][0 if bound == "lo" else 1]) / PER
    cost = e["d_cost"] / vt * 60 + e["d_findings"] * m + (e["d_secs"] / 60 if wait else 0)
    if d == 0 or (d < 0) != (e[metric]["value"] < 0):
        return None
    return cost / d


def fm(x):
    return "no bound" if x is None else ("never" if x < 0 else f"{x:.0f}")


def econ_fig():
    steps = [("dual_nocg - none", "c-clear", None, "Dual review vs bare"),
             ("superpowers - none", "c-unclear", None, "Superpowers vs bare"),
             ("dual_nocg - superpowers", "c-unclear", "6 4", "Dual review vs Superpowers")]
    mmax = 10
    ymax = max(breakeven(k, mmax) for k, *_ in steps) * 1.1
    x0, x1, y0, y1 = 60, 520, 20, 250
    X = lambda m: x0 + m / mmax * (x1 - x0)  # noqa: E731
    Y = lambda v: y1 - min(v, ymax) / ymax * (y1 - y0)  # noqa: E731
    lo, hi = (lambda m: breakeven("dual_nocg - none", m, bound="hi")), (lambda m: breakeven("dual_nocg - none", m, bound="lo"))
    out = ['<svg viewBox="0 0 680 300" role="img" aria-labelledby="t-econ" class="chart">',
           '<title id="t-econ">Break-even value of a caught defect against triage minutes per finding</title>',
           f'<polygon points="{X(0):.1f},{Y(lo(0)):.1f} {X(mmax):.1f},{Y(lo(mmax)):.1f} {X(mmax):.1f},{Y(hi(mmax)):.1f} '
           f'{X(0):.1f},{Y(hi(0)):.1f}" style="fill: var(--accent); opacity: 0.15"/>',
           f'<line class="c-tick" x1="{x0}" x2="{x1}" y1="{y1}" y2="{y1}"/>',
           f'<line class="c-tick" x1="{x0}" x2="{x0}" y1="{y0}" y2="{y1}"/>']
    for k, cls, dash, lab in steps:
        a, b = breakeven(k, 0), breakeven(k, mmax)
        out += [f'<line class="{cls}" x1="{X(0):.1f}" y1="{Y(a):.1f}" x2="{X(mmax):.1f}" y2="{Y(b):.1f}"'
                + (f' stroke-dasharray="{dash}"' if dash else "") + "/>",
                f'<text class="c-label" x="{X(mmax) + 8:.1f}" y="{Y(b) + 4:.1f}">{html.escape(lab)}</text>']
    for t in range(0, mmax + 1, 2):
        out += [f'<line class="c-tick" x1="{X(t):.1f}" x2="{X(t):.1f}" y1="{y1}" y2="{y1 + 5}"/>',
                f'<text class="c-axis" x="{X(t):.1f}" y="{y1 + 18}" text-anchor="middle">{t}</text>']
    step = 10 if ymax <= 80 else 20
    for v in range(0, int(ymax) + 1, step):
        out += [f'<line class="c-tick" x1="{x0 - 5}" x2="{x0}" y1="{Y(v):.1f}" y2="{Y(v):.1f}"/>',
                f'<text class="c-axis" x="{x0 - 9}" y="{Y(v) + 4:.1f}" text-anchor="end">{v}</text>']
    out += [f'<text class="c-axis" x="{(x0 + x1) / 2:.0f}" y="{y1 + 38}" text-anchor="middle">Minutes to triage one finding</text>',
            f'<text class="c-axis" x="16" y="{(y0 + y1) / 2:.0f}" text-anchor="middle" transform="rotate(-90 16 {(y0 + y1) / 2:.0f})">'
            'Break-even, minutes per caught defect</text>', '</svg>']
    return "\n".join(out)


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
    n_primary = 2 * (narms - 1) + len([k for k in C if not k.endswith(" - none")]) + \
        2 * len([k for k in E if not k.endswith(" - none")])
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

    t1 = table(["Arm", "What it is", "Source as run", "Models used"],
               [[name(a), html.escape(NAMES[a][1]), source(a), models(a)] for a in ORDER], num_from=9)
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
        ["Cohen's κ, <code>REAL_*</code> verdict or not", ag0["kappa_real_vs_not"], ag12["kappa_real_vs_not"]],
        ["Clusters assigned <code>CONTESTED</code> (one judge <code>REAL_*</code>, the other not; not counted as a defect)", ag0["contested"], ag12["contested"]],
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
    econ_rows = ["superpowers - none", "dual_nocg - none", "dual_nocg - superpowers"] + \
        [f"{a} - none" for a in ORDER if a not in ("none", "none_b") and clear(A[a]["minus_bare"]) and A[a]["minus_bare"]["value"] < 0]

    def step_label(k):
        a, b = k.split(" - ")
        return f"{name(a)} vs {name(b)}"

    def s2(x):
        return ("+" if x > 0.005 else "−" if x < -0.005 else "") + f"{abs(x):.2f}"

    def per_review_ci(c):
        return f'{s2(c["value"] / PER)} ({s2(c["ci95"][0] / PER)} to {s2(c["ci95"][1] / PER)})'

    def be_cell(k, m, metric="real_per_rep"):
        if not clear(E[k][metric]):
            return "no bound"
        v = breakeven(k, m, metric)
        if v is None or v < 0.5:
            return "never" if E[k][metric]["value"] < 0 else "always"
        return ("more than " if E[k][metric]["value"] > 0 else "less than ") + f"{v:.0f}"

    t8 = table(["Step", "Δ real defects / review (95%)", "Δ serious / review", "Δ findings to read / review",
                "Δ est. $ / review", "Δ wait, s", "Pays if a caught defect is worth (min), triage 1 min",
                "3 min", "10 min", "Serious only, 3 min"],
               [[step_label(k), per_review_ci(E[k]["real_per_rep"]), s2(E[k]["s1s2_per_rep"]["value"] / PER),
                 sg(E[k]["d_findings"]), s2(E[k]["d_cost"]), f'{E[k]["d_secs"]:+.0f}'.replace("-", "−"),
                 be_cell(k, 1), be_cell(k, 3), be_cell(k, 10), be_cell(k, 3, "s1s2_per_rep")] for k in econ_rows])
    dn_be = {m: breakeven("dual_nocg - none", m) for m in (1, 3, 10)}
    dn_band = (breakeven("dual_nocg - none", 3, bound="hi"), breakeven("dual_nocg - none", 3, bound="lo"))
    dn_ser = breakeven("dual_nocg - none", 3, "s1s2_per_rep")
    dn_wait = breakeven("dual_nocg - none", 3, wait=True) - dn_be[3]
    ds = E["dual_nocg - superpowers"]
    ds_be, ds_ser_clear = breakeven("dual_nocg - superpowers", 3), clear(ds["s1s2_per_rep"])
    sp_be = breakeven("superpowers - none", 3)
    below = econ_rows[3:]
    below_max = max(breakeven(k, 3) or 0 for k in below) if below else None
    vt_low = breakeven("dual_nocg - none", 3, vt=20) - dn_be[3]
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
          <span><time datetime="{DATE}">11 November 2026</time></span>
          <!-- auto:start readtime --><span>18 min read</span><!-- auto:end readtime -->
        </p>
      </header>

      <div class="note"><p><b>Review.</b> Checked independently against the data by two models from other families
        over five review rounds (Section 5.6, on economics, was added after them); the headline difference moved from +22.0 to {sg(dn['minus_bare']['value'])} as
        attribution was tightened (<a href="protocol/changelog.md">changelog</a>). Every number on this page is
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
        defect-level attribution step that credits a reviewer only for what it said; (4) two-family severity
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
        verdicts (<code>REAL_NEW</code>, <code>REAL_OLD</code> for pre-existing, <code>NOT_DEFECT</code>,
        <code>FALSE</code>, <code>NOT_A_CLAIM</code>, <code>UNVERIFIABLE</code>; no judge used the last), cites the
        deciding line, and gives a failing input for a <code>REAL_*</code> verdict, running code where it can. A cluster
        counts as a real defect only when both judges give a <code>REAL_*</code> verdict (<code>REAL_NEW</code> if
        either says new, otherwise <code>REAL_OLD</code>). When one judge gives a <code>REAL_*</code> verdict and the
        other does not, the cluster is assigned <code>CONTESTED</code> and not counted as a defect; when neither does and
        their reasons differ, the first judge's verdict is recorded. {tot['excluded_findings']} findings that fell next
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
        would exclude zero by chance even with no true difference, so single borderline results should be read as
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
        {jv.get('REAL_NEW', 0) + jv.get('REAL_OLD', 0)} <code>REAL_*</code>, {jv.get('NOT_DEFECT', 0)} <code>NOT_DEFECT</code>,
        {jv.get('FALSE', 0)} <code>FALSE</code>, {jv.get('NOT_A_CLAIM', 0)} <code>NOT_A_CLAIM</code> and
        {jv.get('UNVERIFIABLE', 0)} <code>UNVERIFIABLE</code> verdicts.</figcaption>{t6}</figure>

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
      <h3>5.6 Is it worth it?</h3>
      <p>A review bundle costs its reader in three ways: the estimated token cost, the time spent reading its findings
        (true and false), and, for a reader who waits for it, its run time. It repays them in defects caught before they
        ship. Since there is no reliable figure for what an escaped defect costs (the widely cited phase-escalation
        multipliers rest on weak evidence; see <a href="https://leanpub.com/leprechauns">Bossavit</a>), I do not assume
        one. Instead, for each step from one bundle to another I compute the break-even: how many minutes of the reader's
        time a caught defect must be worth, after weighting by the chance it would otherwise have shipped, for the step
        to pay. This applies the quality-economics framing of
        <a href="https://arxiv.org/abs/1612.03785">Wagner (ISSTA 2006)</a> to measured per-review differences:
        break-even = (Δ token cost ÷ hourly value + Δ findings × triage minutes per finding [+ Δ run time]) ÷ Δ defects
        caught. The token cost term uses ${VT:.0f} an hour and barely matters: at $20 an hour it would add
        {vt_low:.1f} minutes to dual review's break-even. Triage minutes per finding is the reader's to choose; an
        industrial study of static-analysis alarms puts manual triage at 10 to 20 minutes each
        (<a href="https://arxiv.org/abs/2601.18844">arXiv:2601.18844</a>), and a review finding with a failing input is
        usually quicker to check.</p>
      <figure><figcaption>Table 7. Break-even per step, per review. "More than <i>x</i>": the step pays when a caught
        defect is worth more than <i>x</i> minutes of the reader's time. "Less than <i>x</i>": the cheaper bundle finds
        fewer defects, and switching to it pays only when a caught defect is worth less than <i>x</i> minutes. "No bound":
        the difference in defects has an interval that includes zero, so no threshold is supported. Run time is not
        counted; estimated token cost at ${VT:.0f}/h.</figcaption>{t8}</figure>
      <figure><figcaption>Figure 2. Break-even against triage minutes per finding. Above a line, the step pays. The band
        is the break-even of dual review over bare at the ends of the 95% interval of its extra defects.</figcaption>
{econ_fig()}
      </figure>
      <p><b>When dual review is worth it.</b> Over bare Claude Code it pays whenever a caught defect is worth more than
        about {dn_be[3]:.0f} minutes of the reader's time at 3 minutes of triage per finding ({dn_band[0]:.0f} to
        {dn_band[1]:.0f} across the interval), or {dn_be[1]:.0f} minutes at 1 minute per finding. Counting only serious
        (S1–S2) defects, the bar is about {dn_ser:.0f} minutes. If the reader waits for each review, add about
        {dn_wait:.0f} minutes. For code where a shipped defect costs an hour or more of someone's time, that bar is low.</p>
      <p><b>When it is not.</b> The break-even grows with triage time: at 10 minutes per finding it is about
        {dn_be[10]:.0f} minutes per caught defect, so slow-to-verify findings on low-stakes code (prototypes, throwaway
        scripts) do not repay it. Most of dual review's cost is its extra findings to read
        ({sg(E['dual_nocg - none']['d_findings'])} per review, {sg(E['dual_nocg - none']['d_false_findings'])} of them
        identifying no defect), not its tokens.</p>
      <p><b>Dual review or Superpowers.</b> Superpowers pays over bare above about {sp_be:.0f} minutes per caught defect
        at 3 minutes of triage, because it adds only {sg(E['superpowers - none']['d_findings'])} findings per review. Going
        on to dual review adds {s2(ds['real_per_rep']['value'] / PER)} defects per review
        (95% interval {s2(ds['real_per_rep']['ci95'][0] / PER)} to {s2(ds['real_per_rep']['ci95'][1] / PER)}) for
        {ds['d_findings']:.1f} more findings to read, a break-even
        of about {ds_be:.0f} minutes. {"Its extra serious defects, " + s2(ds['s1s2_per_rep']['value'] / PER) + " per review, have an interval that includes zero, so a reader who counts only serious defects and whose triage time is dear has no evidence here that the step from Superpowers to dual review pays." if not ds_ser_clear else ""}</p>
      <p><b>Bundles below bare.</b> {names_of([k.split(" - ")[0] for k in below])} find fewer defects than bare and save
        a little reading. Switching to one pays only if a caught defect is worth less than about {below_max:.0f} minutes at
        3 minutes of triage, so as replacements for bare Claude Code they are not worth it for any code where defects
        matter.</p>
      <p>These are point estimates of a linear model for one reader and one task set. A fuller treatment would put a
        distribution on the value of a caught defect and report the probability that each step pays. That is left for
        the replay on past pull requests.</p>

      <h2 id="limits">6 Limitations <a class="anchor" href="#limits" aria-label="Link to this section">#</a></h2>
      <ul>
        <li><b>Judges from one family.</b> Adjudication and attribution were done by Claude Opus 5.5, grading Claude
          output, and attribution used one judge per task. No finding was labelled by a person or by a judge from another
          family.</li>
        <li><b>Labels move between rounds.</b> Of {ag12['same_spot_as_round_before']} round-2 clusters at a spot judged in
          round 1, {shifted} got a different call on whether they were a defect. Wording and clustering differ, so this is not a pure
          test-retest measure, but it is measurement noise the intervals do not include.</li>
        <li><b>Severity is soft.</b> The two severity families agree only moderately (linear-weighted κ
          {s12['kappa_linear']} in round 2), and round 1 used a different Codex model, with {s0['real_items'] - s0['both']}
          of its {s0['real_items']} real clusters graded by one family. The graders were also told, wrongly for {n_unrep} of
          {n_items} clusters, that both judges had reproduced each one (Section 3.4).</li>
        <li><b>Coverage.</b> Planted hits are matched by location, not meaning (a mapped claim can also credit a plant),
          and {tot['excluded_findings']} findings near dropped plant candidates were not adjudicated.</li>
        <li><b>Bundles are compared whole.</b> Arms differ in models, subagents, instructions, compute and credential mix;
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
        cannot attribute to the verifier alone. On the break-even analysis (Section 5.6), dual review pays over bare
        when a caught defect is worth more than about {dn_be[3]:.0f} minutes of the reader's time at 3 minutes of triage
        per finding, and most of its cost is the time spent reading its findings. Next steps are a replay on past pull requests, a cross-family or human
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

      <h2 id="cite">How to cite <a class="anchor" href="#cite" aria-label="Link to this section">#</a></h2>
      <pre><code>@misc{{minish2026reviewskills,
  author = {{Eric Minish}},
  title  = {{{TITLE}}},
  year   = {{2026}},
  month  = {{nov}},
  url    = {{https://www.ericminish.com/writing/{SLUG}/}}
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
