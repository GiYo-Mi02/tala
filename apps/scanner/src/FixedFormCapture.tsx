import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,BackHandler,ScrollView,Text,View,useWindowDimensions} from 'react-native';
import {type FixedTemplate,type FixedPage,type Corners} from '@tala/core';
import * as Crypto from 'expo-crypto';
import TalaOcr from '../modules/tala-ocr';
import {scannerConfig,type NativeScan,type Candidate} from './captureSupport';
import {Crop} from './Alignment';
import {ReadingImage} from './ReadingImage';
import {discardCache} from './repository';
import {Action,styles} from './ui';

export function FixedFormCapture({template,pageNumber,onAccept,onCancel}:{template:FixedTemplate;pageNumber:1|3;
  onAccept:(page:FixedPage)=>Promise<void>;onCancel:()=>void}) {
  const [scan,setScan]=useState<NativeScan>();const [candidate,setCandidate]=useState<Candidate>();
  const [manual,setManual]=useState(false);const [busy,setBusy]=useState(false);const [progress,setProgress]=useState('Opening scanner...');
  const [error,setError]=useState('');const [agreed,setAgreed]=useState(false);const [imageFailed,setImageFailed]=useState(false);
  const mounted=useRef(true);const started=useRef(false);const operation=useRef(false);const owned=useRef(new Set<string>());
  const close=useRef(onCancel);close.current=onCancel;
  const width=useWindowDimensions().width-40;
  const slot=template.pages.find(p=>p.number===pageNumber)!;
  useEffect(()=>{
    mounted.current=true;if(!started.current){started.current=true;void open();}
    const listener=BackHandler.addEventListener('hardwareBackPress',()=>{if(!operation.current)close.current();return true;});
    return()=>{mounted.current=false;listener.remove();for(const uri of owned.current)void discardCache(uri).catch(()=>{});};
  },[]);
  async function open(){
    if(operation.current)return;operation.current=true;setBusy(true);setProgress('Opening scanner...');setError('');
    try{
      const result=await TalaOcr.scanDocument(JSON.stringify(scannerConfig));
      if(!result){if(mounted.current && !scan)close.current();return;}
      const next=JSON.parse(result) as NativeScan;
      const keep=new Set([next.rawUri,next.source.uri,next.processed?.uri].filter((u):u is string=>!!u));
      for(const uri of keep)owned.current.add(uri);
      if(!mounted.current){for(const uri of owned.current)await discardCache(uri).catch(()=>{});return;}
      for(const uri of owned.current)if(!keep.has(uri)){await discardCache(uri).catch(()=>{});owned.current.delete(uri);}
      setScan(next);setAgreed(false);setImageFailed(false);
      if(next.processed && next.corners && typeof next.confidence==='number')setCandidate({...next.processed,alignment:{method:'opencv-auto-v1',
        sourceWidth:next.source.width,sourceHeight:next.source.height,corners:next.corners,confidence:next.confidence}});
      else {setCandidate(undefined);setError(next.reason??'Retake or adjust the paper corners.');}
    }catch{if(mounted.current)setError('The scanner could not open. Try again.');}
    finally{operation.current=false;if(mounted.current){setBusy(false);setProgress('');}}
  }
  async function accept(){
    if(!candidate?.alignment || operation.current || !agreed)return;
    operation.current=true;setBusy(true);setError('');setProgress('Reading fields and saving locally...');
    try{await onAccept({...candidate,page:pageNumber,imageId:Crypto.randomUUID(),acceptedAt:new Date().toISOString(),alignment:candidate.alignment});}
    catch(e){if(mounted.current)setError(e instanceof Error?e.message:'This image could not be saved. Retry.');}
    finally{operation.current=false;if(mounted.current){setBusy(false);setProgress('');}}
  }
  if(manual && scan)return <Crop photo={scan.source} page={pageNumber} busy={busy} showReadingRegions={false} retainSource transferAccepted
    suggestedCorners={scan.suggestedCorners??scan.corners} onCancel={()=>setManual(false)} onWorkingChange={setBusy}
    onAccept={async value=>{owned.current.add(value.uri);if(mounted.current){setCandidate(value);setManual(false);setAgreed(false);setImageFailed(false);}}}/>;
  const image=candidate??scan?.source;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Text style={styles.eyebrow}>SSS E-1 · PAGE {pageNumber}</Text><Text style={styles.heading}>{slot.label}</Text>
    {!!progress && <View style={styles.row}><ActivityIndicator/><Text style={styles.body}>{progress}</Text></View>}
    {image && <ReadingImage uri={image.uri} width={width} height={width*image.height/image.width}
      regions={candidate?template.fields.filter(f=>f.page===pageNumber && f.mode==='ocr' && f.region).map(f=>f.region!):[]}
      onError={()=>setImageFailed(true)}/>}
    <Text style={styles.body}>Compare this with the supplied E-1 page. Keep the whole paper upright; every green region must cover the matching answer area. Overlays are not sent to OCR.</Text>
    {!!scan?.warning && <Text style={styles.warning}>{scan.warning}</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {imageFailed && <Text style={styles.error}>This image could not be opened. Retake it.</Text>}
    <Action title={`${agreed?'✓':'□'} I checked the correct E-1 page and answer regions`} secondary disabled={busy||!candidate} onPress={()=>setAgreed(v=>!v)}/>
    <Action title="Accept page and read fields" disabled={busy||!candidate||!agreed||imageFailed} onPress={()=>{void accept();}}/>
    <Action title="Retake" secondary disabled={busy} onPress={()=>{void open();}}/>
    {scan && scan.allowManual!==false && <Action title="Adjust crop / orientation" secondary disabled={busy} onPress={()=>setManual(true)}/>}
    <Action title="Cancel capture" secondary disabled={busy} onPress={onCancel}/>
  </ScrollView>;
}
