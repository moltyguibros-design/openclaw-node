"""Review tool: run the real-JournaledHold checkpoint control on Linux with a simulated observer.

Usage: python3 facade_on_linux.py <tree>/memory-plan/plans/node-state-recovery/audits/step12_jetstream

The control (test_capture_checkpoint_facade.py) is macOS-native: on Linux the real ClosedGate has
no kernel file watch, so forward work must refuse. This runner first proves that refusal
unshimmed, then replaces ONLY the gate's kernel event source (an always-quiet kqueue) and maps
F_FULLFSYNC to a harmless fcntl. The gate, hold, journal, checkpoint, commit(),
commit_checkpoint(), capture worker publication, host_match() and frozen verifier stay real;
the control's own host VM stand-ins (drive_capture_worker) are unchanged. Native macOS CI
remains the gate for this control.
"""
import fcntl
import pathlib
import sys
import types
import unittest

step = pathlib.Path(sys.argv[1])
sys.path.insert(0, str(step))
import test_capture_checkpoint_facade as module  # noqa: E402

gate = module.gate_module


class Shimmed(module.RealFacadeCheckpoint):
    __unittest_skip__ = False


def run(label):
    case = Shimmed('exercise')
    result = unittest.TestResult()
    case.run(result)
    problems = result.errors + result.failures
    print(label, 'OK' if not problems else problems[0][1].strip().splitlines()[-1])
    return problems


# 1. Unshimmed: the real ClosedGate reports kernel_file_watch False on Linux, so forward work refuses.
problems = run('unshimmed (expect native-observer refusal):')
assert problems and 'original native closed observer' in problems[0][1], problems


# 2. Shimmed kernel event source only.
class QuietQueue:
    def control(self, changes, max_events, timeout=None):
        return []

    def close(self):
        pass


gate.select = types.SimpleNamespace(kqueue=QuietQueue, kevent=lambda *a, **k: (a, k),
                                    KQ_FILTER_VNODE=-4, KQ_EV_ADD=1, KQ_EV_CLEAR=0x20,
                                    KQ_EV_ERROR=0x4000, KQ_EV_EOF=0x8000)
gate.sys = types.SimpleNamespace(**{k: getattr(sys, k) for k in dir(sys) if not k.startswith('__')})
gate.sys.platform = 'darwin'
gate.fcntl = types.SimpleNamespace(**{k: getattr(fcntl, k) for k in dir(fcntl) if not k.startswith('__')})
gate.fcntl.F_FULLFSYNC = fcntl.F_GETFD
problems = run('shimmed kqueue (expect real-facade checkpoint committed, pinned, matched and verified):')
sys.exit(1 if problems else 0)
