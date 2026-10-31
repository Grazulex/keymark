import { closeSync, openSync } from 'node:fs';
import { ReadStream, WriteStream } from 'node:tty';
import { KeymarkError } from './vault';

/**
 * Opens the controlling terminal directly. This is deliberate: an agent that
 * runs `keymark exec` has no TTY, so approvals and secret entry can only come
 * from a human sitting at the terminal.
 */
function openTty(): { input: ReadStream; output: WriteStream; close: () => void } {
  let fd: number;
  try {
    fd = openSync('/dev/tty', 'r+');
  } catch {
    throw new KeymarkError(
      'No interactive terminal available (/dev/tty). This step needs a human.',
      3
    );
  }
  const input = new ReadStream(fd);
  const output = new WriteStream(fd);
  return {
    input,
    output,
    close: () => {
      input.setRawMode(false);
      input.destroy();
      output.destroy();
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    },
  };
}

function readLine(mask: boolean, label: string): Promise<string> {
  const tty = openTty();
  tty.output.write(label);
  tty.input.setRawMode(true);
  tty.input.resume();
  tty.input.setEncoding('utf-8');

  return new Promise<string>((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          tty.output.write('\n');
          tty.input.off('data', onData);
          tty.close();
          resolve(buffer);
          return;
        }
        if (ch === '\u0003' || ch === '\u0004') {
          tty.output.write('\n');
          tty.input.off('data', onData);
          tty.close();
          reject(new KeymarkError('Aborted.', 130));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            if (!mask) tty.output.write('\b \b');
          }
          continue;
        }
        buffer += ch;
        if (!mask) tty.output.write(ch);
      }
    };
    tty.input.on('data', onData);
  });
}

export function promptHidden(label: string): Promise<string> {
  return readLine(true, label);
}

export async function confirm(question: string): Promise<boolean> {
  const answer = await readLine(false, `${question} [y/N] `);
  return /^y(es)?$/i.test(answer.trim());
}
