"""Tests for tools/check-facts.py. Run: python3 -m unittest tools/test_check_facts.py"""
import importlib.util, pathlib, tempfile, unittest

spec = importlib.util.spec_from_file_location("check_facts", pathlib.Path(__file__).with_name("check-facts.py"))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


def run(pages, value, pattern=r"Of ([\d,]+) issues filed"):
    """Write pages {name: text} to a temp dir and check one fact whose occurrences are all pages."""
    with tempfile.TemporaryDirectory() as d:
        for name, text in pages.items():
            pathlib.Path(d, name).write_text(text)
        fact = {"id": "issues", "value": value, "note": "",
                "occurrences": [{"file": n, "pattern": pattern} for n in pages]}
        return c.check([fact], pathlib.Path(d))


class CheckTest(unittest.TestCase):
    def test_match_is_clean(self):
        self.assertEqual(run({"a.html": "Of 131 issues filed", "b.html": "<p>Of 131 issues filed</p>"}, 131), [])

    def test_mismatch_names_file_fact_and_both_numbers(self):
        self.assertEqual(run({"a.html": "Of 131 issues filed", "b.html": "Of 111 issues filed"}, 131),
                         ["b.html: issues says 111, facts.json says 131"])

    def test_missing_pattern_is_a_finding(self):
        f = run({"a.html": "no figure here"}, 131)
        self.assertEqual(len(f), 1)
        self.assertIn("matched 0 times", f[0])

    def test_pattern_matching_twice_is_a_finding(self):
        f = run({"a.html": "Of 131 issues filed. Of 131 issues filed"}, 131)
        self.assertIn("matched 2 times", f[0])

    def test_comma_formatting_is_ignored(self):
        p = r"scored ([\d,]+) sessions"
        self.assertEqual(run({"a.html": "scored 11,179 sessions", "b.html": "scored 11179 sessions"}, "11,179", p), [])
        self.assertEqual(run({"a.html": "scored 11,179 sessions"}, 11179, p), [])

    def test_percent_and_number_words(self):
        self.assertEqual(run({"a.html": "59% fewer"}, 59, r"(\d+%) fewer"), [])
        self.assertEqual(run({"a.html": "it caught four", "b.html": "it caught 4"}, 4, r"caught (\w+)"), [])

    def test_missing_file_is_a_finding(self):
        fact = {"id": "x", "value": 1, "occurrences": [{"file": "nope.html", "pattern": r"(\d)"}]}
        with tempfile.TemporaryDirectory() as d:
            self.assertIn("cannot read file", c.check([fact], pathlib.Path(d))[0])


if __name__ == "__main__":
    unittest.main()
