"""Tests for tools/gen-game-art.py (no network: the API call is replaced).
Run: python3 -m unittest tools/test_gen_game_art.py"""
import base64, contextlib, http.client, ssl, importlib.util, io, json, pathlib, tempfile, unittest, urllib.error

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
        r = self.responses.pop(0)
        if isinstance(r, BaseException):
            raise r
        return r


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

    # Review N4: once the request is sent, a reply that is cut off, unreadable or
    # times out may still be billed. Log it at the per-call estimate, marked
    # unknown, and stop the run (no next model).
    def assert_lost_reply_stops(self, exc):
        fake = FakeCall([exc, image(0.1)])
        result, out = self.run_gen(fake, env={"ART_CALL_ESTIMATE": "0.2"})
        self.assertEqual(result, "stopped", out)
        self.assertEqual(len(fake.calls), 1, fake.calls)
        rows = [json.loads(l) for l in self.log.read_text().splitlines()]
        self.assertEqual(len(rows), 1, rows)
        self.assertEqual(rows[0]["cost"], 0.2)
        self.assertIs(rows[0]["cost_unknown"], True)
        self.assertIs(rows[0]["image"], False)
        self.assertAlmostEqual(g.spent(self.log), 0.2)

    def test_truncated_reply_is_logged_and_stops(self):
        self.assert_lost_reply_stops(http.client.IncompleteRead(b'{"choices": [', 4000))

    def test_unparseable_reply_is_logged_and_stops(self):
        self.assert_lost_reply_stops(json.JSONDecodeError("Expecting value", "<html>", 0))

    def test_read_timeout_is_logged_and_stops(self):
        # A timeout in getresponse() or the body read reaches us unwrapped.
        self.assert_lost_reply_stops(TimeoutError("The read operation timed out"))

    # Review round 3 (N4'): any raw socket or HTTP error after sending is a lost reply.
    def test_a_reset_mid_body_is_logged_and_stops(self):
        for exc in (ConnectionResetError(104, "Connection reset by peer"), ssl.SSLEOFError(8, "EOF"),
                    BrokenPipeError(32, "Broken pipe"), http.client.BadStatusLine("garbage")):
            with self.subTest(exc=type(exc).__name__):
                self.assert_lost_reply_stops(exc)
                self.log.unlink()

    # Review round 3: urllib wraps errors from sending the request (connect, send
    # timeout) in URLError, so nothing was billed: try the next model.
    def test_a_send_timeout_is_not_billed(self):
        fake = FakeCall([urllib.error.URLError(TimeoutError("timed out")), image(0.1)])
        result, _ = self.run_gen(fake)
        self.assertEqual(result, "ok")
        self.assertEqual([json.loads(l)["cost"] for l in self.log.read_text().splitlines()], [0.1])

    # Review round 3: a ValueError raised before sending (a bad header value) is not a billed call.
    def test_a_bad_header_is_not_billed(self):
        fake = FakeCall([ValueError("Invalid header value"), image(0.1)])
        result, _ = self.run_gen(fake)
        self.assertEqual(result, "ok")
        self.assertNotIn(True, [json.loads(l).get("cost_unknown") for l in self.log.read_text().splitlines()])

    # Review round 3: a bad ART_CALL_ESTIMATE fails before any call, not inside the handler.
    def test_a_bad_estimate_fails_before_any_call(self):
        fake = FakeCall([image(0.1)])
        with self.assertRaises(SystemExit):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                g.main(["gen", str(self.dir), "02-road"], {"OPENROUTER_API_KEY": "k", "ART_COST_LOG": str(self.log),
                                                           "ART_CALL_ESTIMATE": "$0.14"}, call=fake)
        self.assertEqual(fake.calls, [])

    # Review round 3 (pre-existing): a billed 200 with an odd shape is logged before it is read.
    def test_an_odd_billed_reply_is_logged(self):
        fake = FakeCall([{"choices": [{"message": None}], "usage": {"cost": 0.138}}, image(0.1)])
        result, _ = self.run_gen(fake)
        self.assertEqual(result, "ok")
        self.assertAlmostEqual(g.spent(self.log), 0.238)

    def test_the_estimate_has_a_default(self):
        fake = FakeCall([TimeoutError("The read operation timed out")])
        result, _ = self.run_gen(fake)
        self.assertEqual(result, "stopped")
        self.assertGreater(g.spent(self.log), 0)

    def test_a_request_never_sent_is_not_billed_and_tries_the_next_model(self):
        fake = FakeCall([urllib.error.URLError(ConnectionRefusedError(111, "Connection refused")), image(0.1)])
        result, _ = self.run_gen(fake)
        self.assertEqual(result, "ok")
        self.assertEqual(len(fake.calls), 2)
        self.assertEqual([json.loads(l)["cost"] for l in self.log.read_text().splitlines()], [0.1])

    def test_main_stops_the_run_after_a_lost_reply(self):
        seen = []
        real = g.generate

        def fake_generate(sid, *a, **k):
            seen.append(sid)
            return "stopped"

        g.generate = fake_generate
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                g.main(["gen", str(self.dir), "02-road,03-canal"], {"OPENROUTER_API_KEY": "k", "ART_COST_LOG": str(self.log)})
        finally:
            g.generate = real
        self.assertEqual(seen, ["02-road"])


if __name__ == "__main__":
    unittest.main()
