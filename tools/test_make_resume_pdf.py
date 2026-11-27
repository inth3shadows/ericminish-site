"""Regression checks for reviewed PDF imports and the legacy PDF bytes."""
import hashlib
import importlib.util
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from unittest import mock


spec = importlib.util.spec_from_file_location(
    "make_resume_pdf", pathlib.Path(__file__).with_name("make-resume-pdf.py"))
resume = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resume)


class ResumePdfTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        patcher = mock.patch.object(resume, "ROOT", self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.directory = self.root / "resume"
        self.directory.mkdir()
        self.page = self.directory / "index.html"
        self.page.write_text(
            '<a href="/resume/eric-minish-resume-old.pdf" '
            'download="Eric-Minish-Resume.pdf">Download PDF</a>')
        (self.directory / "eric-minish-resume-old.pdf").write_bytes(b"old")
        (self.directory / "eric-minish-resume.pdf").write_bytes(b"older")
        (self.directory / "other.pdf").write_bytes(b"unrelated")

    def snapshot(self):
        return {p.name: p.read_bytes() for p in self.directory.iterdir()}

    def run_main(self, *args):
        output = StringIO()
        with mock.patch.object(sys, "argv", ["make-resume-pdf.py", *args]):
            with redirect_stdout(output):
                resume.main()
        return output.getvalue()

    def test_legacy_preserves_pdf_bytes_and_output(self):
        output = self.run_main("--legacy")
        data = (self.directory / "eric-minish-resume-44adc3e0.pdf").read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(),
                         "44adc3e0bc468cda5e0c81a7c2a6a594475c59a5780f5a8fb73d42cc6854d57a")
        self.assertEqual(output,
                         "eric-minish-resume-44adc3e0.pdf — 2 pages, 5620 bytes (link updated)\n")

    def test_import_preserves_bytes_replaces_stale_files_and_is_repeatable(self):
        source = self.root / "reviewed resume.pdf"
        data = b"%PDF-1.7\nreviewed content\x00\xff\n%%EOF\n"
        source.write_bytes(data)
        name = f"eric-minish-resume-{hashlib.sha256(data).hexdigest()[:8]}.pdf"
        with mock.patch.object(resume, "build_pdf", side_effect=AssertionError("legacy generator ran")):
            output = self.run_main("--from", str(source))
            self.assertIn("link updated", output)
            self.assertEqual((self.directory / name).read_bytes(), data)
            self.assertEqual(sorted(p.name for p in self.directory.glob("*.pdf")),
                             [name, "other.pdf"])
            self.assertEqual(self.page.read_text(),
                             f'<a href="/resume/{name}" '
                             'download="Eric-Minish-Resume.pdf">Download PDF</a>')
            before_mtimes = {p: p.stat().st_mtime_ns for p in (self.page, self.directory / name)}
            self.assertIn("link already current", self.run_main("--from", str(source)))
            self.assertEqual({p: p.stat().st_mtime_ns for p in before_mtimes}, before_mtimes)
            self.assertEqual(source.read_bytes(), data)
            self.assertEqual((self.directory / "other.pdf").read_bytes(), b"unrelated")

    def test_missing_source_leaves_published_files_untouched(self):
        before = self.snapshot()
        with self.assertRaises(FileNotFoundError):
            self.run_main("--from", "missing.pdf")
        self.assertEqual(self.snapshot(), before)

    def test_no_mode_and_conflicting_modes_exit_without_changes(self):
        before = self.snapshot()
        for args, message in [((), "required"), (("--legacy", "--from", "input.pdf"), "not allowed")]:
            with self.subTest(args=args), redirect_stderr(StringIO()) as errors:
                with self.assertRaises(SystemExit) as result:
                    self.run_main(*args)
                self.assertNotEqual(result.exception.code, 0)
                self.assertIn(message, errors.getvalue())
                self.assertEqual(self.snapshot(), before)

    def test_non_pdf_is_rejected_without_changes(self):
        source = self.root / "not-a-pdf.pdf"
        source.write_bytes(b"not a PDF\n%PDF-1.7")
        before = self.snapshot()
        with redirect_stderr(StringIO()) as errors:
            with self.assertRaises(SystemExit) as result:
                self.run_main("--from", str(source))
        self.assertNotEqual(result.exception.code, 0)
        self.assertIn("not a PDF", errors.getvalue())
        self.assertEqual(self.snapshot(), before)

    def test_runs_from_another_cwd_with_repo_relative_source(self):
        scripts = self.root / "tools"
        scripts.mkdir()
        script = scripts / "make-resume-pdf.py"
        shutil.copyfile(resume.__file__, script)
        data = b"%PDF-1.7\nreviewed content\n%%EOF\n"
        (self.root / "reviewed.pdf").write_bytes(data)
        with tempfile.TemporaryDirectory() as cwd:
            result = subprocess.run(
                [sys.executable, str(script), "--from", "reviewed.pdf"],
                cwd=cwd, capture_output=True, text=True)
            self.assertEqual(list(pathlib.Path(cwd).iterdir()), [])
        self.assertEqual(result.returncode, 0, result.stderr)
        name = f"eric-minish-resume-{hashlib.sha256(data).hexdigest()[:8]}.pdf"
        self.assertEqual((self.directory / name).read_bytes(), data)
        self.assertIn(f'/resume/{name}', self.page.read_text())
        self.assertFalse((self.directory / "eric-minish-resume-old.pdf").exists())

    def test_missing_download_link_fails_without_deleting_anything(self):
        self.page.write_text("<p>No PDF download here</p>")
        before = self.snapshot()
        with redirect_stderr(StringIO()) as errors, redirect_stdout(StringIO()) as output:
            with self.assertRaises(SystemExit) as result:
                self.run_main("--legacy")
        self.assertNotEqual(result.exception.code, 0)
        self.assertIn("no resume PDF download link", errors.getvalue())
        self.assertNotIn("already current", output.getvalue())
        self.assertEqual(self.snapshot(), before)

    def test_link_write_failure_keeps_old_and_new_pdfs(self):
        with mock.patch.object(pathlib.Path, "write_text", side_effect=OSError("write failed")):
            with self.assertRaises(OSError):
                self.run_main("--legacy")
        self.assertTrue((self.directory / "eric-minish-resume-44adc3e0.pdf").exists())
        self.assertEqual((self.directory / "eric-minish-resume-old.pdf").read_bytes(), b"old")
        self.assertEqual((self.directory / "eric-minish-resume.pdf").read_bytes(), b"older")
        self.assertIn("eric-minish-resume-old.pdf", self.page.read_text())


if __name__ == "__main__":
    unittest.main()
