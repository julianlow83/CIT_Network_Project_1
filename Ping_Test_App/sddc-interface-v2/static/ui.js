(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const state={adapter:null,health:null,devices:[],tests:[],results:new Map(),activeTestId:null,selected:new Set(),filter:'ALL',busy:false,currentRunId:null,currentRunSource:null,manual:null,batch:{index:0,total:0}};
  const filters=[['ALL','All'],['ROUTING','Routing'],['SECURITY','Security'],['SERVICES','Services'],['ACCESS','Access'],['AUTHENTICATION','Authentication'],['RESILIENCE','Resilience'],['PERFORMANCE','Performance'],['MANUAL','Manual']];
  const statusClass=s=>`status-${String(s||'NOT_RUN').toLowerCase().replaceAll('_','-')}`;
  const statusLabel=s=>String(s||'NOT_RUN').replaceAll('_',' ');
  const fmtTime=v=>v?new Date(v).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
  const fmtDuration=v=>v==null?'—':v<1000?`${v} ms`:`${(v/1000).toFixed(2)} s`;
  function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
  function addTerminal(text,type='info'){const line=el('span',`terminal-line ${type}`,text);$('terminal').appendChild(line);$('terminal').scrollTop=$('terminal').scrollHeight;}

  function currentResult(id){return state.results.get(id)||{test_id:id,status:'NOT_RUN',observed:'No result recorded.',command_results:[],error:null};}
  function getTest(id){return state.tests.find(t=>t.test_id===id);}
  function visibleTests(){
    if(state.filter==='ALL')return state.tests;
    if(state.filter==='MANUAL')return state.tests.filter(t=>t.mode==='MANUAL'||t.mode==='MANUAL_ASSISTED');
    return state.tests.filter(t=>t.filter_group===state.filter);
  }
  function setSystem(text){$('system-status-text').textContent=text;}
  function setBusy(busy){
    state.busy=busy;
    ['run-selected','run-test','select-all','clear-selection','refresh-devices','stop-on-fail','stop-on-error'].forEach(id=>{const n=$(id);if(n)n.disabled=busy;});
    document.querySelectorAll('.test-check').forEach(n=>n.disabled=busy);
  }

  function renderFilters(){
    const box=$('filters');box.replaceChildren();
    filters.forEach(([key,label])=>{const b=el('button',`filter${state.filter===key?' active':''}`,label);b.dataset.filter=key;b.setAttribute('aria-pressed',String(state.filter===key));b.addEventListener('click',()=>{if(state.busy)return;state.filter=key;renderFilters();renderTests();});box.appendChild(b);});
  }
  function renderDevices(){
    const box=$('device-list');box.replaceChildren();
    state.devices.forEach(d=>{const chip=el('div','device-chip');const dot=el('span',`status-dot ${d.status==='CONNECTED'?'connected':d.status==='UNREACHABLE'?'unreachable':'unknown'}`);const body=el('div');body.append(el('strong','',d.id));const address=d.address?`${d.host} · ${d.address}`:d.host;body.append(el('small','',`${d.role} · ${address}`));chip.append(dot,body);box.appendChild(chip);});
  }
  function renderSummary(){
    $('summary-devices').textContent=`${state.devices.filter(d=>d.status==='CONNECTED').length} / ${state.devices.length}`;
    const vals=Array.from(state.results.values());
    $('summary-pass').textContent=vals.filter(r=>r.status==='PASS').length;
    $('summary-fail').textContent=vals.filter(r=>r.status==='FAIL').length;
    $('summary-error').textContent=vals.filter(r=>r.status==='ERROR').length;
    $('summary-notrun').textContent=vals.filter(r=>r.status==='NOT_RUN').length;
  }
  function renderTests(){
    const box=$('test-list');box.replaceChildren();
    visibleTests().forEach(test=>{
      const result=currentResult(test.test_id); const row=el('div',`test-row${test.test_id===state.activeTestId?' active':''}`);row.dataset.testId=test.test_id;row.setAttribute('role','button');row.setAttribute('tabindex','0');row.setAttribute('aria-pressed',String(test.test_id===state.activeTestId));
      const check=document.createElement('input');check.type='checkbox';check.className='test-check';check.checked=state.selected.has(test.test_id);check.disabled=state.busy;check.setAttribute('aria-label',`Include ${test.test_id} in batch`);check.addEventListener('click',e=>e.stopPropagation());check.addEventListener('change',()=>{check.checked?state.selected.add(test.test_id):state.selected.delete(test.test_id);renderSelection();});
      const name=el('div','test-name');name.append(el('strong','',test.test_id),el('small','',test.name));
      const cat=el('span','category-tag',test.category_label); const mode=el('span',`mode-tag ${test.mode==='MANUAL'?'manual':test.mode==='MANUAL_ASSISTED'?'assisted':''}`,test.mode.replace('_',' ')); const badge=el('span',`status-badge ${statusClass(result.status)}`,statusLabel(result.status));
      row.append(check,name,cat,mode,badge);
      const select=()=>{if(state.manual){addTerminal(`Manual step for ${state.manual.testId} must be completed or cancelled before changing tests.`,'manual');return;}state.activeTestId=test.test_id;renderTests();renderDetail();};
      row.addEventListener('click',select);row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});box.appendChild(row);
    }); renderSelection();
  }
  function renderSelection(){$('selected-count').textContent=state.selected.size;}
  function renderDetail(){
    const test=getTest(state.activeTestId);if(!test)return;const result=currentResult(test.test_id);
    $('detail-category').textContent=test.category_label;$('detail-title').textContent=test.test_id;$('detail-name').textContent=test.name;$('detail-mode').textContent=test.mode.replace('_',' ');$('detail-sources').textContent=test.sources.join(', ')||'—';$('detail-targets').textContent=test.targets.join(', ')||'—';$('detail-executed').textContent=test.executed_on.join(', ')||'Operator only';$('detail-prerequisite').textContent=test.prerequisite||'None specified.';$('detail-expected').textContent=test.expected;$('detail-observed').textContent=result.observed||'No result recorded.';$('detail-started').textContent=fmtTime(result.started_at);$('detail-finished').textContent=fmtTime(result.finished_at);$('detail-duration').textContent=fmtDuration(result.duration_ms);
    const badge=$('detail-status');badge.textContent=statusLabel(result.status);badge.className=`status-badge ${statusClass(result.status)}`;
    if(result.error){$('detail-error').textContent=result.error;$('detail-error-wrap').classList.remove('hidden');}else $('detail-error-wrap').classList.add('hidden');
    const btn=$('run-test');btn.textContent=test.mode==='MANUAL'?'Start Manual Test':test.mode==='MANUAL_ASSISTED'?'Start Assisted Test':'Run Test';btn.disabled=state.busy;
    if(!state.manual)$('manual-panel').classList.add('hidden');renderEvidence(result);
  }
  function renderEvidence(result){
    const list=$('evidence-list');list.replaceChildren();const items=result.command_results||[];$('evidence-count').textContent=`${items.length} item${items.length===1?'':'s'}`;
    if(!items.length){list.append(el('div','evidence-empty','No command evidence recorded for this test.'));return;}
    items.forEach(item=>{const det=document.createElement('details');det.className='evidence-item';const sum=document.createElement('summary');sum.append(el('span','evidence-device',item.device),el('span','evidence-command',item.command),el('span','evidence-kind',item.kind),el('span','evidence-duration',fmtDuration(item.duration_ms)));const body=el('div','evidence-body');if(item.error)body.append(el('div','evidence-error',item.error));const pre=document.createElement('pre');pre.textContent=item.output||'(no output)';body.appendChild(pre);det.append(sum,body);list.appendChild(det);});
  }
  function showManual(event){
    state.manual={runId:event.run_id,testId:event.test_id,manualId:event.manual_id,purpose:event.purpose};state.activeTestId=event.test_id;renderTests();renderDetail();
    $('manual-title-text').textContent=event.purpose==='verdict'?'MANUAL TEST REQUIRED':'OPERATOR ACTION REQUIRED';$('manual-location').textContent=event.execution_location||'Operator action';$('manual-instructions').textContent=event.instructions;$('manual-notes').value='';const actions=$('manual-actions');actions.replaceChildren();
    if(event.purpose==='verdict'){
      const p=el('button','manual-pass','Pass');p.addEventListener('click',()=>submitManual('PASS'));const f=el('button','manual-fail','Fail');f.addEventListener('click',()=>submitManual('FAIL'));actions.append(p,f);
    }else{const c=el('button','manual-complete','Action Complete');c.addEventListener('click',()=>submitManual('COMPLETE'));actions.append(c);}
    const cancel=el('button','ghost-button','Cancel');cancel.addEventListener('click',()=>submitManual('CANCEL'));actions.append(cancel);$('manual-panel').classList.remove('hidden');$('manual-notes').focus();
  }
  async function submitManual(result){
    if(!state.manual)return;const notes=$('manual-notes').value.trim();const m=state.manual;try{await state.adapter.submitManual(m.runId,m.manualId,m.testId,result,notes);$('manual-panel').classList.add('hidden');state.manual=null;addTerminal(`[OPERATOR] ${m.testId}: ${result}${notes?` · ${notes}`:''}`,'manual');}catch(err){addTerminal(`Manual result error: ${err.message}`,'error');}
  }
  function handleEvent(ev){
    switch(ev.type){
      case 'run.started':setSystem(`RUN ${ev.run_id}`);break;
      case 'batch.progress':state.batch={index:ev.index,total:ev.total};$('batch-progress').textContent=`Running ${ev.index}/${ev.total} · ${ev.test_id}`;break;
      case 'test.started':state.results.set(ev.test_id,ev.result);state.activeTestId=ev.test_id;addTerminal(`\n=== ${ev.test_id} STARTED ===`,'info');renderAll();break;
      case 'command.started':addTerminal(`> [${ev.device}] ${ev.command}`,'command');break;
      case 'command.output':addTerminal(ev.chunk,'dim');break;
      case 'command.finished':{const r=currentResult(ev.test_id);r.command_results=r.command_results||[];r.command_results.push(ev.result);state.results.set(ev.test_id,r);if(state.activeTestId===ev.test_id)renderDetail();break;}
      case 'manual.required':addTerminal(`[PAUSE] ${ev.test_id}: operator input required.`,'manual');showManual(ev);break;
      case 'test.finished':state.results.set(ev.test_id,ev.result);addTerminal(`[${ev.status}] ${ev.test_id} · ${ev.result.observed||ev.result.error||''}`,ev.status==='PASS'?'pass':ev.status==='FAIL'?'fail':'error');renderAll();break;
      case 'devices.refreshed':state.devices=ev.devices;renderDevices();renderSummary();addTerminal('Device status refresh complete (mock data).','pass');break;
      case 'system.message':addTerminal(ev.message,'info');break;
      case 'system.error':addTerminal(ev.message,'error');break;
      case 'run.finished':setSystem('SYSTEM READY');$('batch-progress').textContent='';state.currentRunId=null;state.manual=null;setBusy(false);if(state.currentRunSource==='batch')state.selected.clear();state.currentRunSource=null;renderAll();addTerminal(`=== RUN ${ev.state} · PASS ${ev.summary.pass} / FAIL ${ev.summary.fail} / ERROR ${ev.summary.error} ===`,'info');break;
    }
  }
  function renderAll(){renderSummary();renderDevices();renderTests();renderDetail();}
  async function runTests(ids,source){
    if(state.busy||!ids.length)return;setBusy(true);state.currentRunSource=source;const policy={on_fail:$('stop-on-fail').checked?'stop':'continue',on_error:$('stop-on-error').checked?'stop':'continue'};try{const x=await state.adapter.startRun(ids,policy,handleEvent);state.currentRunId=x.run_id;}catch(err){setBusy(false);setSystem('ERROR');addTerminal(`Unable to start run: ${err.message}`,'error');}
  }
  function bind(){
    $('run-test').addEventListener('click',()=>state.activeTestId&&runTests([state.activeTestId],'single'));
    $('run-selected').addEventListener('click',()=>runTests(state.tests.filter(t=>state.selected.has(t.test_id)).map(t=>t.test_id),'batch'));
    $('select-all').addEventListener('click',()=>{if(state.busy)return;visibleTests().forEach(t=>state.selected.add(t.test_id));renderTests();});
    $('clear-selection').addEventListener('click',()=>{if(state.busy)return;state.selected.clear();renderTests();});
    $('clear-console').addEventListener('click',()=>{$('terminal').replaceChildren();addTerminal('Console cleared.','dim');});
    $('refresh-devices').addEventListener('click',async()=>{if(state.busy)return;setSystem('REFRESHING');try{state.devices=await state.adapter.refreshDevices(handleEvent);renderDevices();renderSummary();setSystem('SYSTEM READY');}catch(err){setSystem('ERROR');addTerminal(`Device refresh failed: ${err.message}`,'error');}});
  }
  async function init(){
    state.adapter=window.SDDC_API.create();bind();renderFilters();try{const data=await state.adapter.loadInitial();state.health=data.health;state.devices=data.devices;state.tests=data.tests;data.results.forEach(r=>state.results.set(r.test_id,r));state.activeTestId=state.tests[0]?.test_id||null;const isMock=data.health.adapter==='mock';$('adapter-badge').textContent=isMock?(state.adapter.kind==='api'?'MOCK SERVER':'MOCK / OFFLINE'):'LIVE ENGINE';$('footer-adapter').textContent=`Adapter: ${data.health.adapter.toUpperCase()}`;$('mock-warning').classList.toggle('hidden',!isMock);setSystem('SYSTEM READY');renderAll();addTerminal('SDDC Interface v2 initialised.','pass');addTerminal(`Adapter: ${data.health.adapter.toUpperCase()} · ${state.adapter.kind.toUpperCase()}`,'dim');}catch(err){setSystem('INITIALISATION ERROR');addTerminal(`Initialisation failed: ${err.message}`,'error');}
  }
  document.addEventListener('DOMContentLoaded',init);
})();
