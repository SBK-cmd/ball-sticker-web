# Mobile cut beta implementation

User authorized implementing the pictured workflow and releasing SignTools beta for Ball only (not stable/customers).

Architecture: existing SignTools Worker D1 stores paired owner desktop/mobile sessions, a metadata-only catalog, and one-at-a-time expiring commands. No cut geometry, disk path, machine IP or license credential in paper QR. Desktop explicitly enables reception and polls while open. Paper QR points to /cut?job=id on the canonical SignTools worker; mobile chooses file/sheet and machine explicitly, verifies material readiness and confirms. The existing app job remains reachable by link.

Files: worker remote-cut.mjs (DB/API), mobile-cut-page.mjs (HTML), index.js auth/routes; panel remote-cut.js (reception/journal), core.js (authenticated API, SHA/journal), queue.js (sheet snapshot catalog/execute), cut.js (configured machine access/mark requirement), host.jsx (active-sheet QR metadata). Version advances to 1.13.53.

Tasks: (1) Worker storage/auth/idempotency tests RED→GREEN. (2) Desktop catalog and at-most-once dispatcher tests, QR/deep-link update and existing QR suite. (3) Mobile UI with pair/explicit selection and confirmations, offline end-to-end tests. (4) Review, build, attempt owner-only beta publication using existing release infrastructure; do not claim publication or physical testing without evidence.

Guards: backend independently verifies active nonexpired AI license, matching desktop, owner phone, beta membership, queue/cut tool permissions. Pairing is short-lived single-use random capability (fragment only); mobile session HttpOnly Secure same-origin cookie. No Origin on desktop is valid; mobile mutations require exact Origin+JSON. Command claim conditional/atomic, stale catalog/config/files rejected, no automatic resend on uncertainty, local durable journal before sending, panel reception disabled by default and on restart. Busy host admits one outstanding command. Pair is scoped to one desktop. Unlink/change file invalidates old publication. Saved full-sheet snapshot requires QR job/sheet matching and readable unchanged disk mtime. Remote requires supported marks.

Limits: 100 published files, 32 local machines, 2 MB JSON body, <=60 KB raster thumbnail, 30 s online lease, 30 s command lifetime, 5 min pairing, 12 h mobile session, 1 h desktop armed window. Poll every 3 s only when explicitly enabled.

Unverified until real shop test: Illustrator/CEP execution, printed scan, Graphtec mark read, LAN/cutter readiness. No physical cutting from this cloud environment.

## Verified result
- 20 tests pass, including actual Worker authorization with signed ephemeral test licenses (Ball only, AI product, active status, bound machine, current expiry, beta list, queue/cut tools).
- Browser E2E passes: real relay SQLite + mobile pairing/readiness/confirmation + dispatcher + fake cutter. Reload/duplicate request never resends.
- Actual panel preset compiler tested with fake TCP; changed Overcut invalidates old preset hash.
- Queue integration browser test captures and archives multiple artboards per file, rejects mtime mutation during acquisition, and removes unlinked files from remote catalog.
- Async startup race reproduced then fixed using ST_queueReady before mount.
- Snapshot race fixed: one host call captures saved document identity, artboard, geometry/marks/thumbnail; disk mtime checked before/after; only scanVerified snapshots can publish.
- Syntax/diff checks pass, Worker dry-run build passes, ZIP CRC and included scripts compared byte-for-byte.
- Worker code pushed to signtools-worker at fe3741a. Cloudflare deployment still needs HTTP verification. SignTools ZIP built as 1.13.53; registering the beta release still requires authorized admin session.
- No actual cutter command sent. Illustrator/CEP, print/RIP, camera QR and Graphtec remain manual beta checks.
