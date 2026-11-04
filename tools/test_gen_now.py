"""Tests for tools/gen-now.py. Run: python3 -m unittest tools/test_gen_now.py"""
import importlib.util, pathlib, unittest

spec = importlib.util.spec_from_file_location("gen_now", pathlib.Path(__file__).with_name("gen-now.py"))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

U = g.USER
PRIVATE = {f"{U}/modelbench", f"{U}/secret-broker", f"{U}/harness", f"{U}/kb-mcp", f"{U}/soundings", f"{U}/hidden-thing"}


def page(as_of="2026-11-04", only=None):
    keys = only or list(g.CARDS)
    return "\n".join(f'<article class="timeline" data-card="{k}" data-as-of="{as_of}">' for k in keys)


class Fake:
    """Stands in for GitHub: per-repo merged PRs and push dates, plus an issue store."""

    def __init__(self, merged=None, pushed="2026-11-03", issue=None, fail_find=False):
        self.merged = merged or {}  # repo -> [(date, title)]
        self.pushed, self.issue, self.fail_find, self.writes = pushed, issue, fail_find, []

    def merged_prs(self, query, pages=1):
        terms = dict(t.split(":", 1) for t in query.split() if ":" in t)
        since = terms.get("merged", ">=0000-00-00")[2:]
        if "user" in terms:
            items = [{"repository_url": f"https://api.github.com/repos/{r}"} for r, prs in self.merged.items()
                     for d, _ in prs if d >= since]
            return len(items), [], items
        prs = sorted([p for p in self.merged.get(terms["repo"], []) if p[0] >= since], reverse=True)
        return len(prs), prs, []

    def repo(self, full):
        return {"private": full in PRIVATE, "pushed": self.pushed}

    def find_issue(self):
        if self.fail_find:
            raise g.ApiError("lookup failed")
        return self.issue

    def create_issue(self, body):
        self.writes.append(("create", body))

    def update_issue(self, number, body=None, close=False):
        self.writes.append(("update", number, body, close))


def prs(n, title="change", start=10):
    return [(f"2026-10-{start + i % 20:02d}", f"{title} {i}") for i in range(n)]


class CheckTest(unittest.TestCase):
    def test_current_page_has_no_warnings(self):
        self.assertEqual(g.check(page(), Fake(), "2026-11-04"), [])

    def test_age_uses_the_per_card_limit(self):
        w = g.check(page("2026-09-01"), Fake(pushed="2026-11-01"), "2026-11-04")
        aged = {x["card"] for x in w if x["kind"] == "age"}
        self.assertIn("terse", aged)          # 64 days > 45
        self.assertNotIn("day-job", aged)     # 64 days <= 90

    def test_activity_lists_titles(self):
        w = g.check(page("2026-10-01"), Fake({f"{U}/terse": prs(12, "terse fix")}), "2026-11-04")
        act = [x for x in w if x["kind"] == "activity"]
        self.assertEqual([x["card"] for x in act], ["terse"])
        self.assertEqual(act[0]["count"], 12)

    def test_dormant(self):
        w = g.check(page(), Fake(pushed="2026-08-01"), "2026-11-04")
        self.assertIn("terse", {x["card"] for x in w if x["kind"] == "dormant"})

    def test_uncovered_respects_ignore_list(self):
        merged = {f"{U}/new-thing": prs(9), f"{U}/job-scout": prs(30), f"{U}/flight-recorder": prs(9)}
        w = g.check(page(), Fake(merged), "2026-11-04")
        self.assertEqual([x["repo"] for x in w if x["kind"] == "uncovered"], [f"{U}/new-thing"])

    def test_card_and_config_mismatch(self):
        w = g.check(page(only=["terse", "mystery"]), Fake(), "2026-11-04")
        texts = " ".join(x["text"] for x in w if x["kind"] == "config")
        self.assertIn("mystery", texts)
        self.assertIn("runecho", texts)


class PrivacyTest(unittest.TestCase):
    def warnings(self):
        merged = {f"{U}/modelbench": prs(12, "secret plan"), f"{U}/terse": prs(11, "public fix"),
                  f"{U}/hidden-thing": prs(20, "x")}
        return g.check(page("2026-10-01"), Fake(merged), "2026-11-04")

    def test_public_render_hides_private_titles_and_names(self):
        body = g.render(self.warnings(), "2026-11-04", public=True)
        self.assertNotIn("secret plan", body)
        self.assertNotIn("hidden-thing", body)
        self.assertIn("public fix", body)
        self.assertIn("private titles not shown", body)
        self.assertIn("1 private repository", body)

    def test_local_render_shows_everything(self):
        body = g.render(self.warnings(), "2026-11-04", public=False)
        self.assertIn("secret plan", body)
        self.assertIn("hidden-thing", body)


class IssueTest(unittest.TestCase):
    W = [{"card": "terse", "kind": "age", "text": "terse: old"}]

    def test_creates_when_warnings_and_no_issue(self):
        f = Fake()
        self.assertEqual(g.sync_issue(f, self.W, "2026-11-04"), "created")
        self.assertEqual(f.writes[0][0], "create")

    def test_updates_existing_issue_instead_of_adding_one(self):
        f = Fake(issue=7)
        self.assertEqual(g.sync_issue(f, self.W, "2026-11-04"), "updated #7")
        self.assertEqual(f.writes, [("update", 7, g.render(self.W, "2026-11-04", True), False)])

    def test_closes_when_clean(self):
        f = Fake(issue=7)
        self.assertEqual(g.sync_issue(f, [], "2026-11-04"), "closed #7")
        self.assertTrue(f.writes[0][3])

    def test_failed_lookup_writes_nothing(self):
        f = Fake(fail_find=True)
        with self.assertRaises(g.ApiError):
            g.sync_issue(f, self.W, "2026-11-04")
        self.assertEqual(f.writes, [])


class MainTest(unittest.TestCase):
    def test_api_failure_is_skipped_unless_strict(self):
        class Boom(Fake):
            def repo(self, full):
                raise g.ApiError("network down")
        real, g.GitHub = g.GitHub, Boom
        try:
            root = pathlib.Path(__file__).resolve().parent.parent
            self.assertEqual(g.main(["--check", "--root", str(root), "--today", "2026-11-04"]), 0)
            self.assertEqual(g.main(["--check", "--strict", "--root", str(root), "--today", "2026-11-04"]), 1)
        finally:
            g.GitHub = real


if __name__ == "__main__":
    unittest.main()
