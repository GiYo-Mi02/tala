"""Static APK contents check. This does not replace physical-phone acceptance."""
from pathlib import Path
import hashlib, json, re, sys, zipfile, struct, zlib
root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'apps/scanner/app.json').read_text(encoding='utf-8'))['expo']['version']
apk = Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root / f'output/android/TALA-Phase1-{version}.apk'
def png_content_hash(blob):
    if blob[:8] != b'\x89PNG\r\n\x1a\n': raise ValueError('Not a PNG')
    offset=8; critical={}; image_data=[]
    while offset+12<=len(blob):
        length=struct.unpack('>I',blob[offset:offset+4])[0]
        kind=blob[offset+4:offset+8]; body=blob[offset+8:offset+8+length]
        if kind==b'IDAT': image_data.append(body)
        elif kind in (b'IHDR',b'PLTE',b'tRNS'): critical[kind]=body
        offset+=length+12
        if kind==b'IEND': break
    # AAPT renames resources and removes density metadata. Compare the actual image payload.
    pixels=zlib.decompress(b''.join(image_data))
    return hashlib.sha256(b''.join(critical.get(k,b'') for k in (b'IHDR',b'PLTE',b'tRNS'))+pixels).hexdigest()
with zipfile.ZipFile(apk) as archive:
    names = archive.namelist()
    bundle = [n for n in names if n.endswith('index.android.bundle')]
    expected_pages={png_content_hash((root/f'apps/scanner/assets/beef-page-{page}.png').read_bytes()):page for page in (1,2)}
    pages=[]
    for info in archive.infolist():
        if not info.filename.endswith('.png') or info.file_size<300000: continue
        payload_hash=png_content_hash(archive.read(info.filename))
        if payload_hash in expected_pages:
            pages.append({'page':expected_pages[payload_hash],'resource':info.filename,'image_content_sha256':payload_hash})
    pages.sort(key=lambda p:p['page'])
    models = [n for n in names if 'mlkit' in n.lower() and ('latin' in n.lower() or 'latn' in n.lower())]
    ocr_class = any(b'TalaOcrModule' in archive.read(n) for n in names if re.fullmatch(r'classes\d*\.dex',n))
    alignment_class = any(b'expo/modules/talaocr/Perspective' in archive.read(n) for n in names if re.fullmatch(r'classes\d*\.dex',n))
    preprocessing_class = any(b'expo/modules/talaocr/FieldImage' in archive.read(n) for n in names if re.fullmatch(r'classes\d*\.dex',n))
    dedup_class = any(b'expo/modules/talaocr/ReadingResult' in archive.read(n) for n in names if re.fullmatch(r'classes\d*\.dex',n))
    abis = sorted({n.split('/')[1] for n in names if n.startswith('lib/') and n.endswith('.so')})
    dex_payloads=[archive.read(n) for n in names if re.fullmatch(r'classes\d*\.dex',n)]
    scanner_class=any(b'DocumentScannerActivity' in payload and b'DocumentDetector' in payload for payload in dex_payloads)
    opencv_abis=[abi for abi in abis if f'lib/{abi}/libopencv_java4.so' in names]
    checks = {'embedded_android_bundle':bool(bundle),'both_beef_pages':[p['page'] for p in pages]==[1,2],'bundled_latin_model_assets':bool(models),'local_ocr_module_in_dex':ocr_class,'perspective_module_in_dex':alignment_class,'field_preprocessing_in_dex':preprocessing_class,'native_roi_in_dex':any(b'expo/modules/talaocr/FieldRoiOcr' in payload for payload in dex_payloads),'geometry_dedup_in_dex':dedup_class,'arm64_native_libraries':'arm64-v8a' in abis,'no_instrumentation_fixtures':not any(n.endswith(('clean-page-1.png','clean.json','ocr-regions.json')) for n in names)}
    checks.update(native_scanner_in_dex=scanner_class,bundled_opencv_all_abis=bool(abis) and opencv_abis==abis,
                  arm_only_release=abis==['arm64-v8a','armeabi-v7a'])
    result = {'apk':str(apk.relative_to(root)), 'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(), 'bytes':apk.stat().st_size,
              'checks':checks,'bundle':bundle,'template_images':pages,'latin_model_assets':models,'abis':abis,
              'physical_phone_acceptance':'Not run - Samsung Galaxy A53 5G designated; Android version and build pending'}
    (root / (sys.argv[2] if len(sys.argv)>2 else 'docs/evidence/apk-inspection.json')).write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
    if not all(checks.values()): raise SystemExit('APK contents check failed. Inspect the archive before handoff.')
