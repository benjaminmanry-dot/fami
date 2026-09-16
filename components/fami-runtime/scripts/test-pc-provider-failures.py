"""Native terminal-error paths with synthetic exceptions; no network/model call."""
import json,sys
from types import SimpleNamespace
sys.path.insert(0,'/home/fami/hermes-agent')
from agent.error_classifier import classify_api_error
from agent.turn_recovery import max_retries_exhausted_result
from result_snapshot import completed_turn

persisted=[]; statuses=[]
agent=SimpleNamespace(log_prefix='fixture: ',
 _flush_status_buffer=lambda:None,_summarize_api_error=lambda e:str(e),
 _emit_status=statuses.append,_vprint=lambda *a,**kw:None,
 _persist_session=lambda m,h:persisted.append(list(m)))
rows=[]
for name, exc in [('network',ConnectionError('Network connection lost (synthetic fixture)')),
                  ('quota',RuntimeError('Rate limit exceeded (synthetic fixture)'))]:
    if name=='quota':exc.status_code=429
    classified=classify_api_error(exc,provider='openai-codex',model='gpt-6-astra',approx_tokens=10,context_length=200000,num_messages=1)
    result=max_retries_exhausted_result(agent,exc,classified,max_retries=0,is_rate_limited=name=='quota',
      error_msg=str(exc).lower(),api_kwargs=None,api_messages=[],messages=[{'role':'user','content':'fixture only'}],
      conversation_history=[],api_call_count=0,approx_tokens=10,provider='openai-codex',base_url='fixture-no-network',model='gpt-6-astra')
    assert result.get('failed') and result.get('completed') is False and not completed_turn(result)
    assert result.get('error') and result.get('final_response')
    rows.append({'case':name,'classification':classified.reason.value,'failed':result['failed'],
                 'completed':result['completed'],'snapshot_eligible':completed_turn(result),
                 'failure_reason':result.get('failure_reason')})
assert len(persisted)==2
print(json.dumps({'status':'PASS','checks':rows,'native_persistence_callbacks':len(persisted),
 'model_calls':0,'network_calls':0,'limits':'Exercises terminal native error handling, not live provider outage or reconnect/backoff.'}))
