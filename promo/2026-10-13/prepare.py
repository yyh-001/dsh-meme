from pathlib import Path
from PIL import Image
import json, shutil

root = Path(__file__).resolve().parent
repo = root.parent.parent
tex = root / 'public/textures'
# Freeze only publicly documented visual sources. Crop away account statistics.
chat = Image.open(repo / 'docs/chat-example.png')
chat.crop((1340, 30, 1750, 430)).save(tex / 'chat-user.png')
chat.crop((35, 610, 1050, 1030)).save(tex / 'chat-ai.png')
layout = {}
for name in ['quick-picker', 'panel-library', 'panel-discover']:
    im = Image.open(tex / f'{name}.png').convert('RGB')
    # Screenshot texture retains its real aspect ratio. Canvas is 2x 1920x1080.
    canvas = Image.new('RGB', (3840, 2160), '#f5f5f7')
    display_h = 920
    display_w = display_h * im.width / im.height
    x, y = (1920-display_w)/2, (1080-display_h)/2
    im = im.resize((round(display_w*2), round(display_h*2)), Image.Resampling.LANCZOS)
    canvas.paste(im, (round(x*2), round(y*2)))
    canvas.save(tex / f'{name}-page.png')
    layout[name] = {'x': x, 'y': y, 'w': display_w, 'h': display_h, 'pageH':1080,
                    'source':f'docs/{name}.png', 'sourceResolution': list(Image.open(tex/f'{name}.png').size)}
(tex/'layout.json').write_text(json.dumps(layout,ensure_ascii=False,indent=2),encoding='utf-8')
shutil.copy2(repo / 'memes/dafeiyu-001/manifest.json', root / 'references/meme-manifest.json')
print('Frozen screenshots, two safe chat cutouts, and layout.json prepared.')
