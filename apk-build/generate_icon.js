const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SIZE = 1024;

// Shield SVG - fond alb + scutul centrat
const svg = `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <!-- Fundal alb -->
  <rect width="${SIZE}" height="${SIZE}" fill="#ffffff" rx="200"/>

  <!-- Shield centrat, scalat la ~700px -->
  <g transform="translate(162, 112) scale(7)">
    <path d="M50 5L10 20V45c0 22 15.6 43 40 50 24.4-7 40-28 40-50V20L50 5z"
      fill="rgba(37,99,235,0.15)" stroke="#2563eb" stroke-width="2"/>
    <path d="M50 18L22 28.5V45c0 14 8.4 27.2 28 33 19.6-5.8 28-19 28-33V28.5L50 18z"
      fill="rgba(37,99,235,0.3)" stroke="#3b82f6" stroke-width="1.5"/>
    <polyline points="28,50 33,50 36,42 40,58 44,46 48,52 52,52 56,44 60,58 64,48 67,50 72,50"
      stroke="#60a5fa" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="44" cy="66" r="3" fill="#34d399"/>
    <circle cx="50" cy="62" r="3" fill="#34d399"/>
    <circle cx="56" cy="66" r="3" fill="#34d399"/>
  </g>
</svg>`;

const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);

sharp(Buffer.from(svg))
  .resize(SIZE, SIZE)
  .png()
  .toFile(path.join(assetsDir, 'icon.png'))
  .then(() => console.log('✓ assets/icon.png generat (1024x1024)'))
  .catch(err => console.error('Eroare:', err));
