"""Consistent, read-only SQLite backup + private export. Never print contents/credentials."""
import hashlib
import json
import os
import sqlite3
import sys
from decimal import Decimal, ROUND_CEILING
from pathlib import Path

if len(sys.argv) != 4:
    raise SystemExit("Usage: python3 keepmind-legacy-snapshot.py SOURCE.db NEW_DIRECTORY IANA_TIMEZONE")
source, destination, timezone = sys.argv[1:]
os.umask(0o077)
root = Path(destination).resolve()
root.mkdir(mode=0o700)  # Refuse reuse/overwrite, including symlinks.
source_path = Path(source).resolve(strict=True)
backup = root / "legacy.sqlite"
with sqlite3.connect(source_path.as_uri() + "?mode=ro", uri=True) as src:
    with sqlite3.connect(backup) as dst:
        src.backup(dst)  # Includes committed WAL pages; does not modify source.
with sqlite3.connect(backup.as_uri() + "?mode=ro", uri=True) as db:
    db.row_factory = sqlite3.Row
    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise SystemExit("Backup failed integrity check")
    data = {table: [dict(row) for row in db.execute("SELECT * FROM " + table)]
            for table in ("agents", "teams", "skills", "memory_items", "governance_rules", "users")}
    triggers = db.execute("SELECT value FROM settings WHERE key=?", ("triggers.rules",)).fetchone()
    data["triggers"] = json.loads(triggers[0]) if triggers else []
    usage = {}
    for row in db.execute("SELECT agent_id, strftime('%Y-%m-01', started_at) AS month, COUNT(*) AS runs FROM agent_executions WHERE started_at IS NOT NULL AND agent_id IN (SELECT id FROM agents) GROUP BY agent_id, month"):
        if row["month"] is None:
            raise SystemExit("Invalid execution timestamp in source")
        usage[(row["agent_id"], row["month"])] = {"agentId": row["agent_id"], "month": row["month"], "runs": row["runs"], "cost": Decimal(0)}
    for row in db.execute("SELECT agent_id, strftime('%Y-%m-01', created_at) AS month, cost_usd FROM llm_usage WHERE agent_id IN (SELECT id FROM agents)"):
        cost = Decimal(str(row["cost_usd"]))
        if row["month"] is None or not cost.is_finite() or cost < 0:
            raise SystemExit("Invalid cost/timestamp in source")
        entry = usage.setdefault((row["agent_id"], row["month"]), {"agentId": row["agent_id"], "month": row["month"], "runs": 0, "cost": Decimal(0)})
        entry["cost"] += cost
    data["usage"] = [{"agentId": row["agentId"], "month": row["month"], "runs": row["runs"], "costNanoUsd": int((row["cost"] * 1000000000).to_integral_value(rounding=ROUND_CEILING))} for _, row in sorted(usage.items())]

data["sourceRef"] = hashlib.sha256(str(source_path).encode()).hexdigest()
data["timezone"] = timezone
(root / "legacy.json").write_text(json.dumps(data), encoding="utf-8")
(root / "integrity.json").write_text(json.dumps({"backupSha256": hashlib.sha256(backup.read_bytes()).hexdigest(),
    "sqliteIntegrity": "ok", "counts": {k: len(data[k]) for k in ("agents", "teams", "skills", "memory_items", "triggers")}}))
print("Private consistent snapshot created; source opened read-only.")
