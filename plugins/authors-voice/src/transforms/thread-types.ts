/**
 * ThreadTypes — Shared types for structured X thread output.
 */

export interface Tweet {
  index: number;
  text: string;
  charCount: number;
}

export interface ThreadResult {
  tweets: Tweet[];
  totalTweets: number;
  allWithinLimit: boolean;
  overLimitTweets: number[];
}

export interface PostedTweet {
  index: number;
  tweetId: string;
  text: string;
}

export interface PostThreadResult {
  success: boolean;
  postedTweets: PostedTweet[];
  threadUrl?: string;
  failedAt?: number;
  error?: string;
}
