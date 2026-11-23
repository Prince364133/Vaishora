# Renders flat hand silhouettes (palm/back) used by the static fallback and thumbnails.
from playwright.sync_api import sync_playwright
import pathlib
root = pathlib.Path(__file__).resolve().parent
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={'width': 800, 'height': 800})
    for side in ['palm', 'back']:
        d = (root / 'out' / f'silhouette-{side}.path.txt').read_text()
        tone = '#d9a284' if side == 'palm' else '#c98f6c'
        html = f"""<html><body style='margin:0;background:transparent'>
        <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 1000' width='800' height='800'>
          <defs>
            <radialGradient id='g' cx='50%' cy='55%' r='60%'><stop offset='0' stop-color='#ffffff' stop-opacity='0.16'/><stop offset='1' stop-color='#000000' stop-opacity='0.10'/></radialGradient>
            <filter id='s' x='-10%' y='-10%' width='120%' height='120%'><feGaussianBlur stdDeviation='0.6'/></filter>
          </defs>
          <g filter='url(#s)'><path d='{d}' fill='{tone}' stroke='{tone}' stroke-width='1.2' stroke-linejoin='round'/></g>
          <path d='{d}' fill='url(#g)' stroke='none'/>
        </svg></body></html>"""
        pg.set_content(html)
        pg.screenshot(path=str(root.parent / 'public' / 'hand' / f'{side}.png'), omit_background=True)
    b.close()
print('ok')
