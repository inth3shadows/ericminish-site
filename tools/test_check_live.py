"""Tests for tools/check-live.py. Run: python3 -m unittest tools/test_check_live.py"""
import contextlib, datetime as dt, importlib.util, io, os, pathlib, tempfile, unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("check_live", pathlib.Path(__file__).with_name("check-live.py"))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

SHA = "b554ddf" + "0" * 33
NOW = dt.datetime(2026, 11, 17, 15, 0, tzinfo=dt.timezone.utc)  # 10:00 Detroit


def build(when="2026-11-17T11:21:27Z", sha=SHA):
    return f"commit {sha}\ndeployed {when}\n"


class Problems(unittest.TestCase):
    def test_todays_deploy_is_fine(self):
        self.assertEqual(c.problems(build(), None, NOW), [])

    def test_missed_day_is_reported(self):
        self.assertEqual(c.problems(build("2026-11-16T13:00:00Z"), None, NOW), [])  # 26h: still fine
        found = c.problems(build("2026-11-16T11:21:27Z"), None, NOW)
        self.assertEqual(len(found), 1)
        self.assertIn("28h ago", found[0])
        self.assertIn("b554ddf", found[0])

    def test_fetch_failure_is_reported(self):
        found = c.problems(None, "HTTPError: HTTP Error 404: Not Found", NOW)
        self.assertIn("404", found[0])

    def test_html_instead_of_build_txt_is_reported(self):
        self.assertIn("malformed", c.problems("<!doctype html><title>x</title>", None, NOW)[0])

    def test_naive_time_is_malformed(self):
        self.assertIn("timezone", c.problems(build("2026-11-17T11:21:27"), None, NOW)[0])

    def test_short_sha_is_malformed(self):
        self.assertIn("malformed", c.problems(build(sha="b554ddf"), None, NOW)[0])


class Fetch(unittest.TestCase):
    def test_a_passing_blip_is_retried(self):
        ok = mock.MagicMock()
        ok.__enter__.return_value.read.return_value = build().encode()
        with mock.patch.object(c.urllib.request, "urlopen", side_effect=[OSError("reset"), ok]), \
                mock.patch.object(c.time, "sleep") as slept:
            self.assertEqual(c.fetch(), (build(), None))
        self.assertEqual(slept.call_count, 1)

    def test_gives_up_after_three_tries(self):
        with mock.patch.object(c.urllib.request, "urlopen", side_effect=OSError("down")) as op, \
                mock.patch.object(c.time, "sleep"):
            body, error = c.fetch()
        self.assertEqual((body, op.call_count), (None, 3))
        self.assertIn("down", error)


class Main(unittest.TestCase):
    """main() with the site, systemd and the clock faked."""

    def setUp(self):
        d = tempfile.mkdtemp()
        self.state = os.path.join(d, "sub", "sent")
        self.patches = [mock.patch.object(c, "STATE", self.state),
                        mock.patch.object(c, "run", return_value="inactive\n")]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def go(self, body, send_out="SENT x\n", uptime="99999.0 1.0", argv=("--send", "mailer --send-only --subject"),
           send_raises=None):
        real_open = open

        def fake_open(path, *a, **k):
            return mock.mock_open(read_data=uptime)() if path == "/proc/uptime" else real_open(path, *a, **k)

        sent = mock.Mock(return_value=mock.Mock(stdout=send_out), side_effect=send_raises)
        with mock.patch.object(c, "fetch", return_value=(body, None if body else "URLError")), \
                mock.patch("builtins.open", side_effect=fake_open), \
                mock.patch.object(c.subprocess, "run", sent), \
                contextlib.redirect_stdout(io.StringIO()):
            code = c.main(list(argv))
        return code, sent

    def test_ok_sends_nothing(self):
        code, sent = self.go(build(dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")))
        self.assertEqual((code, sent.call_count), (0, 0))

    def test_problem_sends_once_per_day(self):
        code, sent = self.go(None)
        self.assertEqual(code, 0)
        self.assertEqual(sent.call_args.args[0][:3], ["mailer", "--send-only", "--subject"])
        self.assertIn("not current", sent.call_args.args[0][-1])
        self.assertIn("could not read", sent.call_args.kwargs["input"])
        code, sent = self.go(None)
        self.assertEqual((code, sent.call_count), (0, 0))

    def test_failed_send_records_nothing_and_fails(self):
        code, _ = self.go(None, send_out="FAILED smtp: timeout\n")
        self.assertEqual(code, 1)
        self.assertFalse(os.path.exists(self.state))

    def test_yesterdays_alert_does_not_suppress_today(self):
        os.makedirs(os.path.dirname(self.state))
        with open(self.state, "w") as f:
            f.write((dt.date.today() - dt.timedelta(days=1)).isoformat() + "\n")
        code, sent = self.go(None)
        self.assertEqual((code, sent.call_count), (0, 1))

    def test_failed_send_is_retried_by_the_next_check(self):
        self.go(None, send_out="FAILED smtp: timeout\n")
        code, sent = self.go(None)
        self.assertEqual((code, sent.call_count), (0, 1))
        self.assertTrue(os.path.exists(self.state))

    def test_missing_mail_command_fails_without_recording(self):
        code, _ = self.go(None, send_raises=FileNotFoundError("mailer"))
        self.assertEqual(code, 1)
        self.assertFalse(os.path.exists(self.state))

    def test_without_send_a_problem_exits_1_and_sends_nothing(self):
        code, sent = self.go(None, argv=())
        self.assertEqual((code, sent.call_count), (1, 0))

    def test_skips_right_after_boot(self):
        code, sent = self.go(None, uptime="60.0 1.0")
        self.assertEqual((code, sent.call_count), (0, 0))

    def test_skips_while_deploy_runs(self):
        with mock.patch.object(c, "run", return_value="activating\n"):
            code, sent = self.go(None)
        self.assertEqual((code, sent.call_count), (0, 0))

    def test_journal_secrets_are_redacted(self):
        _, body = c.compose(["x"], "SITE_TOKEN=abc123 ok\nPASSWORD: hunter2\n")
        self.assertNotIn("abc123", body)
        self.assertNotIn("hunter2", body)


if __name__ == "__main__":
    unittest.main()
