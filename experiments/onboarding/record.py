"""Local experiment receipts; no telemetry or automatic conversion-success claim."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main() -> int:
    # Console rendering must not change the recorded child exit status. Keep the
    # original UTF-8 log intact, escaping only characters the terminal cannot print.
    sys.stdout.reconfigure(errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--backend-mode", choices=["fresh-import", "snapshot-restore"], default="fresh-import")
    parser.add_argument("--snapshot")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--cwd", type=Path)
    parser.add_argument("--note", default="")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not args.run or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for c in args.run):
        parser.error("run must contain only letters, digits, hyphens and underscores")
    if args.backend_mode == "snapshot-restore" and not args.snapshot:
        parser.error("snapshot-restore requires --snapshot identity")
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("provide a command after --")
    run = ROOT / ".local" / args.run
    run.mkdir(parents=True, exist_ok=True)
    secret_values = []
    env_file = ROOT / ".local" / "stack.env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition("=")
            if any(word in key for word in ["PASSWORD", "KEY", "SALT"]) and value:
                secret_values.append(value)
    # Never pass credentials as arguments. Environment values are not recorded.
    for key, value in os.environ.items():
        if len(value) >= 8 and any(word in key.upper() for word in ["TOKEN", "PASSWORD", "SECRET", "API_KEY"]):
            secret_values.append(value)

    def redact(text: str) -> str:
        for value in secret_values:
            text = text.replace(value, "[REDACTED]")
        return text

    started = dt.datetime.now(dt.timezone.utc).isoformat()
    clock = time.monotonic()
    try:
        process = subprocess.Popen(
            command, cwd=args.cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", start_new_session=os.name != "nt",
        )
        try:
            output, _ = process.communicate(timeout=args.timeout)
            code = process.returncode
            status = "passed" if code == 0 else "failed"
        except subprocess.TimeoutExpired:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=15)
            else:
                import signal
                os.killpg(process.pid, signal.SIGKILL)
            output, _ = process.communicate(timeout=15)
            status, code = "timed-out", 124
            output += "\nCommand exceeded the configured time budget; its process tree was stopped."
    except OSError as exc:
        status, code, output = "failed", 127, str(exc)
    elapsed = round(time.monotonic() - clock, 3)
    output = redact(output)
    attempt_id = str(uuid.uuid4())
    log = run / f"{attempt_id}.log"
    log.write_text(output, encoding="utf-8")
    receipt = {
        "schemaVersion": 1,
        "runId": args.run,
        "attemptId": attempt_id,
        "stage": args.stage,
        "backendMode": args.backend_mode,
        "snapshotId": args.snapshot,
        "startedAt": started,
        "elapsedSeconds": elapsed,
        "timeoutSeconds": args.timeout,
        "status": status,
        "statusMeaning": "command-exit-only; inspect domain outcome separately",
        "exitCode": code,
        "command": [redact(x) for x in command],
        "workingDirectory": str(args.cwd) if args.cwd else None,
        "outputSha256": hashlib.sha256(output.encode()).hexdigest(),
        "log": log.name,
        "note": redact(args.note),
        "modelTokens": None,
        "modelCost": None,
        "modelMeteringStatus": "unavailable-in-this-session",
        "conversionComplete": False,
    }
    # Per-attempt files cannot overwrite prior failures. One operator writes a run.
    (run / f"{attempt_id}.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: receipt[k] for k in ["runId", "stage", "status", "elapsedSeconds", "exitCode"]}))
    print(output[-4000:])
    return code


if __name__ == "__main__":
    raise SystemExit(main())
