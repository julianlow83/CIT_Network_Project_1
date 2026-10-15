from __future__ import annotations

import asyncio
import json
import time
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
FIXTURE = json.loads((ROOT / "mock_catalog.json").read_text(encoding="utf-8"))

app = FastAPI(title="SDDC Mock API", version="2.0-prototype")
app.mount("/static", StaticFiles(directory=STATIC), name="static")

def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

catalog = {x["test_id"]: x for x in FIXTURE["tests"]}
devices = deepcopy(FIXTURE["devices"])
results = {x["test_id"]: deepcopy(x) for x in FIXTURE["results"]}
runs: dict[str, dict[str, Any]] = {}

class RunRequest(BaseModel):
    test_ids: list[str]
    on_fail: str = "continue"
    on_error: str = "continue"

class ManualResultRequest(BaseModel):
    test_id: str
    manual_id: str
    result: str
    operator_notes: str = ""
    operator: str = "operator"

async def emit(run: dict[str, Any], event: dict[str, Any]) -> None:
    event.setdefault("ts", now_iso())
    run["events"].append(event)
    async with run["condition"]:
        run["condition"].notify_all()

async def finish_result(run: dict[str, Any], result: dict[str, Any], start_ms: int) -> str:
    result["finished_at"] = now_iso()
    result["duration_ms"] = int(time.monotonic() * 1000) - start_ms
    result["raw_output"] = "\n\n".join(
        f"{x['device']}> {x['command']}\n{x.get('output','')}".rstrip()
        for x in result["command_results"]
    )
    results[result["test_id"]] = deepcopy(result)
    await emit(run, {"type": "test.finished", "run_id": run["run_id"], "test_id": result["test_id"], "status": result["status"], "result": deepcopy(result)})
    return result["status"]

def mock_output(test_id: str, device: str, command: str) -> str:
    if test_id == "NTP-01":
        return "Clock is unsynchronized, stratum 16, no reference clock\nsystem poll interval is 64"
    if test_id == "PORTSEC-01":
        return "Port Status : Secure-up\nMaximum MAC Addresses : 3\nSticky MAC Addresses : 3\nSecurity Violation Count : 0"
    return f"MOCK OUTPUT ONLY - not live network evidence.\n{device}> {command}\nCommand completed successfully."

async def run_test(run: dict[str, Any], test: dict[str, Any]) -> str:
    started = now_iso()
    start_ms = int(time.monotonic() * 1000)
    result = {
        "test_id": test["test_id"], "name": test["name"], "category": test["category"],
        "sources": test["sources"], "targets": test["targets"], "status": "RUNNING",
        "expected": test["expected"], "observed": "Execution in progress.", "command_results": [],
        "raw_output": "", "started_at": started, "finished_at": None, "duration_ms": None, "error": None,
    }
    results[test["test_id"]] = deepcopy(result)
    await emit(run, {"type": "test.started", "run_id": run["run_id"], "test_id": test["test_id"], "result": deepcopy(result)})

    for step_index, step in enumerate(test["steps"]):
        if run["cancelled"]:
            result["status"] = "ERROR"; result["error"] = "Run cancelled."; result["observed"] = "Operator cancelled the run."
            return await finish_result(run, result, start_ms)

        if step["kind"] == "manual":
            manual_id = f"{run['run_id']}:{test['test_id']}:{step_index}"
            future = asyncio.get_running_loop().create_future()
            run["manual_future"] = future
            run["manual_id"] = manual_id
            await emit(run, {
                "type": "manual.required", "run_id": run["run_id"], "test_id": test["test_id"],
                "manual_id": manual_id, "purpose": step["purpose"], "instructions": step["instructions"],
                "execution_location": "LOCAL on WS-SYD" if step["purpose"] == "verdict" else "Operator action in the lab",
                "expected": test["expected"],
            })
            response = await future
            run["manual_future"] = None; run["manual_id"] = None
            cr = {
                "device": step.get("device", "OPERATOR"), "command": step["instructions"], "kind": "manual",
                "output": response.get("operator_notes", ""), "exit_status": None,
                "success": response["result"] != "CANCEL",
                "error": "Operator cancelled manual step." if response["result"] == "CANCEL" else None,
                "started_at": now_iso(), "finished_at": now_iso(), "duration_ms": 0,
            }
            result["command_results"].append(cr)
            await emit(run, {"type": "command.finished", "run_id": run["run_id"], "test_id": test["test_id"], "result": deepcopy(cr)})
            if response["result"] == "CANCEL":
                result["status"] = "ERROR"; result["error"] = "Required manual step was cancelled."; result["observed"] = response.get("operator_notes") or "Operator cancelled manual step."
                return await finish_result(run, result, start_ms)
            if step["purpose"] == "verdict":
                result["status"] = "PASS" if response["result"] == "PASS" else "FAIL"
                result["observed"] = response.get("operator_notes") or f"Operator confirmed {response['result']}."
                return await finish_result(run, result, start_ms)
            continue

        cr_start = now_iso()
        await emit(run, {"type": "command.started", "run_id": run["run_id"], "test_id": test["test_id"], "device": step["device"], "command": step["command"], "shell": step.get("shell")})
        await asyncio.sleep(0.4)
        if test["test_id"] == "DHCP-01" and not result["command_results"]:
            cr = {"device": step["device"], "command": step["command"], "kind": "ssh", "output": "", "exit_status": None, "success": False, "error": "MOCK ERROR: endpoint unreachable", "started_at": cr_start, "finished_at": now_iso(), "duration_ms": 400}
            result["command_results"].append(cr)
            await emit(run, {"type": "command.finished", "run_id": run["run_id"], "test_id": test["test_id"], "result": deepcopy(cr)})
            result["status"] = "ERROR"; result["error"] = "MOCK ERROR: WS-SYD endpoint unavailable during command execution."; result["observed"] = "Mock execution could not reach the endpoint; network behaviour was not evaluated."
            return await finish_result(run, result, start_ms)
        output = mock_output(test["test_id"], step["device"], step["command"])
        await emit(run, {"type": "command.output", "run_id": run["run_id"], "test_id": test["test_id"], "device": step["device"], "chunk": output})
        cr = {"device": step["device"], "command": step["command"], "kind": "ssh", "output": output, "exit_status": 0, "success": True, "error": None, "started_at": cr_start, "finished_at": now_iso(), "duration_ms": 400}
        result["command_results"].append(cr)
        await emit(run, {"type": "command.finished", "run_id": run["run_id"], "test_id": test["test_id"], "result": deepcopy(cr)})

    if test["test_id"] == "NTP-01":
        result["status"] = "FAIL"; result["observed"] = "Clock synchronized=False; reference 10.10.4.10 present=False."
    else:
        result["status"] = "PASS"; result["observed"] = "Mock execution completed and matched the configured expected behaviour."
    return await finish_result(run, result, start_ms)

async def run_queue(run: dict[str, Any]) -> None:
    completed = []
    for idx, test_id in enumerate(run["test_ids"], start=1):
        if run["cancelled"]: break
        run["current"] = test_id
        await emit(run, {"type": "batch.progress", "run_id": run["run_id"], "index": idx, "total": len(run["test_ids"]), "test_id": test_id})
        status = await run_test(run, catalog[test_id])
        completed.append({"test_id": test_id, "status": status})
        if status == "FAIL" and run["on_fail"] == "stop": break
        if status == "ERROR" and run["on_error"] == "stop": break
    run["completed"] = completed; run["current"] = None; run["state"] = "CANCELLED" if run["cancelled"] else "FINISHED"
    summary = {"pass": sum(x["status"] == "PASS" for x in completed), "fail": sum(x["status"] == "FAIL" for x in completed), "error": sum(x["status"] == "ERROR" for x in completed)}
    await emit(run, {"type": "run.finished", "run_id": run["run_id"], "state": run["state"], "summary": summary})

@app.get("/")
async def root():
    return FileResponse(STATIC / "index.html")

@app.get("/api/health")
async def health():
    return {"status": "ok", "engine_version": "prototype-v2", "adapter": "mock"}

@app.get("/api/devices")
async def get_devices(): return devices

@app.post("/api/devices/refresh")
async def refresh_devices():
    for d in devices: d["status"] = "CONNECTED"; d["last_checked"] = now_iso()
    return {"devices": devices}

@app.get("/api/tests")
async def get_tests(): return list(catalog.values())

@app.get("/api/tests/{test_id}")
async def get_test(test_id: str):
    if test_id not in catalog: raise HTTPException(404, f"Unknown test '{test_id}'.")
    return catalog[test_id]

@app.get("/api/results")
async def get_results(): return list(results.values())

@app.get("/api/results/{test_id}")
async def get_result(test_id: str):
    if test_id not in results: raise HTTPException(404, f"Unknown test '{test_id}'.")
    return results[test_id]

@app.post("/api/runs", status_code=202)
async def create_run(req: RunRequest):
    if not req.test_ids: raise HTTPException(400, "test_ids must not be empty")
    unknown = [x for x in req.test_ids if x not in catalog]
    if unknown: raise HTTPException(400, f"Unknown tests: {', '.join(unknown)}")
    run_id = uuid.uuid4().hex[:12]
    run = {"run_id": run_id, "test_ids": req.test_ids, "state": "RUNNING", "current": None, "completed": [], "on_fail": req.on_fail, "on_error": req.on_error, "cancelled": False, "events": [], "condition": asyncio.Condition(), "manual_future": None, "manual_id": None}
    runs[run_id] = run
    await emit(run, {"type": "run.started", "run_id": run_id, "test_ids": req.test_ids})
    asyncio.create_task(run_queue(run))
    return {"run_id": run_id}

@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    run = runs.get(run_id)
    if not run: raise HTTPException(404, "Unknown run")
    return {k: v for k, v in run.items() if k not in {"condition", "manual_future", "events"}}

@app.post("/api/runs/{run_id}/cancel", status_code=202)
async def cancel_run(run_id: str):
    run = runs.get(run_id)
    if not run: raise HTTPException(404, "Unknown run")
    run["cancelled"] = True
    fut = run.get("manual_future")
    if fut and not fut.done(): fut.set_result({"result": "CANCEL", "operator_notes": "Run cancelled."})
    return {"ok": True}

@app.post("/api/runs/{run_id}/manual-result")
async def manual_result(run_id: str, req: ManualResultRequest):
    run = runs.get(run_id)
    if not run: raise HTTPException(404, "Unknown run")
    if req.manual_id != run.get("manual_id"): raise HTTPException(409, "That manual step is not currently pending")
    fut = run.get("manual_future")
    if not fut or fut.done(): raise HTTPException(409, "No manual step is currently pending")
    fut.set_result(req.model_dump())
    return {"ok": True}

@app.get("/api/events")
async def events(run_id: str):
    run = runs.get(run_id)
    if not run: raise HTTPException(404, "Unknown run")
    async def stream():
        index = 0
        while True:
            while index < len(run["events"]):
                event = run["events"][index]; index += 1
                yield f"data: {json.dumps(event)}\n\n"
            if run["state"] in {"FINISHED", "CANCELLED"} and index >= len(run["events"]): break
            async with run["condition"]:
                try: await asyncio.wait_for(run["condition"].wait(), timeout=12)
                except asyncio.TimeoutError: yield ": keepalive\n\n"
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

# Serve the standalone UI and its relative assets at the site root.
# This mount is intentionally registered after the /api routes above.
app.mount("/", StaticFiles(directory=STATIC, html=True), name="ui-root")
