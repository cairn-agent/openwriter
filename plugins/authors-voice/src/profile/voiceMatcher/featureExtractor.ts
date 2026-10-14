/**
 * Deterministic style feature extractor. Same input → same output, no LLM.
 * Ported from openwriter-site/src/lib/writers-voice/feature-extractor.ts
 */

export interface SentenceDistribution {
  short: number;
  medium: number;
  long: number;
  very_long: number;
}

export interface PunctuationDensity {
  em_dash: number;
  semicolon: number;
  colon: number;
  paren: number;
  question: number;
  exclamation: number;
}

export interface Fingerprint {
  word_count: number;
  sentence_count: number;
  paragraph_count: number;
  avg_words_per_sentence: number;
  sentence_distribution: SentenceDistribution;
  punctuation_density: PunctuationDensity;
  contraction_rate: number;
  first_person_rate: number;
  second_person_rate: number;
  fragment_rate: number;
  paragraph_avg_sentences: number;
  paragraph_distribution: { short: number; medium: number; long: number };
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'co',
  'inc', 'ltd', 'corp', 'no', 'vs', 'etc', 'e.g', 'i.e', 'a.m', 'p.m',
  'u.s', 'u.k', 'u.n', 'ph.d', 'm.d', 'b.a', 'b.s', 'm.a', 'm.s'
]);

const FIRST_PERSON = /\b(I|me|my|mine|myself|we|us|our|ours|ourselves)\b/g;
const SECOND_PERSON = /\b(you|your|yours|yourself|yourselves)\b/gi;
const CONTRACTION = /\b\w+'(t|s|re|ve|ll|d|m)\b/g;
const VERBISH = /\b(is|are|was|were|am|be|been|being|have|has|had|do|does|did|can|could|will|would|shall|should|may|might|must|\w+ed|\w+s|\w+ing)\b/i;

function tokenizeSentences(text: string): string[] {
  const raw = text.replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '.' || c === '!' || c === '?') {
      if (c === '.') {
        const prevWord = raw.slice(0, i).match(/(\S+)$/)?.[1]?.toLowerCase().replace(/[^\w.]/g, '');
        if (prevWord && ABBREVIATIONS.has(prevWord.replace(/\.$/, ''))) continue;
      }
      const next = raw.slice(i + 1);
      const trimmed = next.replace(/^[\s"')\]]+/, '');
      if (trimmed === '' || /^[A-Z]/.test(trimmed)) {
        const sent = raw.slice(start, i + 1).trim();
        if (sent) sentences.push(sent);
        start = i + 1;
      }
    }
  }
  const tail = raw.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

function countWords(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function bucketSentence(wordCount: number): keyof SentenceDistribution {
  if (wordCount <= 8) return 'short';
  if (wordCount <= 16) return 'medium';
  if (wordCount <= 25) return 'long';
  return 'very_long';
}

function isFragment(sentence: string): boolean {
  const wc = countWords(sentence);
  if (wc < 3) return true;
  return !VERBISH.test(sentence);
}

function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function round(n: number, places: number): number {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}

export function extractFingerprint(text: string): Fingerprint {
  const sentences = tokenizeSentences(text);
  const wordCount = countWords(text);
  const sentenceCount = sentences.length;
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const paragraphCount = paragraphs.length || 1;

  const distCounts = { short: 0, medium: 0, long: 0, very_long: 0 };
  let totalSentenceWords = 0;
  let fragmentCount = 0;
  for (const s of sentences) {
    const wc = countWords(s);
    totalSentenceWords += wc;
    distCounts[bucketSentence(wc)]++;
    if (isFragment(s)) fragmentCount++;
  }

  const sentence_distribution: SentenceDistribution = {
    short: pct(distCounts.short, sentenceCount),
    medium: pct(distCounts.medium, sentenceCount),
    long: pct(distCounts.long, sentenceCount),
    very_long: pct(distCounts.very_long, sentenceCount),
  };

  const avg_words_per_sentence = sentenceCount > 0
    ? round(totalSentenceWords / sentenceCount, 2) : 0;

  const per1000 = (count: number) => wordCount > 0 ? round((count / wordCount) * 1000, 2) : 0;
  const punctuation_density: PunctuationDensity = {
    em_dash: per1000((text.match(/—/g)?.length ?? 0) + (text.match(/--/g)?.length ?? 0)),
    semicolon: per1000(text.match(/;/g)?.length ?? 0),
    colon: per1000(text.match(/:/g)?.length ?? 0),
    paren: per1000(text.match(/\(/g)?.length ?? 0),
    question: per1000(text.match(/\?/g)?.length ?? 0),
    exclamation: per1000(text.match(/!/g)?.length ?? 0),
  };

  const firstPersonCount = (text.match(FIRST_PERSON) ?? []).length;
  const secondPersonCount = (text.match(SECOND_PERSON) ?? []).length;
  const contractionCount = (text.match(CONTRACTION) ?? []).length;

  const paraSentenceCounts = paragraphs.map(p => tokenizeSentences(p).length);
  const paraDistCounts = { short: 0, medium: 0, long: 0 };
  let totalParaSentences = 0;
  for (const sc of paraSentenceCounts) {
    totalParaSentences += sc;
    if (sc <= 1) paraDistCounts.short++;
    else if (sc <= 4) paraDistCounts.medium++;
    else paraDistCounts.long++;
  }
  const paragraph_avg_sentences = paragraphCount > 0
    ? round(totalParaSentences / paragraphCount, 2) : 0;

  return {
    word_count: wordCount,
    sentence_count: sentenceCount,
    paragraph_count: paragraphCount,
    avg_words_per_sentence,
    sentence_distribution,
    punctuation_density,
    contraction_rate: wordCount > 0 ? round((contractionCount / wordCount) * 100, 2) : 0,
    first_person_rate: per1000(firstPersonCount),
    second_person_rate: per1000(secondPersonCount),
    fragment_rate: sentenceCount > 0 ? round(fragmentCount / sentenceCount, 3) : 0,
    paragraph_avg_sentences,
    paragraph_distribution: {
      short: pct(paraDistCounts.short, paragraphCount),
      medium: pct(paraDistCounts.medium, paragraphCount),
      long: pct(paraDistCounts.long, paragraphCount),
    },
  };
}
