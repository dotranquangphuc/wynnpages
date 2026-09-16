const fs = require('fs');
const path = require('path');

const fonts = [
  { pkg: '@fontsource/cormorant-garamond', name: 'Cormorant Garamond', weights: [400, 500, 600, 700], italic: true },
  { pkg: '@fontsource/plus-jakarta-sans', name: 'Plus Jakarta Sans', weights: [300, 400, 500, 600, 700], italic: false },
  { pkg: '@fontsource/caveat', name: 'Caveat', weights: [500, 600, 700], italic: false },
  { pkg: '@fontsource/playfair-display', name: 'Playfair Display', weights: [400, 500, 600, 700], italic: true },
  { pkg: '@fontsource/fraunces', name: 'Fraunces', weights: [300, 400, 500, 600], italic: true }
];

const sourceDir = '/tmp/fonts-temp/node_modules';
const destDir = path.join(__dirname, 'assets', 'fonts');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

let cssContent = '';

for (const font of fonts) {
  const familyName = font.pkg.replace('@fontsource/', '');
  for (const weight of font.weights) {
    const styles = font.italic ? ['normal', 'italic'] : ['normal'];
    for (const style of styles) {
      // Find the file in the node_modules directory
      const fileName = `${familyName}-latin-${weight}-${style}.woff2`;
      const sourcePath = path.join(sourceDir, font.pkg, 'files', fileName);
      
      // Some fonts might have standard instead of variable, or they just exist
      if (fs.existsSync(sourcePath)) {
        const destPath = path.join(destDir, fileName);
        fs.copyFileSync(sourcePath, destPath);
        
        cssContent += `
@font-face {
  font-family: '${font.name}';
  font-style: ${style};
  font-weight: ${weight};
  font-display: swap;
  src: url('./fonts/${fileName}') format('woff2');
}
`;
      } else {
        console.warn(`Warning: Could not find ${sourcePath}`);
      }
    }
  }
}

fs.writeFileSync(path.join(__dirname, 'assets', 'fonts.css'), cssContent);
console.log('Fonts copied and fonts.css generated!');
