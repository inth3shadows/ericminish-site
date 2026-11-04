"""Tests for tools/draft-now.py. Run: python3 -m unittest tools/test_draft_now.py"""
import importlib.util, pathlib, unittest

spec = importlib.util.spec_from_file_location("draft_now", pathlib.Path(__file__).with_name("draft-now.py"))
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)

ARTICLE = ('<article class="timeline" data-card="terse" data-as-of="2026-10-01">\n'
           '          <h3><a href="/portfolio/terse/">terse</a></h3>\n'
           '          <!-- auto:start now-terse --><p class="fine">Last change 30 October 2026</p><!-- auto:end now-terse -->\n'
           '          <p>terse compresses tool output.</p>\n'
           '          <p>Late September: old news. <a href="/portfolio/terse/">Case study</a>.</p>\n'
           '        </article>')

SOURCES = {
    "S1": {"kind": "pr", "repo": "inth3shadows/terse", "number": 551, "title": "fix(security): red-team fixes (37 findings)",
           "url": "https://github.com/inth3shadows/terse/pull/551", "merged": "2026-10-29", "private": False,
           "text": "fix(security): red-team fixes (37 findings)\nbody", "dates": {"2026-10-29"}},
    "S2": {"kind": "pr", "repo": "inth3shadows/modelbench", "number": 232, "title": "secret internal plan",
           "url": "https://github.com/inth3shadows/modelbench/pull/232", "merged": "2026-11-01", "private": True,
           "text": "secret internal plan\nwindow-run screens 12 routes", "dates": {"2026-11-01"}},
}


def draft(text, sentences):
    return {"text": text, "sentences": sentences}


class ValidateTest(unittest.TestCase):
    def test_a_sourced_draft_passes(self):
        t = "29 October: fixes from a red-team review that found 37 problems."
        self.assertEqual(d.validate(draft(t, [{"text": t, "sources": ["S1"]}]), SOURCES), [])

    def test_a_number_missing_from_its_sources_fails(self):
        t = "29 October: fixes from a red-team review that found 41 problems."
        self.assertTrue(any("number 41" in p for p in d.validate(draft(t, [{"text": t, "sources": ["S1"]}]), SOURCES)))

    def test_a_number_from_an_uncited_source_fails(self):
        t = "It now screens 12 routes."
        self.assertTrue(d.validate(draft(t, [{"text": t, "sources": ["S1"]}]), SOURCES))

    def test_unknown_source_fails(self):
        t = "Something changed."
        self.assertTrue(any("missing sources" in p for p in d.validate(draft(t, [{"text": t, "sources": ["S9"]}]), SOURCES)))

    def test_uncited_sentence_fails(self):
        a, b = "29 October: red-team fixes.", " It also does many other things nobody cited."
        self.assertTrue(any("no cited sentence" in p for p in d.validate(draft(a + b, [{"text": a, "sources": ["S1"]}]), SOURCES)))

    def test_host_like_text_fails(self):
        t = "29 October: it moved to 192.168.1.20."
        self.assertTrue(any("host" in p for p in d.validate(draft(t, [{"text": t, "sources": ["S1"]}]), SOURCES)))

    def test_too_long_fails(self):
        t = " ".join(["word"] * 80)
        self.assertTrue(any("over" in p for p in d.validate(draft(t, [{"text": t, "sources": ["S1"]}]), SOURCES)))

    def test_empty_draft_is_reported(self):
        self.assertEqual(d.validate(draft("", []), SOURCES), ["the model found nothing worth an update"])


class ApplyTest(unittest.TestCase):
    def test_replaces_the_recent_paragraph_keeps_the_link_and_dates_the_card(self):
        out = d.apply(ARTICLE, "terse", "29 October: red-team fixes. It's safer.", "2026-11-30")
        self.assertIn('data-as-of="2026-11-30"', out)
        self.assertIn("<p>29 October: red-team fixes. It&rsquo;s safer. <a href=\"/portfolio/terse/\">Case study</a>.</p>", out)
        self.assertIn("<p>terse compresses tool output.</p>", out)
        self.assertIn("Last change 30 October 2026", out)
        self.assertNotIn("old news", out)

    def test_unknown_card_raises(self):
        with self.assertRaises(d.DraftError):
            d.apply(ARTICLE, "runecho", "x", "2026-11-30")


class PrBodyTest(unittest.TestCase):
    def test_private_titles_are_not_shown(self):
        t = "1 November: it screens 12 routes."
        r = {"terse": {"old": "Late September: old news.", "problems": [], "sources": SOURCES,
                       "draft": draft(t, [{"text": t, "sources": ["S2"]}])},
             "harness": {"old": "x", "problems": ["judge: sentence 0 unsupported"], "sources": {}, "draft": None}}
        body = d.pr_body(r, "2026-11-30")
        self.assertNotIn("secret internal plan", body)
        self.assertIn("inth3shadows/modelbench#232 (private; title not shown)", body)
        self.assertIn("Needs a hand edit", body)


if __name__ == "__main__":
    unittest.main()
