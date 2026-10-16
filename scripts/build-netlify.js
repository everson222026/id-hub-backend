const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
const publicFiles = [
  "index.html",
  "login.html",
  "cadastro.html",
  "docente.html",
  "notas-atividades-docente.html",
  "sobre.html",
  "api.js",
];

fs.mkdirSync(output, { recursive: true });

for (const file of publicFiles) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) {
    throw new Error(`Required Netlify publish file not found: ${file}`);
  }
  fs.copyFileSync(source, path.join(output, file));
}

console.log(`Prepared ${publicFiles.length} public files in dist/.`);
