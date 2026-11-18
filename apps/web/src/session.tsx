import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PortalApi } from './api';
import type { Account } from './contracts';

type State={kind:'loading'|'guest'|'expired'}|{kind:'active';user:Account}|{kind:'error';message:string};
type SessionValue={state:State;api:PortalApi;online:boolean;recover:()=>void;
  login:(email:string,password:string)=>Promise<Account>;logout:()=>Promise<void>};
const Context=createContext<SessionValue|null>(null);
const onlineSnapshot=()=>navigator.onLine;
function subscribe(callback:()=>void) {
  window.addEventListener('online',callback);window.addEventListener('offline',callback);
  return ()=>{window.removeEventListener('online',callback);window.removeEventListener('offline',callback);};
}

export function SessionProvider({children}:PropsWithChildren) {
  const queryClient=useQueryClient();
  const [state,setState]=useState<State>({kind:'loading'});
  const channel=useRef<BroadcastChannel|null>(null);
  const [api]=useState(()=>new PortalApi(()=>{
    queryClient.clear();
    setState({kind:'expired'});
  }));
  const online=useSyncExternalStore(subscribe,onlineSnapshot);
  const inFlight=useRef(false);
  const recover=useCallback(()=>{
    if(!navigator.onLine||inFlight.current) return;
    inFlight.current=true;
    setState({kind:'loading'});
    void api.restore().then(user=>setState(user?{kind:'active',user}:{kind:'guest'}))
      .catch(error=>setState({kind:'error',message:error instanceof Error?error.message:'Could not restore the session.'}))
      .finally(()=>{inFlight.current=false;});
  },[api]);
  useEffect(()=>{
    if(!online) queryClient.clear();
    else if(state.kind==='loading') recover();
  },[online,queryClient,recover,state.kind]);
  useEffect(()=>{
    if(typeof BroadcastChannel==='undefined') return;
    const messages=new BroadcastChannel('tala-portal-session');
    channel.current=messages;
    messages.onmessage=event=>{
      if(event.data!=='signed-out') return;
      api.clear();
      queryClient.clear();
      setState({kind:'guest'});
    };
    return ()=>{messages.close();channel.current=null;};
  },[api,queryClient]);

  async function login(email:string,password:string) {
    const user=await api.login(email,password);
    queryClient.clear();
    setState({kind:'active',user});
    return user;
  }
  async function logout() {
    await api.logout();
    queryClient.clear();
    setState({kind:'guest'});
    channel.current?.postMessage('signed-out');
  }
  return <Context.Provider value={{state,online,api,login,logout,recover}}>{children}</Context.Provider>;
}

export function useSession() {
  const value=useContext(Context);
  if(!value) throw new Error('Session provider is missing.');
  return value;
}
