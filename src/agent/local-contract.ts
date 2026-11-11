export type ChatTurn = {role:'user'|'assistant';content:string};
export type BankRow = {
  occurred_at:string;
  amount_cents:number;
  direction:string;
  institution:string|null;
  category:string|null;
};

const maxTurns=6;
const maxQuestion=1000;
const maxTurnLength=1600;
const maxCents=1_000_000_000_000;

function text(value:unknown,max:number):string {
  if(typeof value!=='string')throw new Error('Texto inválido.');
  const clean=value.trim();
  if(!clean||clean.length>max)throw new Error('Texto fora do limite.');
  return clean;
}

/** The browser only sends its question and in-memory conversation turns. */
export function parseChatRequest(value:unknown):{question:string;history:ChatTurn[]} {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Solicitação inválida.');
  const input=value as Record<string,unknown>;
  const question=text(input.question,maxQuestion);
  if(!Array.isArray(input.history)||input.history.length>maxTurns)
    throw new Error('Histórico inválido.');
  const history=input.history.map((value:unknown):ChatTurn=>{
    if(!value||typeof value!=='object'||Array.isArray(value))
      throw new Error('Mensagem inválida.');
    const turn=value as Record<string,unknown>;
    if(turn.role!=='user'&&turn.role!=='assistant')throw new Error('Papel inválido.');
    return {role:turn.role,content:text(turn.content,maxTurnLength)};
  });
  return {question,history};
}

function label(value:string|null):string {
  if(!value||!(/^[\p{L}\p{N} .,()/+\-]{1,60}$/u).test(value))return 'não informada';
  return value;
}

function sum(a:number,b:number):number {
  const value=a+b;
  if(!Number.isSafeInteger(value)||Math.abs(value)>maxCents)throw new Error('Limite monetário.');
  return value;
}

/** Aggregate only posted, non-foreign bank rows. No PII, balance claims or individual transactions. */
export function summarizeBankRows(
  rows:readonly BankRow[],totalRows:number,from:string,to:string,
) {
  if(!Number.isInteger(totalRows)||totalRows<rows.length||rows.length>300||
     !/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))
    throw new Error('Recorte financeiro inválido.');
  const groups=new Map<string,{institution:string;category:string;direction:'incoming'|'outgoing';count:number;amountCents:number}>();
  let incomingCents=0,outgoingCents=0;
  for(const row of rows){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(row.occurred_at)||
       row.occurred_at<from||row.occurred_at>to||
       !Number.isSafeInteger(row.amount_cents)||row.amount_cents<=0||
       row.amount_cents>maxCents||!['incoming','outgoing'].includes(row.direction))
      throw new Error('Registro financeiro inválido.');
    const direction=row.direction as 'incoming'|'outgoing';
    const institution=label(row.institution),category=label(row.category);
    if(direction==='incoming')incomingCents=sum(incomingCents,row.amount_cents);
    else outgoingCents=sum(outgoingCents,row.amount_cents);
    const key=JSON.stringify([institution,category,direction]);
    const current=groups.get(key)??{institution,category,direction,count:0,amountCents:0};
    current.count++;current.amountCents=sum(current.amountCents,row.amount_cents);
    groups.set(key,current);
  }
  const grouped=[...groups.values()].sort((a,b)=>b.amountCents-a.amountCents);
  return {
    source:'facts_bank_transactions',currency:'BRL',from,to,
    postedRowsReceived:rows.length,totalPostedRows:totalRows,
    complete:totalRows===rows.length && grouped.length<=80,
    groupLimitExceeded:grouped.length>80,
    incomingCents,outgoingCents,
    groups:grouped.slice(0,80),
    caveats:[
      'Entradas não são automaticamente renda, saídas não são automaticamente despesa.',
      'Há transferências internas e possíveis duplicidades ainda não conciliadas.',
      'Sem saldos bancários de referência; não inferir saldo atual nem projeção.',
      'Não há compromissos futuros validados nesta consulta.',
      ...(totalRows!==rows.length?['O recorte de movimentos é parcial: totais não são exaustivos.']:[]),
    ],
  };
}

/** Reject CSRF, remote access, and server deployments. */
export function localRequestAllowed(
  url:string,host:string|null,origin:string|null,environment:string,
):boolean {
  if(environment!=='development'||!host||!origin)return false;
  try{
    const requested=new URL(url);
    if(requested.protocol!=='http:'||
       !['127.0.0.1','localhost'].includes(requested.hostname))return false;
    return host===requested.host&&origin===requested.origin;
  }catch{return false;}
}
