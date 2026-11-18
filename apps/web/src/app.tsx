import { useEffect, useRef, useState, type FormEvent, type PropsWithChildren } from 'react';
import { ArrowRight, FileSearch, FileText, LayoutDashboard, LockKeyhole, LogOut, Menu, ScanLine, ShieldCheck, UserRound, X } from 'lucide-react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Dashboard, Submissions } from './submissions';
import { Review, UnselectedReview } from './review';
import { useSession } from './session';
import { Brand, Failure, Loading, Notice, PageTitle } from './ui';

const paths=[
  {to:'/',name:'Dashboard',icon:LayoutDashboard},
  {to:'/submissions',name:'Submissions',icon:FileText},
  {to:'/review',name:'Document review',icon:FileSearch},
  {to:'/account',name:'Account',icon:UserRound},
];

function PublicScreen({children}:PropsWithChildren) {
  return <main className="public-screen">
    <aside className="public-brand">
      <Brand/>
      <div className="public-info">
        <ScanLine size={46} strokeWidth={1.45} aria-hidden="true"/>
        <h2>Document<br/>verification</h2>
        <p>Inspect synchronized scans and their submitted fields in one workspace.</p>
      </div>
    </aside>
    <div className="public-content"><div className="public-inner">{children}</div></div>
  </main>;
}

function Login() {
  const {login,state}=useSession();
  const navigate=useNavigate();
  const location=useLocation();
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [waiting,setWaiting]=useState(false);
  const [error,setError]=useState('');
  const submitting=useRef(false);
  const next=typeof location.state?.next==='string'&&/^\/(?!\/)/.test(location.state.next)?location.state.next:'/';

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(submitting.current)return;
    submitting.current=true;
    setWaiting(true);setError('');
    try {
      const user=await login(email.trim(),password);
      navigate(user.role==='VERIFIER'?next:'/unauthorized',{replace:true});
    } catch(failure) {setError(failure instanceof Error?failure.message:'Sign-in could not be completed.');}
    finally {setWaiting(false);setPassword('');submitting.current=false;}
  }
  if(state.kind==='active') return <Navigate to={state.user.role==='VERIFIER'?next:'/unauthorized'} replace/>;
  if(state.kind==='loading') return <PublicScreen><Loading label="Checking your session"/></PublicScreen>;
  return <PublicScreen>
    <span className="public-icon"><LockKeyhole size={24} aria-hidden="true"/></span>
    <h1>Sign in</h1>
    <p>Use your assigned verifier account.</p>
    <form className="login-form" onSubmit={submit}>
      <label>Email address<input type="email" autoComplete="username" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} required/></label>
      <label>Password<input type="password" autoComplete="current-password" maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} required/></label>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <button className="button primary" disabled={waiting} type="submit">{waiting?'Signing in…':'Sign in'}<ArrowRight size={17} aria-hidden="true"/></button>
    </form>
  </PublicScreen>;
}

function SignOut({className='button secondary'}:{className?:string}) {
  const {logout}=useSession();
  const navigate=useNavigate();
  const [waiting,setWaiting]=useState(false);
  const [error,setError]=useState('');
  async function run() {
    setWaiting(true);setError('');
    try {await logout();navigate('/login',{replace:true});}
    catch {setError('Could not sign out. Reconnect and try again.');}
    finally {setWaiting(false);}
  }
  return <><button className={className} disabled={waiting} onClick={()=>void run()}>
    <LogOut size={17} aria-hidden="true"/>{waiting?'Signing out…':'Sign out'}</button>
    {error&&<p className="sign-out-error" role="alert">{error}</p>}</>;
}

function Protected() {
  const {state,recover}=useSession();
  const location=useLocation();
  if(state.kind==='loading') return <PublicScreen><Loading label="Checking your session"/></PublicScreen>;
  if(state.kind==='error') return <PublicScreen><Failure title="Could not restore your session" error={new Error(state.message)} retry={recover}/></PublicScreen>;
  if(state.kind==='guest') return <Navigate to="/login" state={{next:location.pathname}} replace/>;
  if(state.kind==='expired') return <Navigate to="/session-expired" state={{next:location.pathname}} replace/>;
  if(state.kind==='active'&&state.user.role!=='VERIFIER') return <Navigate to="/unauthorized" replace/>;
  return <Outlet/>;
}

function SidebarLinks({close}:{close:()=>void}) {
  const location=useLocation();
  const inspecting=location.pathname.startsWith('/submissions/');
  return <nav className="side-nav" aria-label="Main navigation">
    {paths.map(({to,name,icon:Icon})=>{
      const target=to==='/review'&&inspecting?location.pathname:to;
      return <NavLink key={to} to={target} end={to==='/submissions'||to==='/'} onClick={close}
        className={({isActive})=>'side-link '+(isActive?'side-active':'')}>
        <Icon size={18} aria-hidden="true"/><span>{name}</span>
      </NavLink>;
    })}
  </nav>;
}

function Shell() {
  const {state}=useSession();
  const {pathname}=useLocation();
  const [drawer,setDrawer]=useState(false);
  const toggle=useRef<HTMLButtonElement>(null);
  const mobileClose=useRef<HTMLButtonElement>(null);
  const account=state.kind==='active'?state.user:null;
  const title=pathname.startsWith('/submissions/')?'Document review':paths.find(p=>p.to===pathname)?.name??'Page not found';
  useEffect(()=>{
    if(!drawer)return;
    mobileClose.current?.focus();
    function close(event:KeyboardEvent) {if(event.key==='Escape'){setDrawer(false);toggle.current?.focus();}}
    window.addEventListener('keydown',close);
    return ()=>window.removeEventListener('keydown',close);
  },[drawer]);
  return <div className="shell">
    <a href="#main" className="skip-link">Skip to main content</a>
    {drawer&&<button aria-label="Close navigation" className="nav-overlay" tabIndex={-1} onClick={()=>setDrawer(false)}/>}
    <aside id="navigation" className={'sidebar '+(drawer?'sidebar-open':'')}>
      <div className="sidebar-top">
        <Link to="/" onClick={()=>setDrawer(false)} aria-label="TALA dashboard"><Brand/></Link>
        <button ref={mobileClose} className="icon-button mobile-close" aria-label="Close navigation menu" onClick={()=>{setDrawer(false);toggle.current?.focus();}}><X size={21}/></button>
      </div>
      <SidebarLinks close={()=>setDrawer(false)}/>
      <div className="sidebar-bottom"><SignOut className="side-link logout-link"/></div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="topbar-left"><button ref={toggle} className="icon-button menu-button" aria-label="Open navigation" aria-controls="navigation"
          aria-expanded={drawer} onClick={()=>setDrawer(open=>!open)}><Menu size={21}/></button><span>{title}</span></div>
        {account&&<div className="account-chip">
          <span className="role-pill"><ShieldCheck size={15} aria-hidden="true"/>Verifier</span>
          <Link to="/account" className="account-email">{account.email}</Link>
        </div>}
      </header>
      <main id="main" className="workspace-content" tabIndex={-1}><Outlet/></main>
    </div>
  </div>;
}

function Account() {
  const {state}=useSession();
  if(state.kind!=='active') return null;
  return <>
    <PageTitle title="Account" description="Your assigned portal access."/>
    <section className="surface profile">
      <div className="surface-heading"><h2>Account details</h2></div>
      <dl><div><dt>Email</dt><dd>{state.user.email}</dd></div><div><dt>Role</dt><dd>Verifier</dd></div></dl>
    </section>
  </>;
}

function Unauthorized() {
  const {state}=useSession();
  if(state.kind==='guest')return <Navigate to="/login" replace/>;
  return <PublicScreen><h1>Access restricted</h1><p>This portal requires a verifier account.</p>
    {state.kind==='active'&&<><p>Signed in as {state.user.email} ({state.user.role.toLowerCase()}).</p><SignOut/></>}
    {state.kind!=='active'&&<Link className="button primary" to="/login">Go to sign-in</Link>}
  </PublicScreen>;
}

function Expired() {
  const location=useLocation();
  return <PublicScreen><h1>Session expired</h1><p>Sign in again to continue reviewing submissions.</p>
    <Link className="button primary" to="/login" state={location.state}>Return to sign-in</Link>
  </PublicScreen>;
}

function NotFound() {
  return <Notice title="Page not found" action={<Link to="/" className="button primary">Go to dashboard</Link>}>
    <p>The page you requested could not be found.</p>
  </Notice>;
}

export function App() {
  const {online}=useSession();
  if(!online)return <PublicScreen><h1>Connection unavailable</h1>
    <p>Reconnect to sign in or view private submissions.</p></PublicScreen>;
  return <Routes>
    <Route path="/login" element={<Login/>}/>
    <Route path="/unauthorized" element={<Unauthorized/>}/>
    <Route path="/session-expired" element={<Expired/>}/>
    <Route element={<Protected/>}>
      <Route element={<Shell/>}>
        <Route index element={<Dashboard/>}/>
        <Route path="/submissions" element={<Submissions/>}/>
        <Route path="/submissions/:id" element={<Review/>}/>
        <Route path="/review" element={<UnselectedReview/>}/>
        <Route path="/account" element={<Account/>}/>
        <Route path="*" element={<NotFound/>}/>
      </Route>
    </Route>
  </Routes>;
}
