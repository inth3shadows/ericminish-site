# ericminish.com

Local source for the personal site served live from:

- Proxmox host: `nuc2` (`192.168.9.9`)
- Container: `LXC 901`
- Runtime: Docker + Caddy
- Live document root: `/opt/ericminish/site`

## Purpose

This site is the personal identity layer for Eric Minish.

Positioning (set 2026-07-28): **builder of agent and data infrastructure**,
with operational and AI fluency as the second layer — not an ops/integration
generalist. Rationale and voice contract:
`~/.claude/plans/ericminish-site-builder-positioning-rewrite.md`.

It should:

- establish who Eric is
- explain what he is doing now
- bridge cleanly to The Frostline Co.
- feel truthful, current, and direct

It should not:

- duplicate the Frostline sales site
- present a generic consulting menu
- contain placeholders or fake proof

## Structure

- `index.html` — home
- `about/` — background and working style
- `portfolio/` — case studies and selected work
- `portfolio/terse/`, `portfolio/origin-sentinel/`, `portfolio/llm-gateway/` — long-form case studies
- `homelab/` — practical lab notes
- `status/` — what is current right now
- `contact/` — direct contact path
- `assets/` — shared CSS and SVG assets

Contractor work is pointed at The Frostline Co. by link, not by a services
page on this site.

## Related Documentation

- [Technical Reference](TECHNICAL.md) — architecture, deployment, known limitations
- [Usage Guide](USAGE.md) — editing pages and publishing changes

## Deploy

1. Back up the current live tree in `LXC 901`.
2. Sync this folder's site contents into `/opt/ericminish/site`.
3. Verify locally inside the container at `http://127.0.0.1:8080`.
4. Verify publicly through `ericminish.com`.
