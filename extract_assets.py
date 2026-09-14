import re
import os

html_path = '/Users/wynndo/wynnpages/index.html'

with open(html_path, 'r', encoding='utf-8') as f:
    html = f.read()

# Extract styles
styles = re.findall(r'<style[^>]*>(.*?)</style>', html, flags=re.DOTALL)
if styles:
    os.makedirs('/Users/wynndo/wynnpages/css', exist_ok=True)
    with open('/Users/wynndo/wynnpages/css/style.css', 'w', encoding='utf-8') as f:
        f.write('\n'.join(styles))
    # Remove original style tags
    html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL)
    # Add link to head
    html = html.replace('</head>', '    <link rel="stylesheet" href="/css/style.css">\n</head>')

# Extract scripts
scripts = re.findall(r'<script(?! src)[^>]*>(.*?)</script>', html, flags=re.DOTALL)
if scripts:
    os.makedirs('/Users/wynndo/wynnpages/js', exist_ok=True)
    with open('/Users/wynndo/wynnpages/js/script.js', 'w', encoding='utf-8') as f:
        f.write('\n'.join(scripts))
    # Remove original script tags
    html = re.sub(r'<script(?! src)[^>]*>.*?</script>', '', html, flags=re.DOTALL)
    # Add script to body end
    html = html.replace('</body>', '    <script src="/js/script.js"></script>\n</body>')

with open(html_path, 'w', encoding='utf-8') as f:
    f.write(html)
print("Extracted CSS and JS.")
