const { execSync } = require("child_process");

// Força o ambiente a ignorar qualquer comando global do sistema
const env = { ...process.env };
delete env.APPDATA; // Limpa o cache onde o composer costuma se esconder

try {
  execSync("npx --no-install prisma db push --skip-generate", { stdio: "inherit", env });
} catch (e) {
  console.log("Tentando via caminho limpo...");
  execSync("node ./node_modules/prisma/build/index.js db push", { stdio: "inherit", env });
}