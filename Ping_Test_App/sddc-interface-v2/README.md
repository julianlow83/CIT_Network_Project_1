# SDDC Interface Prototype v2

**CYBERDYNE SYSTEMS — SKYNET: DEADLINK Diagnostic Core**

V2 keeps the visual direction from V1 and applies the peer-review changes before live-engine integration.

## What changed in V2

- Engine statuses are now only: `NOT_RUN`, `RUNNING`, `PASS`, `FAIL`, `ERROR`.
- Test **mode** is separate: `AUTOMATED`, `MANUAL_ASSISTED`, `MANUAL`.
- Real categories are retained instead of using `MANUAL` as a category.
- All 20 current tests are represented, including `DOT1X-01-LOGGEDOUT`.
- Batch execution preserves the queue across manual pauses.
- FAIL and ERROR batch-stop policies are explicit controls.
- ERROR is a real mock state (`DHCP-01`) so the UI can be tested offline.
- Per-command evidence is displayed with device, command, kind, duration, output and error.
- Test timestamps and duration are displayed.
- Pure manual Restricted tests and manual-assisted 802.1X/EtherChannel workflows are distinct.
- Manual tests have an operator notes/output field.
- Keyboard test-row selection, focus styles, labelled checkboxes and live regions were added.
- Browser code is split into `fixtures.js`, `api.js`, and `ui.js`.
- V2 can run in two mock modes:
  1. **Standalone browser mock** by opening `static/index.html` directly.
  2. **FastAPI + SSE mock server** on localhost, which exercises the future frontend/backend boundary.

## Important

All evidence shown in mock mode is clearly marked as mock data. It is **not live network evidence**.

## Quick preview with no Python server

Open:

`static/index.html`

The interface runs using the in-browser fixture adapter.

## Full offline mock-server test

From this directory:

```bash
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Then open:

`http://127.0.0.1:8000`

This mode tests:
- HTTP API calls
- asynchronous run creation
- SSE event streaming
- PASS / FAIL / ERROR
- batch policy
- manual pause/resume
- manual-assisted pause/resume
- per-command evidence

### If FastAPI/Uvicorn are not installed on T1000

The standalone preview still works. For server mode, install the packages into the SDDC virtual environment from offline wheels transferred by USB.

Do **not** use CDN-hosted frontend dependencies. V2 has none.

## Next integration stage

The mock API execution layer is intentionally replaceable. The live server will call the existing `TestRunner` and `SSHManager`, while keeping the same API/event contract used by this interface.
