import re

with open('index.html', 'r') as f:
    idx_content = f.read()

# Try to extract the 8 Q&As safely. 
# index.html FAQ items have the structure:
# <div class="faq-item ..."><button ...><span ...>01</span><span ...>Question</span>...<div class="faq-grid-content ..."><div ...><div ...><p>Answer part 1</p><p>Answer part 2</p>
items = re.findall(r'<div class="faq-item[^>]*>(.*?)</div></div></div></div>', idx_content, re.DOTALL)
faq_items = []
for item in items:
    # question text is inside <span class="font-editorial ...">Question</span>
    q_match = re.search(r'<span class="font-editorial[^>]*>(.*?)</span>', item)
    # answers are inside <p ...>Answer</p>
    p_matches = re.findall(r'<p[^>]*>(.*?)</p>', item, re.DOTALL)
    
    if q_match and p_matches:
        q = q_match.group(1).strip()
        ans = p_matches[0].strip()
        if len(p_matches) > 1:
            ans += f'\n<br><br>{p_matches[1].strip()}'
        faq_items.append((q, ans))

if len(faq_items) != 8:
    print(f"Error: Found {len(faq_items)} items instead of 8")
else:
    old_faq_container_start = '<!-- FAQ List Container -->\n<div class="bg-white rounded-3xl shadow-sm border border-outline-variant/20 overflow-hidden divide-y divide-outline-variant/20">\n'
    old_faq_container_end = '</div>\n'

    new_faq_html = old_faq_container_start
    for i, (q, ans) in enumerate(faq_items):
        new_faq_html += f'''<!-- Q{i+1} -->
<div class="faq-item p-6">
<button class="faq-toggle w-full flex items-center justify-between text-left font-headline-sm text-headline-sm font-medium text-deep-charcoal hover:text-primary transition-colors">
<span class="">{i+1}. {q}</span>
<span class="material-symbols-outlined text-primary text-[24px] transform transition-transform duration-300">expand_more</span>
</button>
<div class="faq-content hidden pt-4 text-charcoal-muted font-body-md text-body-md leading-relaxed">
            {ans}
          </div>
</div>
'''
    new_faq_html += old_faq_container_end

    with open('desktop.html', 'r') as f:
        desk_content = f.read()

    # Replace the current FAQ list container in desktop.html
    # It might be the old one, starting with: <div class="bg-white rounded-3xl shadow-sm
    new_desk, count = re.subn(
        r'<!-- FAQ List Container -->\s*<div class="bg-white rounded-3xl[^>]*>.*?(?=</div>\n</section>)',
        new_faq_html,
        desk_content,
        flags=re.DOTALL
    )
    
    if count == 0:
        print("Regex failed to match old container!")
    else:
        with open('desktop.html', 'w') as f:
            f.write(new_desk)
        print("Done restoring old FAQ design with new content.")
