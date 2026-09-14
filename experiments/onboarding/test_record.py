"""Small local recorder checks; do not exercise production migration clients."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
import uuid

ROOT = Path(__file__).resolve().parent

class RecorderTests(unittest.TestCase):
    def invoke(self, code, timeout=5, extra=None):
        run = "test-" + uuid.uuid4().hex
        env = {**os.environ, **(extra or {})}
        process = subprocess.run([sys.executable, str(ROOT / "record.py"), "--run", run,
            "--stage", "recorder-test", "--timeout", str(timeout), "--", sys.executable,
            "-c", code], capture_output=True, text=True, timeout=20, env=env)
        receipt = json.loads(next((ROOT / ".local" / run).glob("*.json")).read_text())
        output = (ROOT / ".local" / run / receipt["log"]).read_text(encoding="utf-8")
        return process, receipt, output

    def test_exit_status_is_not_conversion_success_and_secrets_are_redacted(self):
        process, receipt, output = self.invoke("import os;print(os.environ['ONBOARDING_TEST_API_KEY'])",
            extra={"ONBOARDING_TEST_API_KEY": "test-private-value-90210"})
        self.assertEqual(process.returncode, 0)
        self.assertFalse(receipt["conversionComplete"])
        self.assertIn("command-exit-only", receipt["statusMeaning"])
        self.assertNotIn("test-private-value-90210", output + process.stdout)
        self.assertIn("[REDACTED]", output)

    def test_failure_is_preserved(self):
        process, receipt, _ = self.invoke("raise SystemExit(7)")
        self.assertEqual(process.returncode, 7)
        self.assertEqual(receipt["status"], "failed")

    def test_unicode_output_preserves_exit_code_on_legacy_console(self):
        for code in (0, 7):
            process, receipt, output = self.invoke(
                f"import sys;sys.stdout.buffer.write('\\u2502\\U0001f5fa'.encode('utf-8'));sys.exit({code})",
                extra={"PYTHONIOENCODING": "cp1252:strict"},
            )
            self.assertEqual(process.returncode, code)
            self.assertEqual(receipt["exitCode"], code)
            self.assertEqual(output, "\u2502\U0001f5fa")
            self.assertNotIn("Traceback", process.stderr)

    def test_timeout_stops_nested_process_holding_output_pipe(self):
        process, receipt, _ = self.invoke("import subprocess,sys,time;subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)']);time.sleep(30)", timeout=1)
        self.assertNotEqual(process.returncode, 0)
        self.assertEqual(receipt["status"], "timed-out")
        self.assertLess(receipt["elapsedSeconds"], 8)

    def test_restore_requires_snapshot_identity(self):
        process = subprocess.run([sys.executable,str(ROOT / "record.py"),"--run","test-invalid",
            "--stage","test","--backend-mode","snapshot-restore","--",sys.executable,"-c","pass"],
            capture_output=True, text=True)
        self.assertNotEqual(process.returncode,0)
        self.assertIn("requires --snapshot", process.stderr)

if __name__ == "__main__":
    unittest.main()
