/** @type {import('tailwindcss').Config} */
module.exports = { content: ["./index.html"], darkMode: "class", theme: { extend: { "boxShadow": {
            "glow-soft": "0 10px 35px -5px rgba(212, 155, 40, 0.15)",
            "card-float": "0 20px 40px -15px rgba(58, 51, 41, 0.08), 0 0 1px 1px rgba(255, 255, 255, 0.8) inset",
            "card-lift": "0 24px 45px -12px rgba(58, 51, 41, 0.14), 0 0 0 1px rgba(212, 155, 40, 0.25)",
            "pill": "0 4px 20px -2px rgba(0, 0, 0, 0.06)",
            "cta-glow": "0 12px 32px -4px rgba(35, 31, 26, 0.35), 0 0 20px 2px rgba(212, 155, 40, 0.25)",
            "ios-nav": "0 8px 24px -4px rgba(35, 31, 26, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)"
    },  "colors": {
            "parchment": {
              "50": "#fdfcf9",
              "100": "#fbf8f2",
              "200": "#f6f1e8",
              "300": "#ede4d3",
              "800": "#3a3329",
              "900": "#231f1a"
            },
            "terracotta": {
              "400": "#e58f55",
              "500": "#d97736",
              "600": "#b8581f"
            },
            "gold": {
              "400": "#e8b948",
              "500": "#d49b28",
              "600": "#b27b14"
            },
     "on-primary-fixed": "#3b0900", "background": "#fcf9f3", "cream-canvas": "#FAF7F2", "on-secondary-fixed": "#111f11", "terracotta-soft": "#D97D64", "sage-wash": "#E4EBE1", "surface-tint": "#99452d", "on-surface-variant": "#55433e", "inverse-primary": "#ffb5a0", "primary-fixed-dim": "#ffb5a0", "on-tertiary": "#ffffff", "tertiary-fixed-dim": "#dec29f", "secondary-fixed-dim": "#bbcbb6", "surface-container-highest": "#e5e2dc", "surface-container-low": "#f6f3ed", "primary-fixed": "#ffdbd1", "surface-bright": "#fcf9f3", "secondary": "#536251", "sand-surface": "#EFEAE1", "tertiary-container": "#8a7354", "on-primary-container": "#fffbff", "on-error": "#ffffff", "on-primary": "#ffffff", "surface-container": "#f0eee8", "charcoal-muted": "#484742", "on-tertiary-container": "#ffffff", "inverse-surface": "#31312d", "vellum-glass": "rgba(249, 246, 240, 0.72)", "outline-variant": "#dbc1ba", "primary-container": "#b55b41", "on-secondary-fixed-variant": "#3c4b3a", "error": "#ba1a1a", "surface-container-lowest": "#ffffff", "deep-charcoal": "#1C1C1A", "surface-container-high": "#ebe8e2", "surface-dim": "#dcdad4", "on-tertiary-fixed-variant": "#564428", "on-error-container": "#93000a", "secondary-container": "#d4e4ce", "on-surface": "#1c1c18", "inverse-on-surface": "#f3f0ea", "on-primary-fixed-variant": "#7a2f18", "error-container": "#ffdad6", "on-secondary-container": "#586755", "outline": "#88726c", "surface-variant": "#e5e2dc", "secondary-fixed": "#d7e7d1", "on-background": "#1c1c18", "primary": "#96432b", "tertiary-fixed": "#fbdeb9", "tertiary": "#6f5b3e", "on-tertiary-fixed": "#271903", "surface": "#fcf9f3", "on-secondary": "#ffffff" }, "borderRadius": { "DEFAULT": "0.125rem", "lg": "0.25rem", "xl": "0.5rem", "full": "0.75rem" }, "spacing": { "margin-mobile": "1.25rem", "margin": "3.5rem", "space-sm": "0.75rem", "space-xl": "4rem", "gutter": "2rem", "space-md": "1.25rem", "space-xs": "0.375rem", "space-lg": "2.25rem", "gutter-mobile": "1rem" }, "fontFamily": {
            "serif": ["'Cormorant Garamond'", "Georgia", "serif"],
            "sans": ["'Plus Jakarta Sans'", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
     "label-lg": [ "Plus Jakarta Sans" ], "quote-pull": [ "Playfair Display" ], "headline-lg-mobile": [ "Playfair Display" ], "headline-md": [ "Playfair Display" ], "body-sm": [ "Plus Jakarta Sans" ], "quote-pull-mobile": [ "Playfair Display" ], "body-lg": [ "Plus Jakarta Sans" ], "display-hero-mobile": [ "Playfair Display" ], "body-md": [ "Plus Jakarta Sans" ], "display-hero": [ "Playfair Display" ], "headline-lg": [ "Playfair Display" ], "label-md": [ "Plus Jakarta Sans" ], "headline-sm": [ "Playfair Display" ] }, "fontSize": { "label-lg": [ "13px", { "lineHeight": "18px", "letterSpacing": "0.06em", "fontWeight": "600" } ], "quote-pull": [ "30px", { "lineHeight": "42px", "fontWeight": "400" } ], "headline-lg-mobile": [ "32px", { "lineHeight": "38px", "letterSpacing": "-0.01em", "fontWeight": "400" } ], "headline-md": [ "28px", { "lineHeight": "36px", "fontWeight": "400" } ], "body-sm": [ "13px", { "lineHeight": "20px", "fontWeight": "400" } ], "quote-pull-mobile": [ "22px", { "lineHeight": "32px", "fontWeight": "400" } ], "body-lg": [ "18px", { "lineHeight": "30px", "fontWeight": "400" } ], "display-hero-mobile": [ "40px", { "lineHeight": "48px", "letterSpacing": "-0.01em", "fontWeight": "400" } ], "body-md": [ "15px", { "lineHeight": "26px", "fontWeight": "400" } ], "display-hero": [ "64px", { "lineHeight": "72px", "letterSpacing": "-0.02em", "fontWeight": "400" } ], "headline-lg": [ "44px", { "lineHeight": "52px", "letterSpacing": "-0.015em", "fontWeight": "400" } ], "label-md": [ "11px", { "lineHeight": "16px", "letterSpacing": "0.08em", "fontWeight": "600" } ], "headline-sm": [ "22px", { "lineHeight": "30px", "fontWeight": "500" } ] } } } };