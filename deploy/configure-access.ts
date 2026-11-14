import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { createWebConfig } from "../recruiter-frontend/lib/web-access-core";
import { saveWebConfig } from "../recruiter-frontend/lib/web-access-store";

async function main() {
  if (!process.stdin.isTTY) throw Error("Execute em um terminal interativo; não passe senhas em argumentos.");
  let hidden = false;
  const output = new Writable({ write(chunk, _encoding, done) { if (!hidden) process.stdout.write(chunk); done(); } });
  const prompt = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const origin = process.env.WEB_ORIGIN || await prompt.question("Endereço HTTPS: ");
    console.log("A senha concede acesso a todos os perfis desta instalação pessoal.");
    process.stdout.write("Senha de acesso (12 a 128 caracteres; entrada oculta): ");
    hidden = true;
    const password = await prompt.question("");
    process.stdout.write("\nConfirme a senha: ");
    const confirm = await prompt.question("");
    hidden = false; process.stdout.write("\n");
    if (password !== confirm) throw Error("As senhas não coincidem.");
    await saveWebConfig(createWebConfig(origin, password));
    console.log("Acesso configurado. Senha não foi registrada em logs nem salva em texto simples. Sessões anteriores foram invalidadas.");
  } finally { prompt.close(); }
}
void main().catch(() => { console.error("Não foi possível configurar. Confira o HTTPS, a senha, a confirmação e a permissão do volume de dados."); process.exitCode = 1; });
