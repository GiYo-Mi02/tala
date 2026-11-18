"""Static APK contents check. This does not replace physical-phone acceptance."""
from pathlib import Path
import hashlib, json, re, sys, zipfile, struct, zlib, io
root = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root / '.tools/python'))
from PIL import Image
version = json.loads((root / 'apps/scanner/app.json').read_text(encoding='utf-8'))['expo']['version']
apk = Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root / f'output/android/TALA-{version}.apk'
def png_content_hash(blob):
    # AAPT may convert RGB PNGs to indexed/grayscale encoding without changing
    # pixels. Compare decoded RGBA pixels and dimensions rather than PNG rows.
    with Image.open(io.BytesIO(blob)) as source:
        pixels=source.convert('RGBA')
        return hashlib.sha256(struct.pack('>II',*pixels.size)+pixels.tobytes()).hexdigest()
with zipfile.ZipFile(apk) as archive:
    names = archive.namelist()
    bundle = [n for n in names if n.endswith('index.android.bundle')]
    expected_pages={png_content_hash((root/f'apps/scanner/assets/beef-page-{page}.png').read_bytes()):page for page in (1,2)}
    expected_sss={png_content_hash((root/f'apps/scanner/assets/sss-e1-page-{page}.png').read_bytes()):page for page in (1,2,3)}
    sss_pages=[]
    pages=[]
    for info in archive.infolist():
        if not info.filename.endswith('.png'): continue
        payload_hash=png_content_hash(archive.read(info.filename))
        if payload_hash in expected_pages:
            pages.append({'page':expected_pages[payload_hash],'resource':info.filename,'image_content_sha256':payload_hash})
        if payload_hash in expected_sss:
            sss_pages.append({'page':expected_sss[payload_hash],'resource':info.filename,'image_content_sha256':payload_hash})
    pages.sort(key=lambda p:p['page'])
    sss_pages.sort(key=lambda p:p['page'])
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
                  arm_only_release=abis==['arm64-v8a','armeabi-v7a'],all_sss_reference_pages=[p['page'] for p in sss_pages]==[1,2,3],
                  no_sss_test_fixtures=not any('sss-clean' in n or 'sss-mapping.json' in n for n in names))
    checks.update(
        native_sync_in_dex=any(b'TalaSyncModule' in dex for dex in dex_payloads),
        sync_worker_in_dex=any(b'Lexpo/modules/talasync/SyncWorker;' in dex for dex in dex_payloads),
        sync_database_in_dex=any(b'SyncOutboxDatabase_Impl' in dex for dex in dex_payloads),
        sync_controls_in_bundle=any(
            all(label in archive.read(name) for label in (
                b'Submission history and sign-in', b'Submit for synchronization'
            ))
            for name in bundle
        ),
    )
    result = {'apk':str(apk.relative_to(root)), 'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(), 'bytes':apk.stat().st_size,
              'checks':checks,'bundle':bundle,'template_images':pages,'sss_reference_images':sss_pages,'image_hash_scheme':'decoded-rgba-v1','latin_model_assets':models,'abis':abis,
              'physical_phone_acceptance':'Not run - Samsung Galaxy A53 5G designated; Android version and build pending'}
    (root / (sys.argv[2] if len(sys.argv)>2 else 'docs/evidence/apk-inspection.json')).write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
    if not all(checks.values()): raise SystemExit('APK contents check failed. Inspect the archive before handoff.')
