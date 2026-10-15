# SDDC V2 API / Event Contract

V2 uses one execution model for single and batch runs.

## HTTP

- `GET /api/health`
- `GET /api/devices`
- `POST /api/devices/refresh`
- `GET /api/tests`
- `GET /api/tests/{id}`
- `GET /api/results`
- `GET /api/results/{id}`
- `POST /api/runs`
- `GET /api/runs/{run_id}`
- `POST /api/runs/{run_id}/cancel`
- `POST /api/runs/{run_id}/manual-result`
- `GET /api/events?run_id=...` (SSE)

## POST /api/runs

```json
{
  "test_ids": ["OSPF-01", "VPN-01"],
  "on_fail": "continue",
  "on_error": "continue"
}
```

Returns `202`:

```json
{"run_id":"..."}
```

## Manual semantics

### MANUAL
The operator performs the complete test locally because SDDC cannot maintain a valid control path. The operator submits `PASS`, `FAIL`, or `CANCEL`, plus optional notes/output.

### MANUAL_ASSISTED
The operator performs an action only. They submit `COMPLETE` or `CANCEL`. SDDC then continues collecting automated evidence and the evaluator decides PASS/FAIL.

## SSE event types

- `run.started`
- `batch.progress`
- `test.started`
- `command.started`
- `command.output`
- `command.finished`
- `manual.required`
- `test.finished`
- `run.finished`

Raw network output must always be inserted into the DOM using `textContent`, never `innerHTML`.
