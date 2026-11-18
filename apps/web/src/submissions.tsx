import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, ChevronLeft, ChevronRight, Clock3, FileStack, ListChecks, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import * as schemas from './contracts';
import { useSession } from './session';
import { Badge, Failure, Loading, Notice, PageTitle, Refresh, SubmissionTable, reviewStates, statusNames } from './ui';

function useTemplates() {
  const {api}=useSession();
  return useQuery({queryKey:['templates'],queryFn:({signal})=>api.json('/templates',schemas.catalog,signal),staleTime:120_000});
}

export function Dashboard() {
  const {api}=useSession();
  const report=useQuery({queryKey:['overview'],staleTime:0,queryFn:({signal})=>api.json('/submissions/overview',schemas.overview,signal)});
  const templates=useTemplates();
  const data=report.data;
  const metrics=[
    {label:'Total submissions',value:data?.total,icon:FileStack,tone:'navy'},
    {label:'Pending verification',value:data?.counts.PENDING_VERIFICATION??0,icon:Clock3,tone:'gold'},
    {label:'In review',value:data?.counts.IN_REVIEW??0,icon:ListChecks,tone:'blue'},
    {label:'Verified',value:data?.counts.VERIFIED??0,icon:BadgeCheck,tone:'green'},
  ];
  return <>
    <PageTitle title="Verification dashboard" description="Monitor synchronized submissions and inspect scanned forms."
      actions={<Refresh pending={report.isFetching} onClick={()=>{void report.refetch();void templates.refetch();}}/>}/>
    {report.isError ? <Failure error={report.error} retry={()=>void report.refetch()}/> : !data ? <Loading label="Loading dashboard"/> : <>
      <div className="metric-grid">
        {metrics.map(({label,value,icon:Icon,tone})=><div className="metric" key={label}>
          <span className={'metric-icon tone-'+tone}><Icon size={20} aria-hidden="true"/></span>
          <div><p>{label}</p><strong>{value?.toLocaleString('en-PH')}</strong></div>
        </div>)}
      </div>
      <div className="status-strip" aria-label="Other verification counts">
        {(['NEEDS_CORRECTION','REJECTED','FINALIZED'] as const).map(status=><div key={status}>
          <Badge status={status}/><strong>{(data.counts[status]??0).toLocaleString('en-PH')}</strong>
        </div>)}
      </div>
      <section className="surface">
        <div className="surface-heading"><div><h2>Recent submissions</h2><p>Latest acknowledged records</p></div>
          <Link to="/submissions" className="button primary">View submissions <ArrowRight size={16} aria-hidden="true"/></Link>
        </div>
        {data.recent.length?<SubmissionTable rows={data.recent} templates={templates.data?.items??[]}/>:
          <Notice title="No submissions yet"><p>Completed mobile uploads will appear here after the server acknowledges them.</p></Notice>}
      </section>
    </>}
  </>;
}

const filters={q:'',status:'',template:'',from:'',to:'',sort:'newest'};
const limit=10;

export function Submissions() {
  const {api}=useSession();
  const [draft,setDraft]=useState({...filters});
  const [applied,setApplied]=useState({...filters});
  const [offset,setOffset]=useState(0);
  const [validation,setValidation]=useState('');
  const templates=useTemplates();
  const list=useQuery({queryKey:['submissions',applied,offset],staleTime:0,queryFn:({signal})=>{
    const params=new URLSearchParams({limit:String(limit),offset:String(offset)});
    for(const [key,value] of Object.entries(applied)) if(value) params.set(key,value);
    return api.json('/submissions?'+params,schemas.listing,signal);
  }});
  const templateOptions=[...new Map((templates.data?.items??[]).map(t=>[t.id,t])).values()];
  const rows=list.data?.items??[];

  function change(key:keyof typeof filters,value:string) {
    setDraft(previous=>({...previous,[key]:value}));setValidation('');
  }
  function apply(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(draft.from&&draft.to&&draft.from>draft.to) {setValidation('The end date must be on or after the start date.');return;}
    setOffset(0);setApplied({...draft,q:draft.q.trim()});
  }
  function clear() {setDraft({...filters});setApplied({...filters});setOffset(0);setValidation('');}

  return <>
    <PageTitle title="Submissions" description="Find acknowledged records and open their scanned documents."
      actions={<Refresh pending={list.isFetching} onClick={()=>{void list.refetch();void templates.refetch();}}/>}/>
    <form className="filters surface" onSubmit={apply}>
      <label className="filter-search">Search by reference or document
        <span className="search-control"><Search size={17} aria-hidden="true"/><input value={draft.q} maxLength={100} onChange={e=>change('q',e.target.value)} placeholder="Enter a reference or template"/></span>
      </label>
      <label><span id="status-filter-label">Verification status</span>
        <select aria-labelledby="status-filter-label" value={draft.status} onChange={e=>change('status',e.target.value)}>
          <option value="">All statuses</option>{reviewStates.map(value=><option key={value} value={value}>{statusNames[value]}</option>)}
        </select>
      </label>
      <label><span id="template-filter-label">Document template</span>
        <select aria-labelledby="template-filter-label" value={draft.template} onChange={e=>change('template',e.target.value)}>
          <option value="">All templates</option>{templateOptions.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label>Received from (UTC)<input type="date" value={draft.from} onChange={e=>change('from',e.target.value)}/></label>
      <label>Received through (UTC)<input type="date" value={draft.to} onChange={e=>change('to',e.target.value)}/></label>
      <label><span id="sort-filter-label">Sort by</span><select aria-labelledby="sort-filter-label" value={draft.sort} onChange={e=>change('sort',e.target.value)}>
        <option value="newest">Most recent</option><option value="oldest">Oldest</option><option value="status">Verification status</option>
      </select></label>
      <div className="filter-actions"><button className="button primary" type="submit">Apply filters</button>
        <button className="button text-button" type="button" onClick={clear}>Clear</button></div>
      {validation&&<p className="form-error" role="alert">{validation}</p>}
    </form>
    {templates.isError&&<p className="inline-warning" role="status">Template names are unavailable. Reference and status filters still work.</p>}
    <section className="surface">
      <div className="surface-heading"><div><h2>Submission list</h2><p>Records available for verification</p></div></div>
      {list.isError?<Failure error={list.error} retry={()=>void list.refetch()}/> : !list.data?<Loading/>:
        rows.length?<SubmissionTable rows={rows} templates={templates.data?.items??[]} full/>:
        <Notice title="No matching submissions"><p>Adjust the search or filters to look for other records.</p></Notice>}
      <div className="pagination">
        <span aria-live="polite">{rows.length?('Showing '+(offset+1)+'–'+(offset+rows.length)):'Page '+(offset/limit+1)}</span>
        <div><button className="button secondary" disabled={offset===0||list.isFetching} onClick={()=>setOffset(n=>Math.max(0,n-limit))}><ChevronLeft size={16} aria-hidden="true"/>Previous</button>
          <button className="button secondary" disabled={list.data?.nextOffset==null||list.isFetching} onClick={()=>setOffset(list.data?.nextOffset??offset)}>Next<ChevronRight size={16} aria-hidden="true"/></button></div>
      </div>
    </section>
  </>;
}
