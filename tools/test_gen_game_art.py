"""Tests for tools/gen-game-art.py (no network: the API call is replaced).
Run: python3 -m unittest tools/test_gen_game_art.py"""
import base64, contextlib, importlib.util, io, json, pathlib, tempfile, unittest

spec = importlib.util.spec_from_file_location("gen_game_art", pathlib.Path(__file__).with_name("gen-game-art.py"))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

CFG = {"style": "STYLE. ", "scenes": {"02-road": {"prompt": "A wagon on a hill road."}}}
PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG fake").decode()


def no_image(cost):
    return {"choices": [{"message": {"images": []}}], "usage": {"cost": cost}}


def image(cost):
    return {"choices": [{"message": {"images": [{"image_url": {"url": PNG}}]}}], "usage": {"cost": cost}}


class FakeCall:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, model, prompt, size, key):
        self.calls.append((model, size, prompt))
        return self.responses.pop(0)


class GenGameArt(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        self.log = self.dir / "cost.jsonl"

    def tearDown(self):
        self.tmp.cleanup()

    def run_gen(self, fake, budget=3.5, env=None):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            result = g.generate("02-road", self.dir, CFG, env or {}, "k", budget, self.log, call=fake)
        return result, out.getvalue()

    # Review F6: EXTRA_<nn> was read and then dropped.
    def test_extra_env_is_added_to_the_prompt(self):
        prompt = g.build_prompt(CFG, "02-road", {"EXTRA_02": "Less fog, more sky."})
        self.assertIn("A wagon on a hill road.", prompt)
        self.assertIn("Less fog, more sky.", prompt)
        self.assertEqual(g.build_prompt(CFG, "02-road", {}), "STYLE. A wagon on a hill road.")

    # Review F7: a billed response without an image still costs money.
    def test_billed_no_image_response_is_logged(self):
        fake = FakeCall([no_image(0.25), image(0.5)])
        result, _ = self.run_gen(fake)
        self.assertEqual(result, "ok")
        costs = [json.loads(l)["cost"] for l in self.log.read_text().splitlines()]
        self.assertEqual(costs, [0.25, 0.5])
        self.assertAlmostEqual(g.spent(self.log), 0.75)

    # Review F7: the budget is checked before every call, not once per scene.
    def test_budget_is_checked_before_each_call(self):
        fake = FakeCall([no_image(0.6), no_image(0.6), image(0.6)])
        result, out = self.run_gen(fake, budget=1.0)
        self.assertEqual(len(fake.calls), 2, fake.calls)
        self.assertEqual(result, "budget")
        self.assertIn("BUDGET REACHED", out)
        self.assertLessEqual(g.spent(self.log), 1.2)

    def test_image_is_written_and_counted(self):
        fake = FakeCall([image(0.1)])
        result, out = self.run_gen(fake)
        self.assertEqual(result, "ok")
        self.assertTrue((self.dir / "02-road-a1.png").exists())
        self.assertIn("02-road\t1\t", (self.dir / "gens.log").read_text())
        self.assertNotIn("k", [c[2] for c in fake.calls])  # the key goes to call(), never into the prompt


if __name__ == "__main__":
    unittest.main()
