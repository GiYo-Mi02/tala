import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, FileText, Maximize, Minus, Plus, RotateCw } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import * as schemas from './contracts';
import type { FieldDefinition, FieldValue, ScanPage, SubmissionDetail, TemplateDefinition } from './contracts';
import { useSession } from './session';
import { Badge, Failure, Loading, Notice, PageTitle, formatTime } from './ui';

function PageImage({id,page,zoom,turn}:{id:string;page:ScanPage;zoom:number;turn:number}) {
  const {api}=useSession();
  const viewport=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState({width:0,height:0});
  const [link,setLink]=useState('');
  const [error,setError]=useState<unknown>(null);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const element=viewport.current;
    if(!element) return;
    const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));
    observer.observe(element);
    return ()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    const request=new AbortController();
    let objectUrl='';
    void api.image(id,page.pageNumber,request.signal).then(file=>{
      if(request.signal.aborted) return;
      objectUrl=URL.createObjectURL(file);
      setLink(objectUrl);
    }).catch(failure=>{if(!request.signal.aborted) setError(failure);});
    return ()=>{request.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[api,id,page.pageNumber,attempt]);
  const sideways=turn%2!==0;
  const width=sideways?page.height:page.width;
  const height=sideways?page.width:page.height;
  const scale=Math.max(0,Math.min((size.width-32)/width,(size.height-32)/height))*zoom;
  const retry=()=>{setError(null);setLink('');setAttempt(n=>n+1);};
  return <div ref={viewport} className="viewer-viewport" role="region" aria-label="Document image viewport" tabIndex={0}>
    {error?<Failure error={error} title="Scan unavailable" retry={retry}/> : !link?<Loading label={'Loading scan page '+page.pageNumber}/>:
      <div className="viewer-scroll-inner" style={{minWidth:width*scale+32,minHeight:height*scale+32}}>
        <div className="viewer-page" style={{width:width*scale,height:height*scale}}>
          <img src={link} alt={'Original scan, page '+page.pageNumber} style={{
            width:page.width*scale,height:page.height*scale,transform:'translate(-50%, -50%) rotate('+(turn*90)+'deg)',
          }} onError={()=>setError(new Error('The scan could not be displayed.'))}/>
        </div>
      </div>}
  </div>;
}

function Viewer({id,pages}:{id:string;pages:ScanPage[]}) {
  const [selected,setSelected]=useState(0);
  const [zoom,setZoom]=useState(1);
  const [turn,setTurn]=useState(0);
  const current=Math.min(selected,pages.length-1);
  const page=pages[current];
  function move(next:number) {setSelected(next);setZoom(1);setTurn(0);}
  return <section className="surface viewer">
    <div className="surface-heading"><div><h2>Original scan</h2><p>{pages.length} {pages.length===1?'page':'pages'} received</p></div><FileText size={20} aria-hidden="true"/></div>
    {page?<><div className="viewer-toolbar">
      <div className="tool-group" role="group" aria-label="Page navigation">
        <button className="icon-button" aria-label="Previous page" disabled={current===0} onClick={()=>move(current-1)}><ChevronLeft size={18} aria-hidden="true"/></button>
        <span className="page-number" aria-live="polite">Page {page.pageNumber} <small>({current+1}/{pages.length})</small></span>
        <button className="icon-button" aria-label="Next page" disabled={current>=pages.length-1} onClick={()=>move(current+1)}><ChevronRight size={18} aria-hidden="true"/></button>
      </div>
      <div className="tool-group" role="group" aria-label="Image display controls">
        <button className="icon-button" aria-label="Zoom out" disabled={zoom<=.75} onClick={()=>setZoom(n=>Math.max(.75,n-.25))}><Minus size={17} aria-hidden="true"/></button>
        <output aria-label="Zoom level" className="zoom-level">{Math.round(zoom*100)}%</output>
        <button className="icon-button" aria-label="Zoom in" disabled={zoom>=3} onClick={()=>setZoom(n=>Math.min(3,n+.25))}><Plus size={17} aria-hidden="true"/></button>
        <button className="icon-button" aria-label="Fit to screen" title="Fit to screen" onClick={()=>setZoom(1)}><Maximize size={17} aria-hidden="true"/></button>
        <button className="icon-button" aria-label="Rotate clockwise" title="Rotate clockwise" onClick={()=>setTurn(n=>(n+1)%4)}><RotateCw size={17} aria-hidden="true"/></button>
      </div>
    </div><PageImage key={page.imageId} id={id} page={page} zoom={zoom} turn={turn}/></>:
      <Notice title="No scans available"><p>This record has no stored pages.</p></Notice>}
  </section>;
}

type FieldItem={id:string;label:string;page:number;required?:boolean;value?:FieldValue};
function fieldSections(data:SubmissionDetail,template?:TemplateDefinition) {
  const values=new Map(data.fields.map(item=>[item.key,item]));
  const presented=new Set<string>();
  const sections=new Map<string,FieldItem[]>();
  const activePages=new Set(data.pages.map(page=>page.pageNumber));
  const append=(section:string,item:FieldItem)=>{
    const group=sections.get(section);
    if(group)group.push(item);else sections.set(section,[item]);
  };
  const shown=(definition:FieldDefinition)=>{
    const condition=definition.when;
    return values.has(definition.id)||activePages.has(definition.page)&&
      (!condition||condition.values.includes(values.get(condition.field)?.mobileValue??''));
  };
  for(const field of [...(template?.fields??[])].sort((a,b)=>a.displayOrder-b.displayOrder)) {
    if(!shown(field))continue;
    append(field.section?.trim()||('Page '+field.page),{id:field.id,label:field.label,page:field.page,required:field.required,value:values.get(field.id)});
    presented.add(field.id);
  }
  for(const value of values.values()) if(!presented.has(value.key)) {
    append(template?'Additional fields':'Page '+value.pageNumber,{id:value.key,label:value.key,page:value.pageNumber,value});
  }
  return sections;
}

function ReadValue({label,value,empty}:{label:string;value?:string|null;empty:string}) {
  return <div><dt>{label}</dt><dd className={value==null||value===''?'empty-value':''}>{value==null||value===''?empty:value}</dd></div>;
}

function FieldCard({item}:{item:FieldItem}) {
  const value=item.value;
  const confidence=value?.ocr?.confidence;
  return <div className="field-card">
    <div className="field-title"><h4>{item.label}</h4>
      <span>{!value?'Missing':confidence!=null?'OCR '+Math.round(confidence*100)+'%':'Page '+item.page}</span>
    </div>
    <dl className="field-values">
      <ReadValue label="Mobile confirmed" value={value?.mobileValue} empty={value?'Empty':'Missing'}/>
      <ReadValue label="Original OCR" value={value?.ocr?.original} empty={value?.ocr?'Empty reading':'Unavailable'}/>
      {value?.reviewValue!=null&&<ReadValue label="Reviewer correction" value={value.reviewValue} empty="Empty"/>}
      {value?.finalValue!=null&&<ReadValue label="Final value" value={value.finalValue} empty="Empty"/>}
    </dl>
    {item.required&&!value&&<p className="field-warning">This required field is missing from the submission.</p>}
    {value&&!value.confirmed&&<p className="field-warning">Mobile confirmation is missing.</p>}
    {value?.ocr?.warning&&<p className="field-warning">{warningMessage(value.ocr.warning)}</p>}
  </div>;
}

function warningMessage(value:string) {
  switch(value) {
    case 'label_detected': return 'A printed label may have been read as a value. Check the scan.';
    case 'conflicting_readings': return 'The OCR readings disagree. Check the scan.';
    case 'preprocessing_review': return 'Image processing changed the OCR reading. Check the scan.';
    case 'recognition_failed': return 'OCR could not read this field. Check the scan.';
    default: return value;
  }
}

export function UnselectedReview() {
  return <>
    <PageTitle title="Document review" description="Inspect an original scan alongside its submitted fields."/>
    <Notice title="Choose a submission" action={<Link className="button primary" to="/submissions">Browse submissions</Link>}>
      <p>Open a record from the submission list to start reviewing its pages.</p>
    </Notice>
  </>;
}

export function Review() {
  const id=useParams().id??'';
  const {api}=useSession();
  const result=useQuery({queryKey:['submission',id],queryFn:({signal})=>api.json('/submissions/'+encodeURIComponent(id),schemas.detail,signal)});
  const data=result.data;
  const template=useQuery({queryKey:['template',data?.templateId,data?.templateVersion],enabled:!!data,
    queryFn:({signal})=>api.json('/templates/'+encodeURIComponent(data!.templateId)+'/versions/'+data!.templateVersion,schemas.templateDetail,signal),staleTime:120_000});
  return <>
    <Link className="back-link" to="/submissions"><ArrowLeft size={16} aria-hidden="true"/>Back to submissions</Link>
    {result.isError?<Failure title="Submission unavailable" error={result.error} retry={()=>void result.refetch()}/>:
      !data?<Loading label="Loading submission"/>:<>
        <PageTitle title={template.data?.name??'Document review'} description={'Received '+formatTime(data.receivedAt)}
          actions={<Badge status={data.status}/>}/>
        <div className="review-meta"><span>Reference <code>{data.id}</code></span><span>Template version {data.templateVersion}</span>
          {data.receipt&&<span>Receipt {formatTime(data.receipt.acknowledgedAt)}</span>}
        </div>
        {data.decision?.notes&&<p className="inline-warning"><strong>Latest decision note</strong> {data.decision.notes}</p>}
        <div className="review-grid">
          <Viewer key={id} id={id} pages={data.pages}/>
          <section className="surface field-panel">
            <div className="surface-heading"><div><h2>Extracted information</h2><p>{data.fields.length} submitted fields · Read-only</p></div></div>
            {template.isError&&<p className="inline-warning">Template labels are unavailable. Submitted field identifiers are shown.</p>}
            {[...fieldSections(data,template.data)].map(([section,items])=><section className="field-section" key={section}>
              <h3>{section}</h3>{items.map(item=><FieldCard key={item.id} item={item}/>)}
            </section>)}
            {!data.fields.length&&<Notice title="No extracted fields"><p>There are no submitted field values to display.</p></Notice>}
          </section>
        </div>
      </>}
  </>;
}
