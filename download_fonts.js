const fs = require('fs');
const path = require('path');
const https = require('https');

const FONTS = [
  { name: 'Cormorant Garamond', family: 'cormorant-garamond', weights: [400, 500, 600, 700], italic: true },
  { name: 'Plus Jakarta Sans', family: 'plus-jakarta-sans', weights: [300, 400, 500, 600, 700], italic: false },
  { name: 'Caveat', family: 'caveat', weights: [500, 600, 700], italic: false },
  { name: 'Playfair Display', family: 'playfair-display', weights: [400, 500, 600, 700], italic: true },
  { name: 'Fraunces', family: 'fraunces', weights: [300, 400, 500, 600], italic: true }
];

const FONTS_DIR = path.join(__dirname, 'assets', 'fonts');
if (!fs.existsSync(FONTS_DIR)) {
  fs.mkdirSync(FONTS_DIR, { recursive: true });
}

let cssContent = '';

async function fetchFontCss(font) {
  // Use google webfonts helper API
  const url = `https://google-webfonts-helper.herokuapp.com/api/fonts/${font.family}`;
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if(res.statusCode !== 200) return resolve(null); // skip if not found
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

async function main() {
  console.log("Starting font download...");
  for (const font of FONTS) {
    console.log(`Processing ${font.name}...`);
    const fontData = await fetchFontCss(font);
    if (!fontData || !fontData.variants) {
      console.log(`Could not fetch data for ${font.name} via helper, skipping...`);
      continue;
    }
    
    for (const variant of fontData.variants) {
      const weight = parseInt(variant.fontStyle === 'italic' ? variant.id.replace('italic', '') || '400' : variant.id || '400');
      const isItalic = variant.fontStyle === 'italic';
      
      if (font.weights.includes(weight) && (isItalic ? font.italic : true)) {
        // Download woff2
        const woff2Url = variant.local || variant.woff2;
        if (!woff2Url) continue;
        
        const fileName = `${font.family}-${weight}${isItalic ? '-italic' : ''}.woff2`;
        const destPath = path.join(FONTS_DIR, fileName);
        
        console.log(`Downloading ${fileName}...`);
        await downloadFile(woff2Url, destPath);
        
        // Append CSS
        cssContent += `
@font-face {
  font-family: '${font.name}';
  font-style: ${isItalic ? 'italic' : 'normal'};
  font-weight: ${weight};
  font-display: swap;
  src: url('./assets/fonts/${fileName}') format('woff2');
}
`;
      }
    }
  }
  
  fs.writeFileSync(path.join(__dirname, 'fonts.css'), cssContent);
  console.log("Finished! Generated fonts.css");
}

main();
