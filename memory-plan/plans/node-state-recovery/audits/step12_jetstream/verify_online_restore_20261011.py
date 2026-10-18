#!/usr/bin/env python3
import hashlib
import json
import sys
from pathlib import Path


ROOT = Path(sys.argv[1])
EXPECTED = {
    "acceptance": "bbdd1d904aeca7ddd5540496536b01987a53d39bd833c21484dae62a5fcd2630",
    "standalone": "cc5f57ace2b2e01b8689e999665f9c40c80a1a7d9367a4038691328644487339",
    "cluster": "ac3b0d124b0321088618f3689ef4ecfeef57d1ff85b76e983efb2c062cf4bd2d",
}
PATHS = {
    "acceptance": ROOT / "isolated-restore" / "acceptance.json",
    "standalone": ROOT / "standalone-direct-baseline" / "FAILED.json",
    "cluster": ROOT / "cluster-direct-baseline" / "manifest.json",
}


def load(name):
    raw = PATHS[name].read_bytes()
    assert hashlib.sha256(raw).hexdigest() == EXPECTED[name], name
    return json.loads(raw)


accepted = load("acceptance")
assert accepted["mastersUnchanged"] and accepted["allOwnedServersStopped"]
standalone = load("standalone")["partial"]
cluster = load("cluster")
assert standalone["expectedServer"] == {
    "name": "openclaw-nats-moltymacs-virtual-machine",
    "id": "NA3XSMGHZUCV67HKLNPY2TKEYMSH6GAMFXZ2TGBRSPN3BFQY27SYMJNQ",
    "cluster": "-",
}
assert cluster["expectedServer"] == {
    "name": "openclaw-nats-2",
    "id": "NBF7ZCLJ5JF6GBDTFVLWWJYY2NGH4CKR42U7MCQKGBGJDFV4P7LKLT6Q",
    "cluster": "openclaw-cluster",
}
direct = {"standalone": standalone, "cluster": cluster}
matched = {}
for report in accepted["reports"]:
    name = report["history"]
    assert name in direct and name not in matched
    snapshots = {row["stream"]: row["snapshot"] for row in direct[name]["streams"] if "snapshot" in row}
    matching = []
    for row in report["streams"]:
        if row.get("ttl"):
            continue
        assert row["content"] == snapshots[row["stream"]]["content"], (name, row["stream"])
        matching.append(row["stream"])
    matched[name] = matching
assert len(matched["standalone"]) == 6
assert len(matched["cluster"]) == 3
print(json.dumps({"content_objects_matched": 9, "streams": matched}, sort_keys=True))
