import { AlertCircle, FileSearch, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Status, SubmissionRow, TemplateRef } from './contracts';
import { ApiError } from './api';

export const statusNames:Record<Status,string>={
  DRAFT:'Draft', UPLOADING:'Uploading', PENDING_VERIFICATION:'Pending verification', IN_REVIEW:'In review',
  NEEDS_CORRECTION:'Needs correction', VERIFIED:'Verified', REJECTED:'Rejected', FINALIZED:'Finalized', EXPIRED:'Expired',
};
export const reviewStates=['PENDING_VERIFICATION','IN_REVIEW','VERIFIED','NEEDS_CORRECTION','REJECTED','FINALIZED'] as const;
const dateTime=new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short'});
const day=new Intl.DateTimeFormat('en-PH',{dateStyle:'medium'});
export const formatTime=(value:string)=>dateTime.format(new Date(value));
export const formatDay=(value:string)=>day.format(new Date(value));

export function Badge({status}:{status:Status}) {
  return <span className={'badge status-'+status}><span className="status-dot"/>{statusNames[status]}</span>;
}

export function Brand() {
  return <div className="brand">
    <img className="brand-mark" src="/icon-192.png" alt="" width="40" height="40"/>
    <div><strong>T.A.L.A.</strong><small>Verification Portal</small></div>
  </div>;
}

export function Loading({label='Loading submissions'}:{label?:string}) {
  return <div className="skeleton-panel" role="status"><span className="sr-only">{label}</span>
    <div className="skeleton skeleton-short"/><div className="skeleton"/><div className="skeleton"/><div className="skeleton"/>
  </div>;
}

export function Notice({title,children,action,error=false}:{title:string;children:ReactNode;action?:ReactNode;error?:boolean}) {
  const Icon=error?AlertCircle:FileSearch;
  return <div className={'notice '+(error?'notice-error':'')} role={error?'alert':undefined}>
    <span className="notice-icon"><Icon size={22} aria-hidden="true"/></span>
    <div><h2>{title}</h2><div className="notice-body">{children}</div>{action&&<div className="notice-action">{action}</div>}</div>
  </div>;
}

export function Failure({error,retry,title='Could not load this information'}:{error:unknown;retry:()=>void;title?:string}) {
  return <Notice title={title} error action={<button className="button secondary" onClick={retry}><RefreshCw size={15} aria-hidden/>Try again</button>}>
    <p>{error instanceof Error?error.message:'Try the request again.'}</p>
    {error instanceof ApiError&&error.requestId&&<small>Request {error.requestId}</small>}
  </Notice>;
}

export function Refresh({pending,onClick}:{pending:boolean;onClick:()=>void}) {
  return <button className="button secondary" disabled={pending} onClick={onClick}>
    <RefreshCw size={16} aria-hidden="true"/>{pending?'Refreshing…':'Refresh'}
  </button>;
}

export function PageTitle({title,description,actions}:{title:string;description:string;actions?:ReactNode}) {
  return <div className="page-title"><div><h1>{title}</h1><p>{description}</p></div>{actions&&<div className="page-actions">{actions}</div>}</div>;
}

export function SubmissionTable({rows,templates,full=false}:{rows:SubmissionRow[];templates:TemplateRef[];full?:boolean}) {
  const names=new Map(templates.map(t=>[t.id+'@'+t.version,t.name]));
  return <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable submissions table">
    <table className="submission-table">
      <caption className="sr-only">{full?'Matching submissions':'Recent submissions'}</caption>
      <thead><tr>
        <th scope="col">Reference</th><th scope="col">Document</th>
        {full&&<th scope="col">Pages</th>}
        <th scope="col">Submitted by</th><th scope="col">Received</th>
        {full&&<th scope="col">Receipt</th>}
        <th scope="col">Verification</th><th scope="col"><span className="sr-only">Actions</span></th>
      </tr></thead>
      <tbody>{rows.map(row=><tr key={row.id}>
        <td><span className="record-ref" title={row.id}>{row.id.slice(0,8).toUpperCase()}</span></td>
        <td className="document-cell">{names.get(row.templateId+'@'+row.templateVersion)??row.templateId}</td>
        {full&&<td>{row.pageCount}</td>}
        <td>{row.submittedBy?.email??'—'}</td>
        <td><time dateTime={row.receivedAt} title={formatTime(row.receivedAt)}>{formatDay(row.receivedAt)}</time></td>
        {full&&<td>{row.completedAt?<time dateTime={row.completedAt} title={formatTime(row.completedAt)}>Acknowledged</time>:'—'}</td>}
        <td><Badge status={row.status}/></td>
        <td><Link className="row-link" to={'/submissions/'+row.id} aria-label={'Open submission '+row.id}>Open <span aria-hidden="true">↗</span></Link></td>
      </tr>)}</tbody>
    </table>
  </div>;
}
