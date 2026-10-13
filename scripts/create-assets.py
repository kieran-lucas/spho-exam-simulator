"""Rebuild original application icon and scientific raster fixtures (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'fixtures' / 'source' / 'assets'
OUT.mkdir(parents=True, exist_ok=True)
ICON = ROOT / 'src-tauri' / 'icons'
ICON.mkdir(parents=True, exist_ok=True)
font_path = Path('C:/Windows/Fonts/arial.ttf')
font = ImageFont.truetype(str(font_path), 24) if font_path.exists() else ImageFont.load_default()
small = ImageFont.truetype(str(font_path), 18) if font_path.exists() else font

im = Image.new('RGB', (700, 420), 'white')
d = ImageDraw.Draw(im)
for x in range(100, 621, 130): d.line((x, 70, x, 340), fill='#e5eaf0')
for y in range(100, 341, 60): d.line((100, y, 620, y), fill='#e5eaf0')
d.line((100, 55, 100, 340, 650, 340), fill='#283448', width=3)
d.polygon([(100,48),(94,62),(106,62)],fill='#283448')
d.polygon([(657,340),(643,334),(643,346)],fill='#283448')
d.line((100,340,360,100,620,100),fill='#315c98',width=5)
for t in range(5): d.text((92+130*t,350),str(t),font=small,fill='#293444')
for v in range(5): d.text((65,330-60*v),str(v),font=small,fill='#293444')
d.text((28,18),'v (m/s)',font=font,fill='#293444')
d.text((585,380),'t (s)',font=font,fill='#293444')
im.save(OUT / 'velocity.png')

im = Image.new('RGB', (600, 360), 'white')
d=ImageDraw.Draw(im)
d.line((45,310,560,310),fill='#cdd5df',width=2)
d.line((100,40,100,310,560,310),fill='#293444',width=2)
d.text((30,10),'E (J)',font=font,fill='#293444')
d.text((525,323),'h (m)',font=small,fill='#293444')
d.line((100,310,500,70),fill='#315c98',width=4)
d.text((425,85),'U = mgh',font=font,fill='#315c98')
d.text((80,320),'0',font=small,fill='#293444')
im.save(OUT / 'energy.webp',format='WEBP',lossless=True)

im=Image.new('RGBA',(256,256),'#315c98');d=ImageDraw.Draw(im)
d.rounded_rectangle((9,9,247,247),radius=45,fill='#315c98',outline='#789bc9',width=3)
for angle in [0,math.pi/3,2*math.pi/3]:
    pts=[]
    for i in range(181):
        t=i*2*math.pi/180;x=90*math.cos(t);y=35*math.sin(t)
        pts.append((128+x*math.cos(angle)-y*math.sin(angle),128+x*math.sin(angle)+y*math.cos(angle)))
    d.line(pts,fill='#f4f8ff',width=5)
d.ellipse((116,116,140,140),fill='#f4f8ff')
im.save(ICON / 'icon.png');im.save(ICON / 'icon.ico',sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
print('Original scientific assets and icon generated.')
