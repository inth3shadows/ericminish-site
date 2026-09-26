# ericminish.com

**I build the infrastructure AI agents run on, and the data work that runs on top of it.**
This is the source of [ericminish.com](https://ericminish.com): hand-written static HTML,
no build step, no JavaScript, served from my own homelab.

Start with the work:

- **[terse](https://github.com/inth3shadows/terse)** — shrinks what an agent's tool servers return, 59% fewer tokens, lossless by default.
- **[testgraph](https://github.com/inth3shadows/testgraph)** — given a diff, names the user journeys it could have broken, and says when it doesn't know.
- **[RunEcho](https://github.com/inth3shadows/runecho)** — stops an agent writing a call to a function the repo doesn't have, before the write lands.
- **[codeshot](https://github.com/inth3shadows/codeshot)** — architecture diagrams that fail CI when they go stale.

Long-form case studies of terse, testgraph and RunEcho (and more) are under [/portfolio](https://ericminish.com/portfolio/).

## Hosting

Served as static files by Caddy in a self-hosted container behind a Cloudflare
tunnel. Host, container, document root and the deploy runbook (including its
gotchas) are kept in the private homelab knowledge base under
`host-ericminish.com`, not here: this repo is public.

## Structure

- `index.html` — home
- `about/` — background and working style
- `portfolio/` — case studies and selected work
- long-form case studies, one directory each: `portfolio/terse/`, `portfolio/runecho/`,
  `portfolio/testgraph/`, `portfolio/harness/`, `portfolio/modelbench/`,
  `portfolio/lodestone/`, `portfolio/frostline/`, `portfolio/origin-sentinel/`,
  `portfolio/llm-gateway/`
- `homelab/` — practical lab notes
- `status/` — what is current right now
- `contact/` — direct contact path
- `assets/` — shared CSS and SVG assets

Contractor work is pointed at The Frostline Co. by link, not by a services
page on this site.

## Editorial Rules

The site's positioning and editorial rules are a recorded decision in the
private knowledge base (decision #496, "ericminish.com positions Eric as a
builder of agent and data infrastructure"), not here: this repo is public.

## Related Documentation

- [Technical Reference](TECHNICAL.md) — architecture, deployment, known limitations
- [Usage Guide](USAGE.md) — editing pages and publishing changes

## Deploy

Host, container, document root and the deploy runbook (including its
gotchas) are kept in the private homelab knowledge base under
`host-ericminish.com`, not here: this repo is public.

1. Back up the current live tree.
2. Copy this folder's site contents *into* the live document root (never swap
   the directory itself; the runbook says why).
3. Verify locally inside the container at `http://127.0.0.1:8080`.
4. Verify publicly through `ericminish.com`.
