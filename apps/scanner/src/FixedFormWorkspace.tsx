import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,BackHandler,Image,Modal,ScrollView,Text,TextInput,View,useWindowDimensions,type ImageSourcePropType} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import {activeFixedFields,fixedErrors,fixedReadiness,fixedTemplate,fixedWithPage,newFixedDraft,normalizeFixed,printedDate,sssTemplate,
  type FixedDraft,type FixedField,type FixedPage,type FixedReading} from '@tala/core';
import {initializeFixedRepository,listFixedDrafts,missingFixedPages,persistFixedDraft,persistFixedPage} from './fixedRepository';
import {recognizeFixedPage,type FixedExtraction} from './fixedOcr';
import TalaOcr from '../modules/tala-ocr';
import {discardCache} from './repository';
import {FixedFormCapture} from './FixedFormCapture';
import {ReadingImage,ReadingStrip} from './ReadingImage';
import {Action,Card,colors,styles} from './ui';

const references:Record<number,ImageSourcePropType>={1:require('../assets/sss-e1-page-1.png'),2:require('../assets/sss-e1-page-2.png'),3:require('../assets/sss-e1-page-3.png')};
export function FixedFormWorkspace({onClose}:{onClose:()=>void}) {
  const [drafts,setDrafts]=useState<FixedDraft[]>([]);const [draft,setDraft]=useState<FixedDraft>();
  const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [progress,setProgress]=useState('');
  const [error,setError]=useState('');const [notice,setNotice]=useState('');const [dirty,setDirty]=useState(false);
  const [capture,setCapture]=useState<1|3>();const [expanded,setExpanded]=useState<string>();const [viewer,setViewer]=useState<{page:number;reference:boolean}>();
  const [viewerZoom,setViewerZoom]=useState(1);const [fieldZoom,setFieldZoom]=useState(1);
  const [fieldView,setFieldView]=useState<FixedField>();const [missing,setMissing]=useState<number[]>([]);
  const scroll=useRef<ScrollView>(null);
  const mounted=useRef(true);const operation=useRef(false);const current=useRef({busy,dirty,draft,capture});current.current={busy,dirty,draft,capture};
  const width=useWindowDimensions().width-40;
  const refresh=useCallback(async()=>{const values=await listFixedDrafts();if(mounted.current)setDrafts(values);},[]);
  useEffect(()=>{mounted.current=true;void(async()=>{try{await initializeFixedRepository();await refresh();}catch{if(mounted.current)setError('SSS draft storage could not open. Restart without clearing app data.');}finally{if(mounted.current)setLoading(false);}})();return()=>{mounted.current=false;};},[refresh]);
  function leave(){
    if(current.current.busy || operation.current)return;
    const done=()=>{if(current.current.draft){setDraft(undefined);setDirty(false);setNotice('');setError('');}else onClose();};
    if(current.current.dirty)Alert.alert('Unsaved SSS changes','Save first, or discard changes made since the last save.',[{text:'Keep editing',style:'cancel'},{text:'Discard changes',style:'destructive',onPress:done}]);else done();
  }
  const leaveRef=useRef(leave);leaveRef.current=leave;
  useEffect(()=>{const listener=BackHandler.addEventListener('hardwareBackPress',()=>{if(current.current.capture)return false;leaveRef.current();return true;});return()=>listener.remove();},[]);
  async function openDraft(value:FixedDraft){
    try{fixedTemplate(value.templateId,value.templateVersion);setMissing(await missingFixedPages(value));setDraft(value);setDirty(false);setError('');setNotice('');setExpanded(undefined);}
    catch{setError('This draft uses an unsupported template version. Its saved data was retained.');}
  }
  function remember(value:FixedDraft,message:string){if(!mounted.current)return;setDraft(value);setDirty(false);setNotice(message);setDrafts(old=>[value,...old.filter(d=>d.id!==value.id)]);scroll.current?.scrollTo({y:0,animated:false});}
  async function create(){
    if(operation.current)return;operation.current=true;setBusy(true);setError('');
    try{const next=await persistFixedDraft(newFixedDraft(Crypto.randomUUID(),new Date().toISOString()));remember(next,'SSS draft created locally.');setMissing([]);}
    catch{setError('Could not create the SSS draft. Check storage and retry.');}finally{operation.current=false;if(mounted.current)setBusy(false);}
  }
  function edit(field:FixedField,text:string){if(!draft)return;setDraft({...draft,values:{...draft.values,[field.id]:field.type==='date'?normalizeFixed(field,text):text},confirmed:{...draft.confirmed,[field.id]:false},state:'editing'});setDirty(true);setNotice('');}
  async function save(ready:boolean){
    if(!draft || operation.current)return;
    const problems=ready?fixedReadiness(draft):[];if(problems.length){setError(problems.slice(0,6).join('\n'));scroll.current?.scrollTo({y:0,animated:false});return;}
    operation.current=true;setBusy(true);setError('');
    try{remember(await persistFixedDraft({...draft,state:ready?'ready':'editing'}),ready?'Ready locally for future sync. No upload was made.':'SSS changes saved on this phone.');setMissing(await missingFixedPages(draft));}
    catch(e){setError(e instanceof Error?e.message:'The draft could not be saved. Your edits remain on screen.');}
    finally{operation.current=false;if(mounted.current)setBusy(false);}
  }
  async function replaceChoice(value:FixedDraft,page:number):Promise<boolean|null>{
    const hasEdits=sssTemplate.fields.some(f=>f.page===page && f.mode==='ocr' && value.values[f.id]?.trim());
    if(!hasEdits)return true;
    return new Promise(resolve=>Alert.alert('Use new SSS OCR values?','The page and raw readings will be saved. Choose whether to replace editable values; confirmations for this page will reset.',[
      {text:'Cancel',style:'cancel',onPress:()=>resolve(null)},{text:'Keep edited values',onPress:()=>resolve(false)},{text:'Use new OCR',onPress:()=>resolve(true)}],{cancelable:false}));
  }
  async function accept(page:FixedPage){
    if(!draft || operation.current)return;
    const replace=await replaceChoice(draft,page.page);if(replace===null)throw new Error('Saving canceled. The previous page is unchanged.');
    operation.current=true;setBusy(true);setError('');
    try{
      const extraction=await recognizeFixedPage(draft,page,value=>{if(mounted.current)setProgress(value);});
      const next=await persistFixedPage(draft,page,extraction.run,replace);remember(next,'Page and raw SSS readings saved locally. Compare, correct and confirm each active field.');setMissing(await missingFixedPages(next));setCapture(undefined);
    }finally{operation.current=false;if(mounted.current){setBusy(false);setProgress('');}}
  }
  async function readSaved(page:FixedPage){
    if(!draft || operation.current)return;const replace=await replaceChoice(draft,page.page);if(replace===null)return;
    operation.current=true;setBusy(true);setError('');
    try{const result=await recognizeFixedPage(draft,page,setProgress);const next=fixedWithPage(draft,page,result.run,replace);remember(await persistFixedDraft(next),'SSS OCR saved separately from reviewed values. Check every active field.');}
    catch(e){setError(e instanceof Error?e.message:'OCR did not finish. Existing readings were retained.');}
    finally{operation.current=false;if(mounted.current){setBusy(false);setProgress('');}}
  }
  if(capture)return <FixedFormCapture template={sssTemplate} pageNumber={capture} onAccept={accept} onCancel={()=>setCapture(undefined)}/>;
  const fields=draft?activeFixedFields(draft):[];const errors=draft?fixedErrors(draft):{};
  const sections=[...new Set(fields.map(f=>f.section))];
  return <SafeAreaView style={styles.screen}>
    <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.brand}>T.A.L.A.</Text><Action title={draft?'← SSS drafts':'← BEEF workspace'} secondary disabled={busy} onPress={leave}/>
      <Text style={styles.eyebrow}>FIXED TEMPLATE · VERSION {sssTemplate.version}</Text><Text style={styles.title}>SSS E-1 Personal Record</Text>
      <Text style={styles.small}>{sssTemplate.revision} · Fictional local test profile</Text>
      <Text style={styles.body}>Main page, all printed dependent rows, and the optional additional sheet. Checkbox choices, signatures and fingerprints need human review. This app does not authenticate identity or submit to SSS.</Text>
      {(loading||busy) && <View style={styles.row}><ActivityIndicator/><Text accessibilityLiveRegion="polite" style={styles.body}>{progress||'Working locally...'}</Text></View>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}{!!notice && <Text style={{...styles.body,color:colors.teal}}>{notice}</Text>}
      <View style={{gap:8}}>{sssTemplate.pages.map(p=><Action key={p.number} title={`Reference ${p.number}: ${p.label}`} secondary disabled={busy} onPress={()=>setViewer({page:p.number,reference:true})}/>)}</View>
      {!draft?<>
        <Action title="+ New SSS E-1 draft" disabled={loading||busy} onPress={()=>{void create();}}/>
        <Text style={styles.heading}>Saved SSS drafts · {drafts.length}</Text>
        {drafts.map(d=><Card key={d.id}><Text style={styles.heading}>{[d.values.sss_registrant_first_name,d.values.sss_registrant_last_name].filter(Boolean).join(' ')||'Untitled SSS draft'}</Text>
          <Text style={styles.small}>{d.state==='ready'?'Ready for future sync':'Unfinished'} · {d.templateId} v{d.templateVersion}{'\n'}{d.id}</Text>
          <Action title="Open SSS draft" secondary onPress={()=>{void openDraft(d);}}/></Card>)}
      </>:<>
        <Text selectable style={styles.small}>Draft {draft.id} · {draft.state==='ready'?'Ready locally':'Unfinished'}{dirty?' · Unsaved changes':''}</Text>
        <Text style={styles.heading}>1. Capture the applicable pages</Text>
        <Text style={styles.body}>Page 2 is bundled instructions, so it does not require a photograph. Choose Yes for the additional-sheet checkbox when page 3 is used.</Text>
        {sssTemplate.pages.filter(p=>p.capture).map(p=>{
          const page=draft.pages[p.number];const enabled=p.number!==3||draft.values.sss_additional_sheet_used==='Yes';
          return <Card key={p.number}><Text style={styles.heading}>Page {p.number} · {p.label}</Text>
            <Text style={styles.body}>{page?(missing.includes(p.number)?'Saved image missing - retake required':'Accepted in private storage'):enabled?'Capture required':'Optional; select Yes below to include'}</Text>
            {p.number===3 && <ChoiceControl field={sssTemplate.fields.find(f=>f.id==='sss_additional_sheet_used')!} value={draft.values.sss_additional_sheet_used} disabled={busy} onChange={value=>edit(sssTemplate.fields.find(f=>f.id==='sss_additional_sheet_used')!,value)}/>}
            <Action title={page?`Retake page ${p.number}`:`Capture page ${p.number}`} disabled={busy||!enabled} onPress={()=>setCapture(p.number as 1|3)}/>
            {page && <><Action title={`View saved page ${p.number}`} secondary disabled={busy||missing.includes(p.number)} onPress={()=>setViewer({page:p.number,reference:false})}/>
              <Action title={`Read page ${p.number} fields again`} secondary disabled={busy||!enabled||missing.includes(p.number)} onPress={()=>{void readSaved(page);}}/>
              {TalaOcr.diagnosticsEnabled && enabled && <FixedDiagnostics key={page.imageId} draft={draft} page={page}/>}</>}
          </Card>;
        })}
        <Text style={styles.heading}>2. Review every active field</Text>
        <Text style={styles.body}>Required markers are T.A.L.A.'s local review checks. Empty optional rows can be explicitly confirmed as blank. Read the printed instructions for applicability.</Text>
        {sections.map(section=>{
          const rows=fields.filter(f=>f.section===section);const checked=rows.filter(f=>draft.confirmed[f.id]).length;
          return <Card key={section}><Action title={`${section} · ${checked}/${rows.length} checked ${expanded===section?'−':'+'}`} secondary disabled={busy} onPress={()=>setExpanded(expanded===section?undefined:section)}/>
            {expanded===section && <>
              {rows.map(field=>{
                const reading=[...draft.history].reverse().find(r=>r.fields[field.id])?.fields[field.id];
                const stale=reading && reading.pageImageId!==draft.pages[field.page]?.imageId;
                return <View key={field.id} style={{gap:8,paddingVertical:12}}>
                  <Text style={styles.heading}>{field.label}{field.required?' *':''}</Text>
                  <Text style={styles.small}>Page {field.page} · {field.id} · {field.mode==='manual'?'Manual / visual review':'Mapped OCR input'}</Text>
                  {field.type==='choice'?<ChoiceControl field={field} value={draft.values[field.id]??''} disabled={busy} onChange={value=>edit(field,value)}/>
                    :<TextInput accessibilityLabel={field.label} style={styles.input} editable={!busy} value={field.type==='date'?printedDate(draft.values[field.id]??''):draft.values[field.id]??''}
                      onChangeText={value=>edit(field,value)} onBlur={()=>{const normalized=normalizeFixed(field,draft.values[field.id]??'');if(normalized!==draft.values[field.id])edit(field,normalized);}} autoCapitalize={field.type==='email'?'none':'characters'} autoCorrect={false}
                      placeholder={field.type==='date'?'MM/DD/YYYY':field.required?'Enter from source':'Optional / leave blank if absent'}/>}
                  <Text selectable style={styles.small}>Raw OCR: {field.mode==='manual'?'Not automatically read':reading?.text||'(blank / not run)'}{reading && ` · Confidence: ${reading.confidence===null?'unavailable':(reading.confidence*100).toFixed(1)+'%'}`}</Text>
                  {!!reading?.warning && <Text style={styles.warning}>{reading.warning}</Text>}{stale && <Text style={styles.warning}>This reading belongs to a replaced photo. Compare the current image.</Text>}
                  {!!errors[field.id] && <Text style={styles.error}>{errors[field.id]}</Text>}
                  <Action title="View source area" secondary disabled={busy||!draft.pages[field.page]||missing.includes(field.page)} onPress={()=>{setFieldZoom(1);setFieldView(field);}}/>
                  <Action title={draft.confirmed[field.id]?'✓ Checked against source':'Confirm this field / optional blank'} secondary disabled={busy||!!errors[field.id]||!draft.pages[field.page]||missing.includes(field.page)}
                    onPress={()=>{setDraft({...draft,confirmed:{...draft.confirmed,[field.id]:!draft.confirmed[field.id]},state:'editing'});setDirty(true);}}/>
                </View>;
              })}
              <Action title="Confirm empty optional fields in this section" secondary disabled={busy||!rows.every(f=>!!draft.pages[f.page]&&!missing.includes(f.page))} onPress={()=>{
                const blank=rows.filter(f=>!f.required && !draft.values[f.id]?.trim()&&!errors[f.id]);
                Alert.alert('Confirm optional blanks',`Confirm ${blank.length} empty fields only after checking their source areas. No values will be invented.`,[{text:'Cancel',style:'cancel'},{text:'Checked: leave blank',onPress:()=>{setDraft({...draft,confirmed:{...draft.confirmed,...Object.fromEntries(blank.map(f=>[f.id,true]))},state:'editing'});setDirty(true);}}]);
              }}/>
            </>}
          </Card>;
        })}
        <Text style={styles.small}>{draft.history.length} OCR runs retained with field, template, page and image IDs. Manual entries remain separate from raw OCR.</Text>
        <Action title="Save unfinished SSS draft" disabled={busy} onPress={()=>{void save(false);}}/>
        <Action title="Check and mark ready locally" disabled={busy} onPress={()=>{void save(true);}}/>
        <Text style={styles.small}>Ready locally is not SSS approval. Mobile-to-web synchronization has not started.</Text>
      </>}
    </ScrollView>
    {!!viewer && <Modal onRequestClose={()=>setViewer(undefined)}><SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
      <Action title="Close page" onPress={()=>setViewer(undefined)}/><Text style={styles.heading}>{sssTemplate.pages.find(p=>p.number===viewer.page)?.label}</Text>
      <ZoomActions zoom={viewerZoom} onChange={setViewerZoom}/><ScrollView horizontal>
      {viewer.reference?<Image source={references[viewer.page]} resizeMode="contain" style={{width:width*viewerZoom,height:width*viewerZoom*792/612}}/>
        :draft?.pages[viewer.page] && <ReadingImage uri={draft.pages[viewer.page]!.uri} width={width*viewerZoom} height={width*viewerZoom*draft.pages[viewer.page]!.height/draft.pages[viewer.page]!.width}/>}</ScrollView>
    </ScrollView></SafeAreaView></Modal>}
    {fieldView && draft && <Modal onRequestClose={()=>setFieldView(undefined)}><SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
      <Action title="Close source area" onPress={()=>setFieldView(undefined)}/><Text style={styles.heading}>{fieldView.label}</Text>
      <ZoomActions zoom={fieldZoom} onChange={setFieldZoom}/>
      {draft.pages[fieldView.page] && <><ScrollView horizontal>{(fieldView.region??fieldView.reviewRegion) && <ReadingStrip uri={draft.pages[fieldView.page]!.uri} region={(fieldView.region??fieldView.reviewRegion)!} width={width*fieldZoom} imageWidth={draft.pages[fieldView.page]!.width} imageHeight={draft.pages[fieldView.page]!.height}/>}</ScrollView>
        <ScrollView horizontal><ReadingImage uri={draft.pages[fieldView.page]!.uri} width={width*fieldZoom} height={width*fieldZoom*draft.pages[fieldView.page]!.height/draft.pages[fieldView.page]!.width} regions={(fieldView.region??fieldView.reviewRegion)?[(fieldView.region??fieldView.reviewRegion)!]:[]}/></ScrollView></>}
    </ScrollView></SafeAreaView></Modal>}
  </SafeAreaView>;
}

function ChoiceControl({field,value,disabled,onChange}:{field:FixedField;value:string;disabled:boolean;onChange:(value:string)=>void}) {
  return <View style={{gap:6}}>{field.options?.map(option=><Action key={option} title={`${value===option?'●':'○'} ${option}`} secondary disabled={disabled} onPress={()=>onChange(value===option?'':option)}/>)}</View>;
}
function ZoomActions({zoom,onChange}:{zoom:number;onChange:(value:number)=>void}) {
  return <View style={styles.row}><Action title="− Zoom" secondary disabled={zoom<=1} onPress={()=>onChange(Math.max(1,zoom-.5))}/>
    <Text style={styles.small}>{Math.round(zoom*100)}%</Text><Action title="+ Zoom" secondary disabled={zoom>=3} onPress={()=>onChange(Math.min(3,zoom+.5))}/></View>;
}

function FixedDiagnostics({draft,page}:{draft:FixedDraft;page:FixedPage}) {
  const [result,setResult]=useState<FixedExtraction>();const [progress,setProgress]=useState('');const [error,setError]=useState('');const [open,setOpen]=useState(false);
  const mounted=useRef(true);const running=useRef(false);const files=useRef(new Set<string>());const width=useWindowDimensions().width-48;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;for(const uri of files.current)void discardCache(uri).catch(()=>{});};},[]);
  async function inspect(){
    if(running.current)return;running.current=true;setError('');setProgress('Preparing diagnostic crops...');setResult(undefined);
    for(const uri of files.current)await discardCache(uri).catch(()=>{});files.current.clear();
    try{const value=await recognizeFixedPage(draft,page,text=>{if(mounted.current)setProgress(text);},uri=>{if(mounted.current)files.current.add(uri);else void discardCache(uri).catch(()=>{});});if(mounted.current){setResult(value);setOpen(true);}}
    catch{if(mounted.current)setError('Diagnostic reading failed. Check the saved page and crop.');}
    finally{running.current=false;if(mounted.current)setProgress('');}
  }
  return <View><Action title={progress||'Development: inspect SSS OCR inputs'} secondary disabled={!!progress} onPress={()=>{void inspect();}}/>
    {!!error && <Text style={styles.error}>{error}</Text>}
    <Modal visible={open} onRequestClose={()=>setOpen(false)}><SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
      <Action title="Close SSS diagnostics" onPress={()=>setOpen(false)}/><Text style={styles.heading}>Actual OCR source · {page.width} × {page.height}</Text>
      <Text style={styles.small}>Read-only inspection. Confidence is the actual ML Kit mean element confidence, when available. No overlays are baked into these images.</Text>
      <ReadingImage uri={page.uri} width={width} height={width*page.height/page.width}/>
      {result && Object.entries(result.diagnostics).map(([id,r])=>{const reading=result.run.fields[id];return <View key={id} style={{gap:8,paddingVertical:12}}>
        <Text style={styles.heading}>{sssTemplate.fields.find(f=>f.id===id)?.label}</Text><Text selectable style={styles.small}>{id}{'\n'}x={r.x}, y={r.y}, {r.sourceWidth} × {r.sourceHeight}; input {r.inputWidth} × {r.inputHeight}
          {'\n'}Original: {r.original.text||'(empty)'} · confidence {r.original.confidence??'unavailable'}{'\n'}Processed: {r.processed.text||'(empty)'} · confidence {r.processed.confidence??'unavailable'}
          {'\n'}Original normalized: {reading.originalNormalized||'(blank)'}{'\n'}Processed normalized: {reading.processedNormalized||'(blank)'}{'\n'}Segmented raw: {reading.segmentedText??'not used'}{'\n'}Segmented normalized: {reading.segmentedNormalized??'not used'}{'\n'}Proposal: {reading.normalized||'(blank)'}
          {'\n'}Review: {reading.warning||reading.error||'Format valid; human confirmation required.'}</Text>
        {Object.entries(r.diagnostics).map(([kind,uri])=><View key={kind}><Text style={styles.small}>{kind}</Text><Image source={{uri}} style={{width,height:120}} resizeMode="contain"/></View>)}
      </View>;})}
    </ScrollView></SafeAreaView></Modal>
  </View>;
}
