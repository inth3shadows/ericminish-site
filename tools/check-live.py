#!/usr/bin/env python3
"""Check that ericminish.com is serving a recent deploy; email once a day when it is not.

The daily deploy (regen-deploy.sh, ~06:15-06:30) writes /build.txt with the
deployed commit and time. This check reads it from the public site, so it sees
what visitors see: a failed deploy, a timer that never fired, a checkout that
can no longer fast-forward, or a site that is down.

Why a later check and not OnFailure= on the deploy: OnFailure fires at the
moment of failure, when whatever broke the deploy (1Password Connect, the
network) often blocks the alert too, and it never notices a timer that did not
fire. A check hours later sends once, after the cause has usually cleared.

  check-live.py                 print problems; exit 1 if any, else 0
  check-live.py --send 'CMD'    when there are problems and no alert went out today,
                                run CMD + [subject] with the body on stdin; a send
                                counts only if CMD's output starts with "SENT"
                                (what `terminal-health alert --send-only` prints)

Skips (exit 0) while the deploy is running and in the first 30 minutes after boot,
when the deploy timer's Persistent catch-up may be about to succeed.
"""
import argparse, datetime as dt, os, re, shlex, subprocess, sys, time, urllib.request

URL = "https://www.ericminish.com/build.txt"
DEPLOY_UNIT = "ericminish-regen.service"
#: Checks run at 10:00 and 14:00. Today's deploy is then under 8h old; a missed
#: day makes the last one over 27h old. 26h separates them.
MAX_AGE_H = 26
BOOT_GRACE_S = 30 * 60
STATE = os.path.expanduser("~/.local/state/ericminish-site/live-alert-sent")

# The deploy journal can carry an env dump or an error body; keep credential-shaped values out of email.
RE_SECRET = re.compile(
    r"([A-Za-z0-9_]*(KEY|TOKEN|PASSWORD|PASSWD|SECRET|CREDENTIAL)[A-Za-z0-9_\"']*\s*[=:]\s*)\S+", re.I)


def parse(text):
    """build.txt -> {"commit": sha, "deployed": aware datetime}. Raises ValueError if malformed."""
    fields = dict(line.split(" ", 1) for line in text.strip().splitlines() if " " in line)
    sha, when = fields.get("commit", ""), fields.get("deployed", "")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError(f"no commit sha in build.txt: {text[:80]!r}")
    deployed = dt.datetime.fromisoformat(when.replace("Z", "+00:00"))
    if deployed.tzinfo is None:
        raise ValueError(f"deploy time has no timezone: {when!r}")
    return {"commit": sha, "deployed": deployed}


def problems(text, error, now, max_age_h=MAX_AGE_H):
    """text: build.txt body, or None when the fetch failed with `error`. Returns a list of problems."""
    if text is None:
        return [f"could not read {URL}: {error}"]
    try:
        b = parse(text)
    except ValueError as e:
        return [f"{URL} is malformed: {e}"]
    age_h = (now - b["deployed"]).total_seconds() / 3600
    if age_h > max_age_h:
        return [f"last deploy was {age_h:.0f}h ago ({b['deployed']:%Y-%m-%d %H:%M} UTC, "
                f"commit {b['commit'][:7]}); the daily deploy has not succeeded since"]
    return []


def fetch():
    try:
        # Cloudflare answers 403 to urllib's default User-Agent.
        req = urllib.request.Request(f"{URL}?cb={int(time.time())}", headers={"User-Agent": "check-live/1"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read(4096).decode("utf-8", "replace"), None
    except Exception as e:  # noqa: BLE001 -- any failure to read it is the finding
        return None, f"{type(e).__name__}: {e}"


def run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def compose(found, journal):
    subject = "[ericminish.com] the live site is not current"
    journal = RE_SECRET.sub(r"\1[REDACTED]", journal)
    body = ("\n".join(f"- {p}" for p in found) + "\n\n"
            f"Last 30 journal lines of {DEPLOY_UNIT}:\n{journal}\n\n"
            f"Check: journalctl --user -u {DEPLOY_UNIT} -n 100\n"
            f"Deploy by hand: systemctl --user start {DEPLOY_UNIT}\n")
    return subject, body


def sent_today(today):
    try:
        with open(STATE) as f:
            return f.read().strip() == today
    except OSError:
        return False


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--send", metavar="CMD", help="mail command; gets the subject as its last argument")
    a = ap.parse_args(argv)

    if run(["systemctl", "--user", "is-active", DEPLOY_UNIT]).strip() in ("active", "activating"):
        print("check-live: skipped, the deploy is running")
        return 0
    with open("/proc/uptime") as f:
        if float(f.read().split()[0]) < BOOT_GRACE_S:
            print("check-live: skipped, booted under 30 minutes ago")
            return 0

    text, error = fetch()
    found = problems(text, error, dt.datetime.now(dt.timezone.utc))
    if not found:
        b = parse(text)
        print(f"check-live: OK, commit {b['commit'][:7]} deployed {b['deployed']:%Y-%m-%d %H:%M} UTC")
        return 0
    subject, body = compose(found, run(["journalctl", "--user", "-u", DEPLOY_UNIT, "-n", "30",
                                        "--no-pager", "-o", "cat"]))
    print(subject + "\n" + body)
    if not a.send:
        return 1

    today = dt.date.today().isoformat()
    if sent_today(today):
        print("check-live: alert already sent today")
        return 0
    out = subprocess.run(shlex.split(a.send) + [subject], input=body, capture_output=True, text=True).stdout
    print(out.strip())
    if not out.startswith("SENT"):
        return 1  # nothing recorded: the next check tries again
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w") as f:
        f.write(today + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
