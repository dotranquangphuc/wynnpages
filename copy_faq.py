import re

with open('index.html', 'r') as f:
    idx_content = f.read()

# Extract from index.html (the FAQ container)
m = re.search(r'(<div[^>]*id="faq-accordion-container"[^>]*>.*</div></div>)\n</section>', idx_content, re.DOTALL)
if m:
    faq_html = m.group(1)
    # The faq_html contains the whole container and its items.
    
    with open('desktop.html', 'r') as f:
        desk_content = f.read()
    
    # Replace in desktop.html
    new_desk = re.sub(
        r'<!-- FAQ List Container -->\s*<div class="bg-white rounded-3xl[^>]*>.*?(?=</div>\n</section>)',
        '<!-- FAQ List Container -->\n' + faq_html,
        desk_content,
        flags=re.DOTALL
    )
    
    with open('desktop.html', 'w') as f:
        f.write(new_desk)
    print("Done replacing FAQ.")
else:
    print("Could not find faq in index.html")
