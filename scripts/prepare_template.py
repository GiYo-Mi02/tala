"""Render the entire PDF page, retaining its printed margins and clipping."""
from pathlib import Path
import sys, json, hashlib
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
import fitz
source = root / 'references/beef-sy-2024-2025.pdf'
doc = fitz.open(source)
evidence = {'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'pages': []}
for number, page in enumerate(doc, 1):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(1060/page.rect.width,1060/page.rect.width), alpha=False)
    pixmap.save(root / f'apps/scanner/assets/beef-page-{number}.png')
    evidence['pages'].append({'page':number,'width':pixmap.width,'height':pixmap.height,'text':page.get_text(),
        'widgets':len(list(page.widgets() or [])),'image_placements':page.get_image_info()})
(root / 'docs/evidence/source-pdf.json').write_text(json.dumps(evidence,indent=2))
print([(p['page'],p['width'],p['height']) for p in evidence['pages']])
