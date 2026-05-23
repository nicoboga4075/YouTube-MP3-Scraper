const fs = require('node:fs');
const path = require('node:path');

const version = process.argv[2];
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const d = new Date();
const releaseDate = process.argv[3] || String(d.getDate()).padStart(2, '0') + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();

if (!version) {
  console.error('Usage: node update-version.js <version> [releaseDate]');
  process.exit(1);
}

// Update popup.html
const htmlPath = path.join(__dirname, 'popup.html');
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(
  html.match(/Version : <span class="hl">[^<]*<\/span>/)[0],
  `Version : <span class="hl">${version}</span>`
);
html = html.replace(
  html.match(/Release : <span class="hl">[^<]*<\/span>/)[0],
  `Release : <span class="hl">${releaseDate}</span>`
);
fs.writeFileSync(htmlPath, html);
console.log(`popup.html updated -> v${version} / ${releaseDate}`);

// Update CHANGELOG.md
const changelogPath = path.join(__dirname, 'CHANGELOG.md');
let changelog = fs.readFileSync(changelogPath, 'utf8');
const escapedVersion = version.replaceAll('.', String.raw`\.`);
const regex = new RegExp(String.raw`(#### v${escapedVersion}\r\n\r\n> )[^\r\n]*`);
changelog = changelog.replace(regex,`$1${releaseDate}`);
fs.writeFileSync(changelogPath, changelog);
console.log(`CHANGELOG.md updated -> v${version} / ${releaseDate}`);