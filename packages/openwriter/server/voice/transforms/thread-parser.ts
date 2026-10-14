/**
 * ThreadParserService — Parse JSON thread responses from Claude,
 * validate tweet lengths, convert to HTML and preview markdown.
 */

import type { Tweet, ThreadResult } from './thread-types.js';

const TWEET_CHAR_LIMIT = 280;

/**
 * Parse raw Claude response into a structured ThreadResult.
 * Expects a JSON array of plain-text tweet strings.
 */
export function parseThreadResponse(raw: string): ThreadResult {
  // Strip code fences if present
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
  cleaned = cleaned.trim();

  let tweetTexts: string[];
  try {
    tweetTexts = JSON.parse(cleaned);
  } catch {
    // Fallback: try to extract JSON array from the response
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      tweetTexts = JSON.parse(arrayMatch[0]);
    } else {
      throw new Error('Could not parse thread response as JSON array');
    }
  }

  if (!Array.isArray(tweetTexts) || tweetTexts.length === 0) {
    throw new Error('Thread response must be a non-empty JSON array of strings');
  }

  const tweets: Tweet[] = tweetTexts
    .map(text => String(text).trim())
    .filter(t => t.length > 0)
    .map((text, i) => ({ index: i, text, charCount: text.length }));

  if (tweets.length === 0) {
    throw new Error('Thread response contained no non-empty tweets');
  }

  const overLimitTweets = tweets
    .filter(t => t.charCount > TWEET_CHAR_LIMIT)
    .map(t => t.index);

  return {
    tweets,
    totalTweets: tweets.length,
    allWithinLimit: overLimitTweets.length === 0,
    overLimitTweets,
  };
}

/**
 * Convert a ThreadResult back to HTML with <p> and <hr> separators.
 */
export function threadToHtml(result: ThreadResult): string {
  return result.tweets
    .map(t => {
      const lines = t.text.split('\n').filter(Boolean);
      return lines.map(line => `<p>${line}</p>`).join('\n');
    })
    .join('\n<hr>\n') + '\n<hr>';
}

/**
 * Convert a ThreadResult to a markdown preview.
 */
export function threadToPreviewMarkdown(result: ThreadResult, title: string): string {
  const header = `# Thread: ${title} (${result.totalTweets} tweets)\n\n`;

  const body = result.tweets.map((t, i) => {
    const label = i === 0 ? 'Hook' : i === result.totalTweets - 1 ? 'Closer' : '';
    const labelStr = label ? ` (${label})` : '';
    const overLimit = t.charCount > TWEET_CHAR_LIMIT ? ' ⚠️ OVER LIMIT' : '';
    const heading = `**Tweet ${i + 1}/${result.totalTweets}**${labelStr} [${t.charCount}/${TWEET_CHAR_LIMIT} chars]${overLimit}`;
    return `${heading}\n${t.text}`;
  }).join('\n\n---\n\n');

  return header + body;
}
