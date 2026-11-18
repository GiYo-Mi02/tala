import { z } from 'zod';
import * as schemas from './contracts';

export class ApiError extends Error {
  constructor(readonly status:number, message:string, readonly requestId?:string) { super(message); }
}

async function request(path:string, options:RequestInit):Promise<Response> {
  const controller=new AbortController();
  const signal=options.signal;
  const abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted) abort();
  else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(), 20_000);
  try {
    const response=await fetch('/api/v1'+path,{ ...options, signal:controller.signal,
      cache:'no-store',credentials:'same-origin',redirect:'error' });
    if (!response.ok) {
      const payload=schemas.publicError.safeParse(await response.json().catch(()=>null));
      throw new ApiError(response.status,payload.success?payload.data.error.message:'The request could not be completed.',
        payload.success?payload.data.error.requestId:undefined);
    }
    // Buffer under the same deadline so a stalled response body is covered too.
    if(response.status===204) return new Response(null,{status:204});
    return new Response(await response.blob(),{status:response.status,headers:response.headers});
  } catch (error) {
    if(error instanceof ApiError) throw error;
    if(signal?.aborted) throw error;
    throw new ApiError(0,controller.signal.aborted?'The request timed out. Try again.':'The portal could not reach the server. Check your connection.');
  } finally {
    signal?.removeEventListener('abort',abort);
    clearTimeout(timer);
  }
}

const body=(value:object={})=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
const unauthorized=(error:unknown)=>error instanceof ApiError&&error.status===401;
async function decode<T>(response:Response,schema:z.ZodType<T>):Promise<T> {
  const parsed=schema.safeParse(await response.json().catch(()=>null));
  if(!parsed.success) throw new ApiError(502,'The server returned an unexpected portal response.');
  return parsed.data;
}

export class PortalApi {
  private access:string|null=null;
  private refreshing:Promise<string>|null=null;
  private generation=0;
  private leaving=false;
  constructor(private readonly onExpired:()=>void) {}

  clear() { this.access=null;this.generation++; }

  private refresh(previous?:string|null):Promise<string> {
    if(this.leaving) return Promise.reject(new ApiError(401,'The session is closing.'));
    if(previous!==undefined&&this.access&&this.access!==previous) return Promise.resolve(this.access);
    if(this.refreshing) return this.refreshing;
    const generation=this.generation;
    const renew=async()=>{
      const {accessToken}=await decode(await request('/auth/refresh',body()),schemas.token);
      if(generation!==this.generation) throw new ApiError(401,'The session changed.');
      this.access=accessToken;
      return accessToken;
    };
    const pending=typeof navigator.locks?.request==='function' ? Promise.resolve(navigator.locks.request('tala-portal-refresh',renew)) : renew();
    const result=pending.finally(()=>{this.refreshing=null;});
    this.refreshing=result;
    return result;
  }

  async restore() {
    try { await this.refresh(); }
    catch(error) { if(unauthorized(error)) return null;throw error; }
    return this.json('/auth/me',schemas.account);
  }

  async login(email:string,password:string) {
    const {accessToken}=await decode(await request('/auth/login',body({email,password,mode:'browser'})),schemas.token);
    this.generation++;this.access=accessToken;
    return this.json('/auth/me',schemas.account);
  }

  async logout() {
    this.leaving=true;
    try {
      await this.refreshing?.catch(()=>{});
      try { await request('/auth/logout',body()); }
      catch(error) { if(!unauthorized(error)) throw error; }
      this.clear();
    } finally { this.leaving=false; }
  }

  private async protected(path:string, signal?:AbortSignal) {
    const generation=this.generation;
    const used=this.access;
    const send=(value:string)=>request(path,{headers:{Authorization:'Bearer '+value},signal});
    try {
      if(used) {
        try { return await send(used); }
        catch(error) { if(!unauthorized(error)) throw error; }
      }
      if(signal?.aborted) throw signal.reason;
      return await send(await this.refresh(used));
    } catch(error) {
      if(unauthorized(error)&&generation===this.generation&&!this.leaving) {
        this.clear();
        this.onExpired();
      }
      throw error;
    }
  }

  async json<T>(path:string,schema:z.ZodType<T>,signal?:AbortSignal) {
    return decode(await this.protected(path,signal),schema);
  }

  async image(id:string,page:number,signal?:AbortSignal) {
    const response=await this.protected('/submissions/'+encodeURIComponent(id)+'/pages/'+page,signal);
    const type=response.headers.get('Content-Type');
    if(type!=='image/jpeg'&&type!=='image/png') throw new ApiError(502,'The server did not return a supported scan image.');
    return response.blob();
  }
}
