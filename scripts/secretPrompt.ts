/**
 * Terminalda maxfiy qator so'rash (parol): yozilgani ekranda ko'rinmaydi. Terminal bo'lmasa (quvur) — oddiy qator o'qiladi.
 */
export function askSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = '';
    const raw = stdin.isTTY;
    if (raw) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const done = (err?: Error) => {
      stdin.off('data', onData);
      if (raw) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      if (err) reject(err); else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('bekor qilindi'));
        if (ch === '\u0008' || ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}
