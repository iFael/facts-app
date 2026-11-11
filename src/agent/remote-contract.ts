/** A heartbeat is only an availability hint, never authorization. */
export const AGENT_HEARTBEAT_MAX_AGE_MS=45_000;

export function agentHeartbeatFresh(lastSeenAt:unknown,now=Date.now()):boolean{
 if(typeof lastSeenAt!=='string')return false;
 const timestamp=Date.parse(lastSeenAt);
 return Number.isFinite(timestamp)&&timestamp<=now+5_000&&now-timestamp<AGENT_HEARTBEAT_MAX_AGE_MS;
}

export function agentJobResult(value:unknown):
 {status:'queued'|'working'|'done'|'error';reply:string|null;coverage:'complete'|'partial'|null}|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const row=value as Record<string,unknown>;
 if(!['queued','working','done','error'].includes(String(row.status)))return null;
 const status=row.status as 'queued'|'working'|'done'|'error';
 if(status==='done'&&(typeof row.reply!=='string'||!row.reply.trim()||row.reply.length>8000))return null;
 return {status,reply:status==='done'?row.reply as string:null,
  coverage:row.coverage==='complete'||row.coverage==='partial'?row.coverage:null};
}
