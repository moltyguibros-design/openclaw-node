# B5-macOS-access — 2026-10-19 15:53–16:02 EDT

This bounded host-shell assessment refreshes the October 13 access warning.
It is resource and VM metadata evidence only, not authorization to provision,
boot, stop or rehearse on a machine. The local Codex system is a guest; the
figures below come from its separate production host.

| Observation | Result |
|---|---|
| Host Data-volume free space | 33.497 GiB, versus about 42 GiB in the October 13 observation |
| Space above the required 20 GiB capture floor | 13.497 GiB before installer, test disk and production-image growth margin |
| Physical memory | 64 GiB |
| Production configured memory | 20,000 MiB (19.531 GiB) |
| Production image-holder RSS | Two snapshots: 17.841 and 22.900 GiB; these are process RSS, not a guaranteed guest reserve or host available-memory measurement |
| Physical UTM bundles | Production macOS and the stopped 1,024 MiB Alpine guard fixture; no separate disposable macOS bundle observed |
| UTM registrations | Production started, two guard-named registrations stopped; the additional registration does not establish another physical machine or its suitability |
| Mounted external disk capacity | No external `/Volumes/` disk mount observed in the bounded capacity query |
| Existing installer | No macOS installer in `/Applications` or the host account's top-level Downloads directory |
| Official installer metadata | `VZMacOSRestoreImage.fetchLatestSupported` returned VZErrorDomain 10001: restore image catalog failed to load. Availability, image size and supported minimum configuration remain unverified |

The official [Apple metadata API](https://developer.apple.com/documentation/virtualization/vzmacosrestoreimage/latestsupported)
was queried without downloading a restore image or constructing a VM. An initial
assessment script had a Swift string-escaping error; the corrected metadata-only
query reached the API and returned the catalog error above. Its temporary compiler
cache was removed in both attempts.

Each host-query step checked production state, image metadata identity and holder
before and after. Production stayed started, the image device/inode stayed
16777233/17966030, and the holder stayed PID8509. Logical image size was
211267092480 bytes and allocated size 211261108224 bytes throughout these checks.
Image contents and VM configuration were not modified or used for a fixture.
Unchanged allocation over this short interval is not a future growth bound;
a defensible production-image growth margin remains to be measured before any
resource proposal is admitted. No current installation pin is inferred from an
older device number; B3 pins remain just-in-time.

**Owner and unblock:** the operator must designate an exact existing macOS
machine disposable, or decide a fixed disk/memory budget and capacity source for
a new isolated macOS guest after installer availability, growth allowance and
production memory reserve are established. Running a second macOS guest on the
production host requires that same resource decision. No such decision is
recorded by this assessment. D62 reboot/login/process/hold/D175 rehearsal and B5
closure remain held; independent owned source work can continue.
