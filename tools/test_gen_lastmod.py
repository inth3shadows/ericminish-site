"""Tests for tools/gen-lastmod.py. Run: python3 -m unittest tools/test_gen_lastmod.py"""
import importlib.util, pathlib, unittest

spec = importlib.util.spec_from_file_location("gen_lastmod", pathlib.Path(__file__).with_name("gen-lastmod.py"))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

XML = """<urlset>
  <url><loc>https://www.ericminish.com/</loc></url>
  <url><loc>https://www.ericminish.com/portfolio/terse/</loc></url>
  <url><loc>https://www.ericminish.com/new/</loc></url>
</urlset>"""
DATES = {"index.html": "2026-11-17", "portfolio/terse/index.html": "2026-10-30"}


class LastMod(unittest.TestCase):
    def test_page_file(self):
        self.assertEqual(g.page_file("/"), "index.html")
        self.assertEqual(g.page_file("/portfolio/terse/"), "portfolio/terse/index.html")

    def test_dates_each_entry_and_skips_unknown(self):
        out = g.add_lastmod(XML, DATES.get)
        self.assertIn("<loc>https://www.ericminish.com/</loc><lastmod>2026-11-17</lastmod>", out)
        self.assertIn("/portfolio/terse/</loc><lastmod>2026-10-30</lastmod>", out)
        self.assertIn("<url><loc>https://www.ericminish.com/new/</loc></url>", out)

    def test_rerun_replaces_instead_of_stacking(self):
        once = g.add_lastmod(XML, DATES.get)
        twice = g.add_lastmod(once, {"index.html": "2026-12-01"}.get)
        self.assertEqual(twice.count("<lastmod>"), 1)
        self.assertIn("<lastmod>2026-12-01</lastmod>", twice)


if __name__ == "__main__":
    unittest.main()
