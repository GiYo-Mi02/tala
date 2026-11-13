import type { OcrElement, Region } from './template';
// ML Kit may return a word or a separate element for each printed letter box.
// Join adjacent occupied cells, retaining gaps that represent intentional spaces.
// Never change recognized characters or use a dictionary/another section to guess a name.
export function nameFromBoxes(elements: OcrElement[], row: Region, fallback: string): string {
  const tokens = elements.filter(e => e.text.trim()).sort((a,b) => a.x-b.x);
  if (!tokens.length) return fallback.trim();
  const cell = row.width / 20;
  let text = '', endCell = 0;
  for (const token of tokens) {
    const value = token.text.trim();
    if (/\s/.test(value)) return fallback.trim();
    const start = Math.max(0, Math.floor((token.x-row.x)/cell));
    if (text && start > endCell) text += ' '.repeat(Math.min(19,start-endCell));
    text += value; endCell = start + value.length;
  }
  return text;
}
