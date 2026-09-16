import re

desktop_new = '''<!-- SECTION 10: MY PERSONAL PROMISE (The Artisan's Guarantee) -->
<section class="w-full bg-background py-20 lg:py-28 reveal-on-scroll" id="artisans-guarantee">
<div class="max-w-4xl mx-auto px-margin-mobile lg:px-margin">
<div class="interactive-card bg-[#fbf8f2]/95 backdrop-blur-md rounded-3xl p-10 lg:p-16 border border-amber-200/60 shadow-card-float relative overflow-hidden text-center">
<div class="absolute -right-12 -bottom-12 w-48 h-48 bg-gold-400/10 rounded-full blur-3xl pointer-events-none"></div>
<div class="w-14 h-14 mx-auto rounded-full bg-gold-400/20 border border-gold-500 flex items-center justify-center text-gold-600 text-base font-bold mb-5 shadow-xs">
<svg aria-hidden="true" class="w-7 h-7 transition-transform duration-300 hover:scale-110" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L15 8L16.5 13.5L12 22L7.5 13.5L9 8L12 2Z" fill="#c26549" fill-opacity="0.18" stroke="#b8581f" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><path d="M12 2V12" stroke="#b8581f" stroke-linecap="round" stroke-width="1.5"></path><circle cx="12" cy="12.5" fill="#b8581f" r="1"></circle></svg>
</div>
<span class="text-[12px] font-bold uppercase tracking-widest text-terracotta-500 block mb-3">The Artisan's Guarantee</span>
<h3 class="font-editorial text-4xl lg:text-5xl font-bold text-stone-900 mb-8">My Personal Promise.</h3>
<div class="max-w-2xl mx-auto mb-10 text-center" id="promise-text-container" style="font-family: Caveat, cursive;">
<p class="text-3xl lg:text-4xl font-medium tracking-wide transition-all duration-700 mb-6 ink-reveal-para" style="color: rgb(35, 31, 29); line-height: 1.35; letter-spacing: 0.02em;">
<span class="ink-word">When</span> <span class="ink-word">you</span> <span class="ink-word">choose</span> <span class="ink-word">WynnPages,</span> <span class="ink-word">you</span> <span class="ink-word">aren't</span> <span class="ink-word">dealing</span> <span class="ink-word">with</span> <span class="ink-word">a</span> <span class="ink-word">faceless</span> <span class="ink-word">agency.</span> <span class="ink-word">You</span> <span class="ink-word">are</span> <span class="ink-word">working</span> <span class="ink-word">directly</span> <span class="ink-word">with</span> <span class="ink-word">the</span> <span class="ink-word">person</span> <span class="ink-word">who</span> <span class="ink-word">designs</span> <span class="ink-word">and</span> <span class="ink-word">codes</span> <span class="ink-word">your</span> <span class="ink-word">site.</span>
</p>
<p class="text-3xl lg:text-4xl font-medium tracking-wide transition-all duration-700 ink-reveal-para" style="color: rgb(35, 31, 29); line-height: 1.35; letter-spacing: 0.02em;">
<span class="ink-word">I</span> <span class="ink-word">take</span> <span class="ink-word">immense</span> <span class="ink-word">personal</span> <span class="ink-word">pride</span> <span class="ink-word">in</span> <span class="ink-word">every</span> <span class="ink-word">digital</span> <span class="ink-word">home</span> <span class="ink-word">I</span> <span class="ink-word">build.</span> <span class="ink-word">If</span> <span class="ink-word">something</span> <span class="ink-word">isn't</span> <span class="ink-word">right,</span> <span class="ink-word">I</span> <span class="ink-word">am</span> <span class="ink-word">just</span> <span class="ink-word">a</span> <span class="ink-word">direct</span> <span class="ink-word">email</span> <span class="ink-word">away.</span> <span class="ink-word">Honest</span> <span class="ink-word">work,</span> <span class="ink-word">crafted</span> <span class="ink-word">for</span> <span class="ink-word">good.</span>
</p>
</div>
<div class="pt-8 border-t border-parchment-200/70">
<div class="flex flex-col items-center justify-center">
<img loading="lazy" decoding="async" alt="Wynn's authentic signature" class="h-24 lg:h-28 w-auto object-contain mx-auto mb-4 signature-wipe" id="guarantee-signature" src="assets/asset_045038e2.jpg">
<p class="font-editorial text-base text-parchment-800 font-medium signature-signoff" id="guarantee-signoff">Cheers, <span class="font-editorial italic text-2xl font-bold text-[#b8581f] inline-block hover:scale-105 transition-transform">Wynn</span> — Apple Designer &amp; Creator of WynnPages.</p>
</div>
</div>
</div>
</div>
</section>'''

with open('desktop.html', 'r') as f:
    content = f.read()

# Replace SECTION 10 in desktop.html
new_content, count = re.subn(
    r'<!-- SECTION 10: MY PERSONAL PROMISE \(The Artisan\'s Guarantee\) -->.*?</section>',
    desktop_new,
    content,
    flags=re.DOTALL
)

if count == 0:
    print("Could not find section 10")
else:
    with open('desktop.html', 'w') as f:
        f.write(new_content)
    print("Updated Section 10")
