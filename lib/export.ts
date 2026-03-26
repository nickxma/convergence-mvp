import type { Message, Source } from './conversations';

function teacherLabel(speaker: string): string {
  return speaker || 'Mindfulness Teacher';
}

function stripCitations(text: string): string {
  return text.replace(/\[\d+\]/g, '').replace(/\s{2,}/g, ' ').trim();
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function fileDate(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/-+$/, '');
}

interface Turn {
  question: string;
  answer: string;
  sources: Source[];
}

function pairMessages(messages: Message[]): Turn[] {
  const pairs: Turn[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const user = messages[i];
    const asst = messages[i + 1];
    if (user.role === 'user' && asst.role === 'assistant' && !asst.error && !asst.streaming) {
      pairs.push({
        question: user.content,
        answer: asst.content,
        sources: (asst.sources ?? []).slice(0, 3),
      });
      i++; // skip the assistant message on the next iteration
    }
  }
  return pairs;
}

function buildReferencesMarkdown(sources: Source[]): string[] {
  if (sources.length === 0) return [];
  const lines: string[] = ['## Teachers Referenced', ''];
  sources.forEach((s, i) => {
    lines.push(`${i + 1}. **${teacherLabel(s.speaker)}** — Mindfulness teaching`);
    lines.push('');
  });
  return lines;
}

function buildReferencesPlain(sources: Source[]): string[] {
  if (sources.length === 0) return [];
  const lines: string[] = ['Teachers Referenced', ''];
  sources.forEach((s, i) => {
    lines.push(`${i + 1}. ${teacherLabel(s.speaker)} — Mindfulness teaching`);
    lines.push('');
  });
  return lines;
}

export function buildMarkdown(messages: Message[], date = new Date()): string {
  const pairs = pairMessages(messages);
  if (pairs.length === 0) return '';

  const lines: string[] = [`# Waking Up Q&A — ${formatDate(date)}`, ''];
  const allSources: Source[] = [];

  for (const { question, answer, sources } of pairs) {
    lines.push(`## ${question}`, '');
    lines.push('### Answer', '');
    lines.push(stripCitations(answer), '');
    lines.push('---', '');
    allSources.push(...sources);
  }

  lines.push('', ...buildReferencesMarkdown(allSources));

  return lines.join('\n');
}

export function buildMarkdownSingle(
  question: string,
  answer: string,
  sources: Source[],
  date = new Date(),
): string {
  const lines: string[] = [
    `# ${question}`,
    '',
    `*Waking Up Q&A — ${formatDate(date)}*`,
    '',
    '### Answer',
    '',
    stripCitations(answer),
    '',
    ...buildReferencesMarkdown(sources),
  ];
  return lines.join('\n');
}

export function buildPlainText(messages: Message[], date = new Date()): string {
  const pairs = pairMessages(messages);
  if (pairs.length === 0) return '';

  const lines: string[] = [`Waking Up Q&A — ${formatDate(date)}`, ''];
  const allSources: Source[] = [];

  for (const { question, answer, sources } of pairs) {
    lines.push(`Q: ${question}`, '');
    lines.push(stripCitations(answer), '');
    lines.push('---', '');
    allSources.push(...sources);
  }

  lines.push('', ...buildReferencesPlain(allSources));

  return lines.join('\n');
}

export function buildPlainTextSingle(
  question: string,
  answer: string,
  sources: Source[],
  date = new Date(),
): string {
  const lines: string[] = [
    `Q: ${question}`,
    '',
    `Waking Up Q&A — ${formatDate(date)}`,
    '',
    stripCitations(answer),
    '',
    ...buildReferencesPlain(sources),
  ];
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
  sources: Source[],
  format: 'markdown' | 'plaintext',
): void {
  const now = new Date();
  const slug = slugify(question);
  const datePart = fileDate(now);
  const base = slug || datePart;
  if (format === 'markdown') {
    const content = buildMarkdownSingle(question, answer, sources, now);
    downloadText(content, `answer-${base}.md`, 'text/markdown');
  } else {
    const content = buildPlainTextSingle(question, answer, sources, now);
    downloadText(content, `answer-${base}.txt`, 'text/plain');
  }
}

export interface HistoryConversation {
  title: string;
  messages: Array<{ role: string; content: string }>;
  createdAt: string;
}

/**
 * Build a Markdown document from an array of raw HistoryMessage conversations.
 * Used for bulk export from /account/conversations.
 */
export function buildMarkdownFromHistories(conversations: HistoryConversation[]): string {
  const lines: string[] = [
    '# Waking Up Q\u0026A — Study Journal',
    `*Exported ${formatDate(new Date())}*`,
    '',
  ];

  for (const conv of conversations) {
    const date = new Date(conv.createdAt);
    lines.push(`## ${conv.title}`, `*${formatDate(date)}*`, '');

    const msgs = conv.messages;
    for (let i = 0; i < msgs.length - 1; i++) {
      const user = msgs[i];
      const asst = msgs[i + 1];
      if (user.role === 'user' && asst.role === 'assistant') {
        lines.push(`### ${user.content}`, '', stripCitations(asst.content), '', '---', '');
        i++;
      }
    }
  }

  return lines.join('\n');
}

/**
 * Build a plain-text document from an array of raw HistoryMessage conversations.
 */
export function buildPlainTextFromHistories(conversations: HistoryConversation[]): string {
  const lines: string[] = [
    'Waking Up Q\u0026A — Study Journal',
    `Exported ${formatDate(new Date())}`,
    '',
  ];

  for (const conv of conversations) {
    const date = new Date(conv.createdAt);
    lines.push(`${conv.title}`, `${formatDate(date)}`, '');

    const msgs = conv.messages;
    for (let i = 0; i < msgs.length - 1; i++) {
      const user = msgs[i];
      const asst = msgs[i + 1];
      if (user.role === 'user' && asst.role === 'assistant') {
        lines.push(`Q: ${user.content}`, '', stripCitations(asst.content), '', '---', '');
        i++;
      }
    }
  }

  return lines.join('\n');
}

export function exportAllConversations(
  conversations: HistoryConversation[],
  format: 'markdown' | 'plaintext',
): void {
  const now = new Date();
  const datePart = fileDate(now);
  if (format === 'markdown') {
    const content = buildMarkdownFromHistories(conversations);
    downloadText(content, `waking-up-qa-journal-${datePart}.md`, 'text/markdown');
  } else {
    const content = buildPlainTextFromHistories(conversations);
    downloadText(content, `waking-up-qa-journal-${datePart}.txt`, 'text/plain');
  }
}

export interface SavedAnswerExport {
  question: string;
  answer: string;
  sources: Source[];
  savedAt: string;
  notes: string | null;
}

function buildMarkdownFromSaved(answers: SavedAnswerExport[]): string {
  const lines: string[] = [
    '# Waking Up Q\u0026A — Saved Answers',
    `*Exported ${formatDate(new Date())}*`,
    '',
  ];

  for (const item of answers) {
    const date = new Date(item.savedAt);
    lines.push(`## ${item.question}`, `*Saved ${formatDate(date)}*`, '');
    lines.push('### Answer', '', stripCitations(item.answer), '');
    if (item.notes) {
      lines.push('### Notes', '', item.notes, '');
    }
    if (item.sources.length > 0) {
      lines.push(...buildReferencesMarkdown(item.sources.slice(0, 3)));
    }
    lines.push('---', '');
  }

  return lines.join('\n');
}

function buildPlainTextFromSaved(answers: SavedAnswerExport[]): string {
  const lines: string[] = [
    'Waking Up Q\u0026A — Saved Answers',
    `Exported ${formatDate(new Date())}`,
    '',
  ];

  for (const item of answers) {
    const date = new Date(item.savedAt);
    lines.push(`Q: ${item.question}`, `Saved ${formatDate(date)}`, '');
    lines.push(stripCitations(item.answer), '');
    if (item.notes) {
      lines.push('Notes:', item.notes, '');
    }
    if (item.sources.length > 0) {
      lines.push(...buildReferencesPlain(item.sources.slice(0, 3)));
    }
    lines.push('---', '');
  }

  return lines.join('\n');
}

export function exportSavedAnswers(
  answers: SavedAnswerExport[],
  format: 'markdown' | 'plaintext',
): void {
  const now = new Date();
  const datePart = fileDate(now);
  if (format === 'markdown') {
    const content = buildMarkdownFromSaved(answers);
    downloadText(content, `saved-answers-${datePart}.md`, 'text/markdown');
  } else {
    const content = buildPlainTextFromSaved(answers);
    downloadText(content, `saved-answers-${datePart}.txt`, 'text/plain');
  }
}
