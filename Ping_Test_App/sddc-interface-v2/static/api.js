(function(){
  "use strict";

  const clone = (obj) => JSON.parse(JSON.stringify(obj));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const nowIso = () => new Date().toISOString();

  class BrowserMockAdapter {
    constructor(){
      this.kind = "mock";
      this.fixture = clone(window.SDDC_FIXTURE);
      this.results = new Map(this.fixture.results.map(r => [r.test_id, r]));
      this.runs = new Map();
      this.manualWaiters = new Map();
    }
    async loadInitial(){
      return {health:this.fixture.health, devices:clone(this.fixture.devices), tests:clone(this.fixture.tests), results:Array.from(this.results.values()).map(clone)};
    }
    async refreshDevices(onEvent){
      onEvent?.({type:"system.message", message:"Refreshing mock device state..."});
      await wait(450);
      this.fixture.devices.forEach(d => {d.status="CONNECTED"; d.last_checked=nowIso();});
      onEvent?.({type:"devices.refreshed", devices:clone(this.fixture.devices)});
      return clone(this.fixture.devices);
    }
    async startRun(testIds, policy, onEvent){
      const runId = `mock-${Date.now()}`;
      const run={run_id:runId, test_ids:[...testIds], state:"RUNNING", current:null, completed:[], policy, cancelled:false, onEvent};
      this.runs.set(runId,run);
      this._emit(run,{type:"run.started",run_id:runId,test_ids:[...testIds],ts:nowIso()});
      this._drain(run);
      return {run_id:runId};
    }
    _emit(run,event){ run.onEvent?.(event); }
    async _drain(run){
      const catalog = new Map(this.fixture.tests.map(t=>[t.test_id,t]));
      for(let index=0; index<run.test_ids.length; index++){
        if(run.cancelled) break;
        const id=run.test_ids[index]; const test=catalog.get(id); run.current=id;
        this._emit(run,{type:"batch.progress",run_id:run.run_id,index:index+1,total:run.test_ids.length,test_id:id});
        const status=await this._runTest(run,test);
        run.completed.push({test_id:id,status});
        if(status==="FAIL" && run.policy.on_fail==="stop") break;
        if(status==="ERROR" && run.policy.on_error==="stop") break;
      }
      run.state=run.cancelled?"CANCELLED":"FINISHED"; run.current=null;
      const summary={pass:0,fail:0,error:0};
      run.completed.forEach(x=>{if(x.status==="PASS")summary.pass++; else if(x.status==="FAIL")summary.fail++; else if(x.status==="ERROR")summary.error++;});
      this._emit(run,{type:"run.finished",run_id:run.run_id,state:run.state,summary,ts:nowIso()});
    }
    async _runTest(run,test){
      const started=nowIso();
      const result={test_id:test.test_id,name:test.name,category:test.category,sources:test.sources,targets:test.targets,status:"RUNNING",expected:test.expected,observed:"Execution in progress.",command_results:[],raw_output:"",started_at:started,finished_at:null,duration_ms:null,error:null};
      this.results.set(test.test_id,result);
      this._emit(run,{type:"test.started",run_id:run.run_id,test_id:test.test_id,result:clone(result),ts:started});
      const startedMs=Date.now();

      for(const step of test.steps){
        if(run.cancelled) break;
        if(step.kind==="manual"){
          const manualId=`${run.run_id}:${test.test_id}:${result.command_results.length}`;
          this._emit(run,{type:"manual.required",run_id:run.run_id,test_id:test.test_id,manual_id:manualId,purpose:step.purpose,instructions:step.instructions,execution_location:step.purpose==="verdict"?"LOCAL on WS-SYD":"Operator action in the lab",expected:test.expected,ts:nowIso()});
          const response=await new Promise(resolve=>this.manualWaiters.set(manualId,resolve));
          this.manualWaiters.delete(manualId);
          const cr={device:step.device||"OPERATOR",command:step.instructions,kind:"manual",output:response.notes||"",exit_status:null,success:response.result!=="CANCEL",error:response.result==="CANCEL"?"Operator cancelled manual step.":null,started_at:nowIso(),finished_at:nowIso(),duration_ms:0};
          result.command_results.push(cr); this._emit(run,{type:"command.finished",run_id:run.run_id,test_id:test.test_id,result:clone(cr)});
          if(response.result==="CANCEL"){
            result.status="ERROR"; result.error="Required manual step was cancelled."; result.observed=response.notes||"Operator cancelled manual step."; return this._finish(run,result,startedMs);
          }
          if(step.purpose==="verdict"){
            result.status=response.result==="PASS"?"PASS":"FAIL";
            result.observed=response.notes || `Operator confirmed ${response.result}.`;
            return this._finish(run,result,startedMs);
          }
          continue;
        }

        const crStart=nowIso();
        this._emit(run,{type:"command.started",run_id:run.run_id,test_id:test.test_id,device:step.device,command:step.command,shell:step.shell||null,ts:crStart});
        await wait(260+Math.random()*260);
        if(test.test_id==="DHCP-01" && result.command_results.length===0){
          const cr={device:step.device,command:step.command,kind:"ssh",output:"",exit_status:null,success:false,error:"MOCK ERROR: endpoint unreachable",started_at:crStart,finished_at:nowIso(),duration_ms:310};
          result.command_results.push(cr); this._emit(run,{type:"command.finished",run_id:run.run_id,test_id:test.test_id,result:clone(cr)});
          result.status="ERROR"; result.error="MOCK ERROR: WS-SYD endpoint unavailable during command execution."; result.observed="Mock execution could not reach the endpoint; network behaviour was not evaluated.";
          return this._finish(run,result,startedMs);
        }
        const output=this._mockOutput(test,step);
        this._emit(run,{type:"command.output",run_id:run.run_id,test_id:test.test_id,device:step.device,chunk:output,ts:nowIso()});
        const cr={device:step.device,command:step.command,kind:"ssh",output,exit_status:0,success:true,error:null,started_at:crStart,finished_at:nowIso(),duration_ms:390};
        result.command_results.push(cr); this._emit(run,{type:"command.finished",run_id:run.run_id,test_id:test.test_id,result:clone(cr)});
      }

      if(test.test_id==="NTP-01"){
        result.status="FAIL"; result.observed="Clock synchronized=False; reference 10.10.4.10 present=False.";
      }else{
        result.status="PASS"; result.observed="Mock execution completed and matched the configured expected behaviour.";
      }
      return this._finish(run,result,startedMs);
    }
    _finish(run,result,startedMs){
      result.finished_at=nowIso(); result.duration_ms=Date.now()-startedMs;
      result.raw_output=result.command_results.map(x=>`${x.device}> ${x.command}\n${x.output||""}`.trim()).join("\n\n");
      this.results.set(result.test_id,clone(result));
      this._emit(run,{type:"test.finished",run_id:run.run_id,test_id:result.test_id,status:result.status,result:clone(result),ts:result.finished_at});
      return result.status;
    }
    _mockOutput(test,step){
      if(test.test_id==="NTP-01") return "Clock is unsynchronized, stratum 16, no reference clock\nsystem poll interval is 64";
      if(test.test_id==="PORTSEC-01") return "Port Status : Secure-up\nMaximum MAC Addresses : 3\nSticky MAC Addresses : 3\nSecurity Violation Count : 0";
      return `MOCK OUTPUT ONLY - not live network evidence.\n${step.device}> ${step.command}\nCommand completed successfully.`;
    }
    async submitManual(runId,manualId,testId,result,notes){
      const resolve=this.manualWaiters.get(manualId); if(!resolve) throw new Error("No pending manual step found.");
      resolve({result,notes}); return {ok:true};
    }
    async cancelRun(runId){ const run=this.runs.get(runId); if(run)run.cancelled=true; return {ok:true}; }
  }

  class ApiAdapter {
    constructor(){this.kind="api";this.eventSource=null;}
    async _json(url,options){const r=await fetch(url,options);if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return r.json();}
    async loadInitial(){
      const [health,devices,tests,results]=await Promise.all([
        this._json('/api/health'),this._json('/api/devices'),this._json('/api/tests'),this._json('/api/results')
      ]); return {health,devices,tests,results};
    }
    async refreshDevices(onEvent){
      const data=await this._json('/api/devices/refresh',{method:'POST'}); onEvent?.({type:'devices.refreshed',devices:data.devices}); return data.devices;
    }
    async startRun(testIds,policy,onEvent){
      const data=await this._json('/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({test_ids:testIds,on_fail:policy.on_fail,on_error:policy.on_error})});
      const es=new EventSource(`/api/events?run_id=${encodeURIComponent(data.run_id)}`); this.eventSource=es;
      es.onmessage=(ev)=>{const event=JSON.parse(ev.data);onEvent?.(event);if(event.type==='run.finished')es.close();};
      es.onerror=()=>onEvent?.({type:'system.error',message:'Event stream disconnected.'});
      return data;
    }
    async submitManual(runId,manualId,testId,result,notes){return this._json(`/api/runs/${encodeURIComponent(runId)}/manual-result`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({test_id:testId,manual_id:manualId,result,operator_notes:notes||'',operator:'operator'})});}
    async cancelRun(runId){return this._json(`/api/runs/${encodeURIComponent(runId)}/cancel`,{method:'POST'});}
  }

  window.SDDC_API={
    create(){
      const params=new URLSearchParams(location.search); const forced=params.get('adapter');
      if(location.protocol==='file:' || forced==='mock') return new BrowserMockAdapter();
      return new ApiAdapter();
    }
  };
})();
