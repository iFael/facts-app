import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
import {McpServer} from 'npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js';
import {WebStandardStreamableHTTPServerTransport} from 'npm:@modelcontextprotocol/sdk@1.30.0/server/webStandardStreamableHttp.js';
import {createSupabaseFactsService} from '../../../src/db/relational.ts';
import {createSupabaseDocumentsService} from '../../../src/db/documents.ts';
import {buildProtectedResourceMetadata,buildUnauthorizedHeaders,readJwtClaims} from '../../../src/mcp/auth.ts';
import {registerFactsTools,type FactsToolHost} from '../../../src/mcp/tools.ts';

const supabaseUrl=Deno.env.get('SUPABASE_URL')??'';
const publishableKey=Deno.env.get('SUPABASE_ANON_KEY')??'';
const resourceUrl=`${supabaseUrl}/functions/v1/facts-mcp`;
const resourceMetadataUrl=`${resourceUrl}/.well-known/oauth-protected-resource`;
const authorizationServer=`${supabaseUrl}/auth/v1`;

const cors={
 'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS',
 'Access-Control-Allow-Headers':'authorization, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id, apikey, x-client-info',
 'Access-Control-Expose-Headers':'mcp-session-id, mcp-protocol-version, www-authenticate'
};

function withCors(response:Response):Response{
 const headers=new Headers(response.headers);
 for(const [key,value] of Object.entries(cors))headers.set(key,value);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
function json(body:unknown,status=200,headers?:HeadersInit):Response{
 return withCors(new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...(headers??{})}}));
}
function unauthorized():Response{
 const headers=buildUnauthorizedHeaders(resourceMetadataUrl);
 return withCors(new Response(JSON.stringify({error:'unauthorized'}),{status:401,headers}));
}
function bearerToken(request:Request):string|undefined{
 const value=request.headers.get('authorization')?.trim();
 if(!value)return undefined;
 const match=/^Bearer\s+(.+)$/i.exec(value);
 return match?.[1]?.trim()||undefined;
}

async function authenticated(request:Request){
 const token=bearerToken(request);
 if(!token||!supabaseUrl||!publishableKey)return null;
 const client=createClient(supabaseUrl,publishableKey,{
  global:{headers:{Authorization:`Bearer ${token}`}},
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
 });
 const {data,error}=await client.auth.getUser(token);
 if(error||!data.user)return null;
 const claims=readJwtClaims(token);
 const scopes=typeof claims.scope==='string'?claims.scope.split(/\s+/).filter(Boolean):[];
 const authInfo={
  token,
  clientId:typeof claims.client_id==='string'?claims.client_id:'supabase-oauth',
  scopes,
  ...(typeof claims.exp==='number'?{expiresAt:claims.exp}:{}),
  extra:{sub:data.user.id}
 };
 return {client,authInfo};
}

function createServer(client:ReturnType<typeof createClient>){
 const server=new McpServer({name:'facts',version:'0.1.0'},{
  instructions:[
   'Facts is the authoritative record for this user. Read Facts instead of relying on chat memory.',
   'Money is always integer cents.',
   'Every mutation requires a UUID mutationId. Reuse the same mutationId only when retrying the exact same operation.',
   'Read the current entity before updating or deleting it.',
   'Document bytes are private; Evidence is derived and separately auditable.'
  ].join(' ')
 });
 registerFactsTools(server as unknown as FactsToolHost,createSupabaseFactsService(client),createSupabaseDocumentsService(client));
 return server;
}

Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const path=new URL(request.url).pathname;
 if(path.endsWith('/.well-known/oauth-protected-resource')){
  return json(buildProtectedResourceMetadata(resourceUrl,authorizationServer));
 }
 if(path.endsWith('/health'))return json({status:'ok',service:'facts-mcp'});

 const session=await authenticated(request);
 if(!session)return unauthorized();
 try{
  const transport=new WebStandardStreamableHTTPServerTransport({enableJsonResponse:true});
  const server=createServer(session.client);
  await server.connect(transport);
  return withCors(await transport.handleRequest(request,{authInfo:session.authInfo}));
 }catch(error){
  console.error('facts-mcp',error);
  return json({error:'internal_error'},500);
 }
});
