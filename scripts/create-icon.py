"""Rebuild the desktop icon using Pillow (development only)."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / 'build'
image = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((28, 28, 996, 996), radius=212, fill='#20221f')
draw.line([(125, 715), (125, 193), (801, 193), (899, 291), (899, 715)], fill='#64715a', width=3)
draw.polygon([(228,294),(353,294),(472,453),(592,294),(718,294),(537,530),(718,767),(591,767),(471,607),(351,767),(225,767),(407,530)], fill='#f3f2e7')
draw.rectangle((679,742,840,797), fill='#fa5d32')
draw.line([(757,208),(807,208),(807,258)], fill='#fa5d32', width=5)
draw.line([(782,208),(782,258)], fill='#fa5d32', width=5)
draw.line([(127,810),(127,852),(169,852)], fill='#fa5d32', width=5)
draw.line([(183,876),(522,876)], fill='#64715a', width=3)
draw.line([(183,887),(408,887)], fill='#64715a', width=3)
for x in [705,713,725,731,737,750,755,764,773,778,791,796,805,813,818,827]:
    draw.line([(x,868),(x,899)], fill='#a7b09b', width=3)
image.save(root / 'icon.png')
image.save(root / 'icon.icns', sizes=[(16,16),(32,32),(64,64),(128,128),(256,256),(512,512),(1024,1024)])
image.save(root / 'icon.ico', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
print('Created build/icon.png, build/icon.icns, build/icon.ico')
