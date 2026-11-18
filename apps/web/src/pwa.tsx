import { useEffect, useState } from 'react';

export function UpdatePrompt() {
  const [worker,setWorker]=useState<ServiceWorker|null>(null);
  useEffect(()=>{
    if(!import.meta.env.PROD||!('serviceWorker' in navigator)) return;
    let active=true;
    let applying=false;
    const controller=()=>{if(applying) window.location.reload();};
    const apply=()=>{applying=true;};
    window.addEventListener('tala:apply-update',apply);
    navigator.serviceWorker.addEventListener('controllerchange',controller);
    void navigator.serviceWorker.register('/sw.js').then(registration=>{
      if(!active)return;
      const inspect=()=>{
        if(active&&registration.waiting&&navigator.serviceWorker.controller) setWorker(registration.waiting);
      };
      inspect();
      registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',inspect));
    }).catch(()=>{});
    return ()=>{
      active=false;window.removeEventListener('tala:apply-update',apply);
      navigator.serviceWorker.removeEventListener('controllerchange',controller);
    };
  },[]);
  if(!worker)return null;
  return <aside className="update-banner" role="status"><span>A portal update is ready.</span>
    <button className="button primary" onClick={()=>{window.dispatchEvent(new Event('tala:apply-update'));worker.postMessage('ACTIVATE_UPDATE');}}>Reload portal</button>
  </aside>;
}
