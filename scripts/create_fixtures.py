"""Create clearly fictional typed forms over the actual upright BEEF scans.
Install scripts/requirements-pdf.txt into .tools/python or a venv first.
"""
from pathlib import Path
import sys, json, hashlib
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import fitz

output = root / 'output/pdf'; output.mkdir(parents=True, exist_ok=True)
images = root / 'fixtures/images'; images.mkdir(parents=True, exist_ok=True)
proof = root / 'docs/evidence/fixtures'; proof.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype('C:/Windows/Fonts/courbd.ttf', 23)
small = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 17)
def boxes(draw, text, x, y, step, height=30):
    for i, letter in enumerate(text):
        bounds = draw.textbbox((0, 0), letter, font=font)
        draw.text((x+i*step+(step-(bounds[2]-bounds[0]))/2, y+(height-(bounds[3]-bounds[1]))/2-bounds[1]), letter, font=font, fill='black')

for expected_path in sorted((root / 'fixtures/expected').glob('*.json')):
    fixture = json.loads(expected_path.read_text())
    if 'raw' not in fixture: continue
    name = fixture['fixture']; values = fixture['raw']
    pages = [Image.open(root / f'apps/scanner/assets/beef-page-{n}.png').convert('RGB') for n in (1, 2)]
    # Overlay on the original scan coordinate system, then apply the PDF's measured image placement.
    overlays = [Image.new('RGBA', (1060,1495)), Image.new('RGBA',(1024,1483))]
    draw = ImageDraw.Draw(overlays[0])
    years = values['school_year'].split('-')
    boxes(draw, years[0], 213, 218, 24.5, 29); boxes(draw, years[1], 342, 218, 24.5, 29)
    boxes(draw, values['grade_level'], 342, 287, 24, 28)
    boxes(draw, values['lrn'], 617, 252, 24.5, 27)
    for key, y in [('learner_last_name', 471), ('learner_first_name', 541), ('learner_middle_name', 611)]:
        boxes(draw, values[key], 82, y, 29.35)
    month, day, year = values['birth_date'].split('/')
    boxes(draw, month, 708, 471, 28); boxes(draw, day, 792, 471, 28); boxes(draw, year, 876, 471, 28)
    # Legal guardian name is deliberately different and sits far below the learner rows.
    draw.text((94, 1380), 'TORRES', font=small, fill='black')
    draw.text((319, 1380), 'MARCELA', font=small, fill='black')
    page2 = ImageDraw.Draw(overlays[1])
    page2.text((170, 1215), fixture['guardian_name'] + ' - TEST ONLY', font=small, fill='black')
    page2.text((719, 1215), '06/03/2024', font=small, fill='black')
    placements = [(-11.95501708984375,7.3599853515625,611.75,862.5900268554688),(-11.39898681640625,-19.82000732421875,593.8499755859375,860.8499755859375)]
    for image,overlay,(x,y,w,h) in zip(pages,overlays,placements):
        sx = image.width/595.4000244140625; sy = image.height/841.7999877929688
        positioned = overlay.resize((round(w*sx),round(h*sy)),Image.Resampling.LANCZOS)
        image.paste(positioned,(round(x*sx),round(y*sy)),positioned)
    pdf_path = output / f'beef-{name}.pdf'
    pdf = canvas.Canvas(str(pdf_path), pagesize=(595.4000244140625, 841.7999877929688), pageCompression=1)
    pdf.setTitle(f'TALA FICTIONAL TEST - {name}')
    for index, image in enumerate(pages, 1):
        draw = ImageDraw.Draw(image)
        draw.text((82, image.height - 25), f'FICTIONAL TEST ONLY | {name.upper()} | PAGE {index}/2', font=small, fill=(110, 20, 20))
        image.save(images / f'{name}-page-{index}.png')
        pdf.drawImage(ImageReader(image), 0, 0, width=595.4000244140625, height=841.7999877929688)
        pdf.showPage()
    pdf.save()
    rendered = fitz.open(pdf_path)
    assert len(rendered) == 2
    for i, p in enumerate(rendered, 1): p.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(proof / f'{name}-page-{i}.png')
    print(pdf_path.relative_to(root), hashlib.sha256(pdf_path.read_bytes()).hexdigest())

# Visual mapping proof based on the source image.
mapping = Image.open(root / 'apps/scanner/assets/beef-page-1.png').convert('RGB')
draw = ImageDraw.Draw(mapping)
for x, y, w, h in [(215,219,95,27),(344,219,94,27),(344,288,44,26),(619,253,290,26),(84,472,582,29),(84,542,582,29),(84,612,582,30),(710,472,51,29),(794,472,51,29),(878,472,107,29)]:
    sx=1060/595.4000244140625; sy=1499/841.7999877929688
    px=(-11.95501708984375+x/1060*611.75)*sx; py=(7.3599853515625+y/1495*862.5900268554688)*sy
    draw.rectangle((px,py,px+w/1060*611.75*sx,py+h/1495*862.5900268554688*sy),outline=(0,170,130),width=3)
mapping.save(root / 'docs/evidence/mapping-overlay.png')
