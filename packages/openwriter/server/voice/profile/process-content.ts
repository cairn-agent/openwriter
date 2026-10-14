/**
 * Content preparation before voice analysis, copied from Author's Voice's AuthorVoiceService
 * (cleanHtmlContent, processContent, applyBalancedSampling).
 * adr: adr/authors-voice.md
 */

import logger from '../logger.js';

const MIN_WORD_THRESHOLD = 200;
const MAX_WORD_THRESHOLD = 20000;

/**
 * Clean HTML content by removing tags and normalizing whitespace
 */
export function cleanHtmlContent(content: string): string {
  if (!content) return '';

  let processedContent = content;

  processedContent = processedContent.replace(/<br\s*\/?>/gi, '\n');
  processedContent = processedContent.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
  processedContent = processedContent.replace(/<\/div>\s*<div[^>]*>/gi, '\n\n');
  processedContent = processedContent.replace(/<p[^>]*>/gi, '');
  processedContent = processedContent.replace(/<\/p>/gi, '\n\n');
  processedContent = processedContent.replace(/<div[^>]*>/gi, '');
  processedContent = processedContent.replace(/<\/div>/gi, '\n\n');

  processedContent = processedContent.replace(/<li[^>]*>/gi, '• ');
  processedContent = processedContent.replace(/<\/li>/gi, '\n');

  processedContent = processedContent.replace(/<h[1-6][^>]*>/gi, '\n\n');
  processedContent = processedContent.replace(/<\/h[1-6]>/gi, '\n\n');

  processedContent = processedContent.replace(/<[^>]*>/g, ' ');

  processedContent = processedContent.replace(/&nbsp;/g, ' ');
  processedContent = processedContent.replace(/&amp;/g, '&');
  processedContent = processedContent.replace(/&lt;/g, '<');
  processedContent = processedContent.replace(/&gt;/g, '>');
  processedContent = processedContent.replace(/&quot;/g, '"');
  processedContent = processedContent.replace(/&#39;/g, "'");

  processedContent = processedContent.replace(/\s+/g, ' ');

  processedContent = processedContent.replace(/\n+/g, '\n\n');

  while (processedContent.includes('\n\n\n')) {
    processedContent = processedContent.replace(/\n\n\n+/g, '\n\n');
  }

  processedContent = processedContent.trim();

  return processedContent;
}

/**
 * Process content for analysis (apply size limits, sampling)
 */
export function processContent(content: string): string {
  const cleanedContent = cleanHtmlContent(content);

  const words = cleanedContent.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (wordCount < MIN_WORD_THRESHOLD) {
    logger.warn(`Content below absolute minimum threshold of ${MIN_WORD_THRESHOLD} words (${wordCount} words)`);
  }

  if (wordCount > MAX_WORD_THRESHOLD) {
    logger.info(`Content exceeds maximum threshold of ${MAX_WORD_THRESHOLD} words. Applying balanced sampling.`);
    return applyBalancedSampling(cleanedContent, MAX_WORD_THRESHOLD);
  }

  return cleanedContent;
}

/**
 * Balanced sampling for large corpus — evenly distributed sentence selection
 */
function applyBalancedSampling(content: string, targetWordCount: number): string {
  const sentences = content.split(/(?<=[.!?])\s+/).filter(Boolean);
  const totalSentences = sentences.length;

  if (totalSentences <= 10) return content;

  const totalWords = content.split(/\s+/).filter(Boolean).length;
  const avgWordsPerSentence = totalWords / totalSentences;
  const sentencesToKeep = Math.floor(targetWordCount / avgWordsPerSentence);
  const effectiveSentencesToKeep = Math.max(10, sentencesToKeep);

  if (effectiveSentencesToKeep >= totalSentences * 0.9) return content;

  const sampledSentences = [];
  const step = totalSentences / effectiveSentencesToKeep;

  sampledSentences.push(...sentences.slice(0, 3));

  for (let i = 0; i < effectiveSentencesToKeep - 6; i++) {
    const index = Math.min(Math.floor(3 + i * step), totalSentences - 4);
    sampledSentences.push(sentences[index]);
  }

  sampledSentences.push(...sentences.slice(totalSentences - 3));

  return sampledSentences.join(' ');
}
