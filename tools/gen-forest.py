#!/usr/bin/env python3
"""Draw interval ("forest") charts for a post from its data.json, as inline SVG.

Usage: python tools/gen-forest.py writing/<slug>
For each metric in METRICS it rewrites the block between
<!-- auto:start chart-<metric> --> and <!-- auto:end chart-<metric> --> in the
post's index.html: an accessible SVG plus a <details> table of the same numbers.
Intervals that exclude zero are drawn in the accent colour; the rest are muted.
"""
import html, json, pathlib, re, sys

METRICS = {
    "survival": {"label": "Difference in line survival (share of lines still present)", "fmt": "{:+.3f}"},
    "ktok": {"label": "Difference in cost per session (thousand weighted tokens)", "fmt": "{:+.0f}k"},
}
W, LEFT, RIGHT, ROW, TOP, BOTTOM = 680, 190, 24, 36, 16, 46


def ticks(lo, hi):
    span = hi - lo
    step = next(s for s in [0.05, 0.1, 0.2, 25, 50, 100, 200] if span / s <= 7)
    first = -int(-lo // step) * step  # smallest multiple of step >= lo
    out, t = [], first
    while t <= hi + 1e-9:
        out.append(round(t, 6))
        t += step
    return out


def fmt_tick(t):
    return "0" if abs(t) < 1e-9 else f"{t:+g}"


def svg(metric, spec, pairs):
    vals = [v for p in pairs for v in p[metric]] + [0]
    lo, hi = min(vals), max(vals)
    pad = (hi - lo) * 0.06
    lo, hi = lo - pad, hi + pad
    plot_w = W - LEFT - RIGHT
    x = lambda v: LEFT + (v - lo) / (hi - lo) * plot_w
    base = TOP + ROW * len(pairs)
    h = base + BOTTOM
    title = html.escape(spec["label"])
    out = [f'<svg viewBox="0 0 {W} {h}" role="img" aria-labelledby="t-{metric} d-{metric}" class="chart">',
           f'<title id="t-{metric}">{title}</title>',
           f'<desc id="d-{metric}">Point estimate and 95% interval for each model pair. A positive value means the first model is higher. Values are in the table below the chart.</desc>',
           f'<line class="c-zero" x1="{x(0):.1f}" x2="{x(0):.1f}" y1="{TOP - 6}" y2="{base}"/>']
    for i, p in enumerate(pairs):
        est, a, b = p[metric]
        y = TOP + ROW * i + ROW / 2
        cls = "c-clear" if (a > 0 or b < 0) else "c-unclear"
        out.append(f'<text class="c-label" x="{LEFT - 12}" y="{y + 4:.1f}" text-anchor="end">{html.escape(p["a"])} − {html.escape(p["b"])}</text>')
        out.append(f'<line class="{cls}" x1="{x(a):.1f}" x2="{x(b):.1f}" y1="{y:.1f}" y2="{y:.1f}"/>')
        out.append(f'<circle class="{cls}" cx="{x(est):.1f}" cy="{y:.1f}" r="4.5"/>')
    for t in ticks(lo, hi):
        out.append(f'<line class="c-tick" x1="{x(t):.1f}" x2="{x(t):.1f}" y1="{base}" y2="{base + 5}"/>')
        out.append(f'<text class="c-axis" x="{x(t):.1f}" y="{base + 18}" text-anchor="middle">{fmt_tick(t)}</text>')
    out.append(f'<text class="c-axis" x="{LEFT + plot_w / 2:.1f}" y="{base + 38}" text-anchor="middle">{title}</text>')
    out.append("</svg>")
    return "\n".join(out)


def table(metric, spec, pairs):
    f = spec["fmt"].format
    rows = "".join(
        f'<tr><td>{html.escape(p["a"])} − {html.escape(p["b"])}</td><td class="num">{p["cohorts"]}</td>'
        f'<td class="num">{f(p[metric][0])}</td><td class="num">{f(p[metric][1])} to {f(p[metric][2])}</td></tr>'
        for p in pairs)
    return ('<details><summary>The numbers in this chart</summary><div class="table-scroll"><table>'
            '<tr><th>Pair</th><th class="num">Cohorts</th><th class="num">Difference</th><th class="num">95% interval</th></tr>'
            f'{rows}</table></div></details>')


def main():
    post = pathlib.Path(sys.argv[1])
    data = json.loads((post / "data.json").read_text())
    page = post / "index.html"
    text = page.read_text()
    done = []
    for metric, spec in METRICS.items():
        start, end = f"<!-- auto:start chart-{metric} -->", f"<!-- auto:end chart-{metric} -->"
        if text.count(start) != 1 or text.count(end) != 1:
            continue
        block = f"{start}\n{svg(metric, spec, data['pairs'])}\n{table(metric, spec, data['pairs'])}\n{end}"
        text = re.sub(re.escape(start) + r".*?" + re.escape(end), lambda _: block, text, flags=re.S)
        done.append(metric)
    page.write_text(text)
    print(f"charts {done} written into {page}")


if __name__ == "__main__":
    main()
