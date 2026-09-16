import re

with open('index.html', 'r') as f:
    index_html = f.read()

with open('desktop.html', 'r') as f:
    desktop_html = f.read()

# Extract from index.html
client_cats = re.search(r'<!-- BEGIN: ClientCategoriesSection -->(.*?)<!-- END: ClientCategoriesSection -->', index_html, re.DOTALL).group(0)
swipe_app = re.search(r'<!-- BEGIN: SwipeApprovalSection -->(.*?)<!-- END: SwipeApprovalSection -->', index_html, re.DOTALL).group(0)
pricing_indep = re.search(r'<!-- BEGIN: PricingAndIndependenceSection -->(.*?)<!-- END: PricingAndIndependenceSection -->', index_html, re.DOTALL).group(0)
footer = re.search(r'<!-- BEGIN: MainFooter -->(.*?)<!-- END: MainFooter -->', index_html, re.DOTALL).group(0)

# Modify for desktop layout
client_cats = client_cats.replace('grid-cols-2', 'grid-cols-2 lg:grid-cols-4 lg:gap-6')
client_cats = client_cats.replace('max-w-xs', 'max-w-xl')

swipe_app = swipe_app.replace('flex-col items-center', 'flex-col lg:flex-row items-center lg:items-center justify-center lg:gap-16 max-w-6xl mx-auto')
swipe_app = swipe_app.replace('mb-6 reveal-on-scroll', 'mb-6 lg:mb-0 lg:text-left lg:max-w-md reveal-on-scroll')
swipe_app = swipe_app.replace('max-w-xs mx-auto', 'max-w-xs lg:mx-0')
swipe_app = swipe_app.replace('text-center mb-6', 'lg:text-left mb-6')

# Contrast (The Honest Contrast): make it side-by-side
contrast_section = re.search(r'<div class="space-y-4">.*?</div></div></div>', pricing_indep, re.DOTALL).group(0)
new_contrast = contrast_section.replace('space-y-4', 'space-y-4 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0 max-w-5xl mx-auto')
pricing_indep = pricing_indep.replace(contrast_section, new_contrast)

contrast_only = re.search(r'<!-- Contrast Section.*?</div></div></div>', pricing_indep, re.DOTALL).group(0)
# Wrap it in a section
contrast_only = '<section class="w-full bg-sand-surface py-20 lg:py-28">\n<div class="max-w-7xl mx-auto px-margin-mobile lg:px-margin">\n' + contrast_only + '\n</div>\n</section>'

# Wrappers
client_cats = '<section class="w-full bg-cream-canvas py-20 lg:py-28">\n<div class="max-w-7xl mx-auto px-margin-mobile lg:px-margin">\n' + client_cats + '\n</div>\n</section>'
swipe_app = '<section class="w-full bg-sand-surface py-20 lg:py-28 overflow-hidden">\n<div class="max-w-7xl mx-auto px-margin-mobile lg:px-margin">\n' + swipe_app + '\n</div>\n</section>'

desktop_parts = desktop_html.split('<!-- SECTION 8: PRICING (Deep Purple Cutting-Mat Canvas) -->')
if len(desktop_parts) == 2:
    new_desktop_html = desktop_parts[0] + '\n<!-- INJECTED DESKTOP SECTIONS -->\n' + client_cats + '\n' + swipe_app + '\n' + contrast_only + '\n<!-- SECTION 8: PRICING (Deep Purple Cutting-Mat Canvas) -->' + desktop_parts[1]
else:
    print("Could not find SECTION 8 in desktop.html")
    exit(1)

footer_desktop = re.search(r'<footer.*?</footer>', new_desktop_html, re.DOTALL)
if footer_desktop:
    new_desktop_html = new_desktop_html.replace(footer_desktop.group(0), footer)
else:
    print("Could not find footer in desktop.html")

# Fix hero subheadline (the first issue mentioned by the user - "Sync it with the mobile version")
# We just need to replace the desktop hero block with the mobile hero block but keep the parallax wrapper.
desktop_hero_text = re.search(r'<h1.*?</h1>\s*<p.*?</p>', new_desktop_html, re.DOTALL)
mobile_hero_text = re.search(r'<h1 class="font-editorial.*?</h1>\s*<p.*?</p>', index_html, re.DOTALL)
if desktop_hero_text and mobile_hero_text:
    new_desktop_html = new_desktop_html.replace(desktop_hero_text.group(0), mobile_hero_text.group(0))

with open('desktop.html', 'w') as f:
    f.write(new_desktop_html)

print("Desktop HTML synced!")
