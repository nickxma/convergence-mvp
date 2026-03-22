import type { Message } from './conversations';

/** Derive a human-readable label from a raw source filename/path. */
function sourceLabel(source: string): string {
  if (!source) return 'Transcript';
  const base = source.split('/').pop() ?? source;
  return base.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
}

/** Strip [N] citation markers from answer text. */
function stripCitations(text: string): string {
  return text.replace(/\[\d+\]/g, '').replace(/\s{2,}/g, ' ').trim();
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function fileDate(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Pairs of (user question, assistant message) from the message array.
 * Skips error messages and incomplete (streaming) turns.
 */
function pairMessages(messages: Message[]) {
  const pairs: Array<{ question: string; answer: string; sources: string[] }> = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const user = messages[i];
    const asst = messages[i + 1];
    if (user.role === 'user' && asst.role === 'assistant' && !asst.error && !asst.streaming) {
      pairs.push({
        question: user.content,
        answer: asst.content,
        sources: (asst.sources ?? []).slice(0, 3).map((s) => sourceLabel(s.source)),
      });
      i++; // skip the assistant message on the next iteration
    }
  }
  return pairs;
}

export function buildMarkdown(messages: Message[], date = new Date()): string {
  const pairs = pairMessages(messages);
  if (pairs.length === 0) return '';

  const lines: string[] = [`# Waking Up Q&A — ${formatDate(date)}`, ''];

  for (const { question, answer, sources } of pairs) {
    lines.push(`## Q: ${question}`, '');
    lines.push(answer, '');
    if (sources.length > 0) {
      lines.push('**Sources:**');
      for (const s of sources) lines.push(`- ${s}`);
      lines.push('');
    }
    lines.push('---', '');
  }

  return lines.join('\n');
}

export function buildMarkdownSingle(
  question: string,
  answer: string,
  sources: string[],
  date = new Date(),
): string {
  const lines: string[] = [`# Waking Up Q&A — ${formatDate(date)}`, ''];
  lines.push(`## Q: ${question}`, '');
  lines.push(answer, '');
  if (sources.length > 0) {
    lines.push('**Sources:**');
    for (const s of sources) lines.push(`- ${s}`);
    lines.push('');
  }
  lines.push('---', '');
  return lines.join('\n');
}

export function buildPlainText(messages: Message[], date = new Date()): string {
  const pairs = pairMessages(messages);
  if (pairs.length === 0) return '';

  const lines: string[] = [`Waking Up Q&A — ${formatDate(date)}`, ''];

  for (const { question, answer, sources } of pairs) {
    lines.push(`Q: ${question}`, '');
    lines.push(stripCitations(answer), '');
    if (sources.length > 0) {
      lines.push('Sources:');
      for (const s of sources) lines.push(`  - ${s}`);
      lines.push('');
    }
    lines.push('---', '');
  }

  return lines.join('\n');
}

export function buildPlainTextSingle(
  question: string,
  answer: string,
  sources: string[],
  date = new Date(),
): string {
  const lines: string[] = [`Waking Up Q&A — ${formatDate(date)}`, ''];
  lines.push(`Q: ${question}`, '');
  lines.push(stripCitations(answer), '');
  if (sources.length > 0) {
    lines.push('Sources:');
    for (const s of sources) lines.push(`  - ${s}`);
    lines.push('');
  }
  lines.push('---', '');
  return lines.join('\n');
}

export function downloadText(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportConversation(messages: Message[], format: 'markdown' | 'plaintext'): void {
  const now = new Date();
  const datePart = fileDate(now);
  if (format === 'markdown') {
    const content = buildMarkdown(messages, now);
    downloadText(content, `waking-up-qa-${datePart}.md`, 'text/markdown');
  } else {
    const content = buildPlainText(messages, now);
    downloadText(content, `waking-up-qa-${datePart}.txt`, 'text/plain');
  }
}

export function exportSingleAnswer(
  question: string,
  answer: string,
  sources: string[],
  format: 'markdown' | 'plaintext',
): void {
  const now = new Date();
  const datePart = fileDate(now);
  if (format === 'markdown') {
    const content = buildMarkdownSingle(question, answer, sources, now);
    downloadText(content, `waking-up-qa-${datePart}.md`, 'text/markdown');
  } else {
    const content = buildPlainTextSingle(question, answer, sources, now);
    downloadText(content, `waking-up-qa-${datePart}.txt`, 'text/plain');
  }
}
