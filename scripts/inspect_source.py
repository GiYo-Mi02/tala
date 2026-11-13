"""Losslessly inspect this scanned PDF's two Flate RGB images without external libraries.
This is source-specific, not a general PDF parser. Use PyMuPDF for final page rendering.
"""
from pathlib import Path
import re, zlib, struct, binascii

data = Path('references/beef-sy-2024-2025.pdf').read_bytes()
out = Path('tmp/pdfs'); out.mkdir(parents=True, exist_ok=True)
def chunk(kind, value):
    return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', binascii.crc32(kind + value) & 0xffffffff)
for i, m in enumerate(re.finditer(rb'<</Type/XObject/Subtype/Image/Width (\d+)/Height (\d+).*?/Length (\d+)>>\r\nstream\r\n', data), 1):
    w, h, n = map(int, m.groups())
    rgb = zlib.decompress(data[m.end():m.end() + n])
    assert len(rgb) == w * h * 3
    rows = b''.join(b'\0' + rgb[y*w*3:(y+1)*w*3] for y in range(h))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')
    (out / f'source-image-{i}.png').write_bytes(png)
    # The two embedded scans are sideways. Canonical template images are upright.
    upright = b''.join(rgb[((h-1-x)*w+y)*3:((h-1-x)*w+y)*3+3] for y in range(w) for x in range(h))
    rows = b''.join(b'\0' + upright[y*h*3:(y+1)*h*3] for y in range(w))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', h, w, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')
    (out / f'source-upright-{i}.png').write_bytes(png)
    print(i, w, h)
