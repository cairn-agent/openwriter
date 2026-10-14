/**
 * Thread + Storify prompt rules — merged from ThreadifyPromptRules.ts + StorifyBodyRules.ts.
 * Full-fidelity prompt constants for threadify, storify, and emailify transforms.
 */

export const THREADIFY_RULES = `HIGHEST PRIORITY GUIDELINES:
- DEFINITION: A "tweet" is one element in the output JSON array
- ABSOLUTE CHARACTER LIMIT: EVERY SINGLE TWEET MUST BE <=265 CHARACTERS - ZERO EXCEPTIONS - THIS IS THE MOST CRITICAL RULE
- ALWAYS count characters before creating any tweet
- If a tweet exceeds 265 characters, condense it by removing unnecessary or explanatory words while preserving meaning
- MANDATORY: ALL threads must use \\n for line breaks within grouped content - use \\n\\n for paragraph separation between distinct thoughts
- ABSOLUTE BAN: NEVER use *bold* formatting - Twitter does not support bold text - Use CAPITAL LETTERS for emphasis instead

CONDENSER GUIDELINES:
- FIRST: Try spreading content across multiple tweets when a tweet exceeds 265 characters
- FINAL CHECK: If any tweet still exceeds 265 characters after spreading, condense sentences by removing unnecessary words while preserving meaning
- NEVER number tweets (no "1/25", "2/25", etc.) - just write the content

TWEET FORMAT GUIDELINES:
- TWITTER PREFERENCE: Twitter users strongly prefer visual \\n\\n separation for better readability and engagement
- CONTENT FLEXIBILITY: Try to contain related concepts in one tweet when possible, but split across multiple tweets if the author's content requires it for readability and character management
- SEPARATE SENTENCES: Use \\n\\n to separate non-list sentences for line-by-line reading that performs well on Twitter
- NATURAL BREAKS: Create paragraph breaks for punchy answers, revelations, and key insights to enhance impact
- VISUAL FLOW: Structure content with natural pauses and emphasis points using \\n\\n paragraph spacing
- READABILITY: Structure tweets for easy scanning and engagement
- Do NOT use HTML tags, markdown, or any markup - plain text only with \\n and \\n\\n for formatting
- Use \\n between list items, NOT \\n\\n
- REQUIRED: Follow how the author naturally clusters writing
- MANDATORY: Vary tweet lengths naturally - never use robotically uniform sizing
- AUTHOR STYLE ADAPTATION: Study the writing voice, tone, and patterns in the provided article - this is the author's original content that you should match, BUT anti-AI guidelines ALWAYS override author style when there is any conflict

EXPLICIT LIST RULES (MANDATORY FOR BOTH BULLET AND NUMBERED LISTS):
- LIST FORMAT RECOGNITION: When you see ANY content with "1.", "2.", "3." OR "- " patterns, this is ALWAYS a list and must use list formatting rules
- NUMBERED LIST IDENTIFICATION: Any sequence of "1.", "2.", "3." items is a numbered list, not a multi-line tweet
- DEFINITION: A "list" means ANY group of items using "- " OR "1.", "2." format
- CHARACTER COUNT: Each complete tweet (including all list items) must be <=265 characters total
- STRUCTURE: All list items must be grouped together with \\n separators
- NEVER SEPARATE: Never use \\n\\n between individual list items
- CORRECT EXAMPLES:
  - Bullet: "- Quick setup\\n- Easy integration\\n- Fast results"
  - Numbered: "1. Install the package with npm\\n2. Configure your settings file\\n3. Run the initial test"
  - Numbered (sentence-like): "1. Start by installing the package\\n2. Then configure your settings\\n3. Finally run the test"
- WRONG EXAMPLES:
  - Wrong: "1. First step\\n\\n2. Second step" (\\n\\n between list items splits them visually)
  - Wrong: "- This is a very long list item sentence that exceeds the character limit"
- CRITICAL: List formatting rules OVERRIDE and REPLACE multi-line tweet rules when numbered/bullet patterns are detected
- These rules override ALL other formatting instructions

AI DETECTION AVOIDANCE (Critical for authentic threads - ALWAYS OVERRIDE AUTHOR STYLE):
- NEVER use AI common words/phrases: Completely avoid well-known AI vocabulary patterns
- Eliminate hedge words: Remove probability qualifiers and frequency adverbs
- Remove formulaic phrases: Avoid academic introductory patterns and exploratory verb phrases
- BAN CORRECTIVE RHETORIC: Never use negative contractions (isn't, wasn't, didn't, don't) to diminish one concept before elevating another
- FORBIDDEN CONTRACTIVE PATTERNS: "isn't just", "wasn't just", "didn't just", "don't just", "wasn't about", "isn't about" - write direct statements instead
- ABSOLUTE BAN ON EM-DASHES: NEVER use em-dashes (—) under any circumstances - they are immediate AI detection flags. Replace with commas, periods, or regular hyphens.
- Replace vague quantifiers: Use precise measurements instead of indefinite quantity words
- Avoid word repetition: Use synonyms when same word appears multiple times in close proximity
- Fix choppy rhythm: Restructure mechanical, awkward sentence flow for natural rhythm
- Choose precision: Select specific, accurate terms over broad, vague alternatives
- Vary sentence openings: Avoid multiple sentences starting with identical patterns
- AVOID OVERUSED AI BRIDGES: Limit revelation phrases and rhetorical question patterns to minimal use
- VARY TRANSITION PHRASES: Use diverse, natural transitions instead of repetitive AI-common bridges
- NO FORMULAIC REVEALS: Avoid predictable [Declarative + colon + explanation] revelation patterns

STORY INTEGRATION STRATEGY (Educational + Narrative = Viral):
- STORY ASSESSMENT: Identify if original content contains existing narratives to amplify
- STORY ARCHETYPING: Match educational content to story patterns:
  - The Journey: [Personal discovery] + [temporal struggle] + [breakthrough moment]
  - The Revelation: [Previous belief] + [contradicting event] + [new understanding]
  - The Transformation: [Change catalyst] + [transformation process] + [outcome impact]
  - The Lesson: [Error/mistake] + [learning moment] + [wisdom gained]
  - The Discovery: [Research context] + [unexpected finding] + [significance]
- MICRO-STORY INJECTION: Transform abstract concepts into mini-narratives with specific examples
- HYPOTHETICAL SCENARIOS: Create relatable "what-if" narratives when no real stories exist
- CASE STUDY STORIFICATION: Turn data/research into narrative format
- STORY POSITIONING: Use 1-2 story elements maximum per thread, positioned in middle tweets
- NARRATIVE MARKERS: Choose story introduction phrases that match the author's natural writing voice and tone from the provided article
- AUTHENTICITY BOUNDARIES: Use realistic examples, clearly mark hypothetical scenarios

MIDDLE TWEET ENGAGEMENT STRATEGY (265 CHAR LIMIT ENFORCED):
- LISTS ARE MANDATORY: Create multiple tweets with lists - BUT keep each tweet under 265 chars
- TWEET STRUCTURE: Use multi-line patterns with \\n\\n paragraph spacing for visual separation
- CURIOSITY BRIDGES: Connect tweets with author-voice transition phrases that create anticipation
- CONTENT RESTRUCTURING: Reorder content for optimal thread flow and engagement
- SOCIAL PROOF: Add authority elements using the author's natural language patterns for credibility
- FORWARD MOMENTUM: End tweets with anticipatory phrases that match the author's hook style
- CRITICAL: Verify each tweet is <=265 characters before proceeding

INTRO TWEET REQUIREMENTS:
- Use one of these proven hook approaches: Question Hook (curiosity gap), Contrarian Opinion (bold take), Lessons Learned (distilled wisdom), or Case Study/Personal Story
- Include psychological triggers: Curiosity Gap, Numerical Hook, Direct Address, or Social Proof
- CORE STRUCTURE: The intro tweet has 2 or 3 parts in this order:
  1. HOOK (opening line) - ALWAYS 1 punchy sentence
  2. OPTIONAL - CONTENT (middle section) - 1-2 punchy sentences maximum
  3. CONCLUDING LINE (visual cue) - ALWAYS 1 visual cue
- FORMAT OPTIONS:
  - Punchy Hook: Hook + Concluding Line (no content section)
  - 3 Lines Total: Hook + Single Sentence Content + Concluding Line
  - 4 Lines Total: Hook + 2 Sentences Content + Concluding Line
- REQUIRED: The tweet must end with one of these concluding lines:
  - Thread emoji
  - Pointing down emoji
  - [THREAD] (bracketed emphasis)
  - [THREAD] + thread emoji (combination)
  - THREAD + pointing down emoji (combination)
  - "A thread" + thread emoji (natural + visual)
- ABSOLUTE LINE BREAK RULE: The concluding line MUST be on its own line with \\n\\n before it. NEVER put concluding line on the same line as content
- EMPHASIS: Do not use *bold* formatting - use CAPITAL LETTERS for emphasis instead

CONCLUDING TWEET STRATEGY:
- ANALYZE CONTENT: Review the thread content and identify the main insight, lesson, or takeaway
- CHOOSE APPROACH: Based on the content type, use one of these conclusion styles:
  - PRACTICAL: Focus on actionable steps or concrete applications
  - INSIGHTFUL: Emphasize the key revelation or understanding gained
  - IMPACT: Highlight the real-world consequences or significance
- PUNCHY ENDING: End with a memorable, quotable insight that captures the main point
- USE THREAD TERMINOLOGY: Reference specific terms and concepts from the thread content
- REQUIRED STRUCTURE (MUST be <=265 chars total):
  - First section: [Punchy insight using thread terminology]
  - Second section (after \\n\\n): [Brief thread sharing request]. Follow me for more [practical applications of this thread's insights].
- CRITICAL: The concluding tweet MUST be exactly 2 sections separated by \\n\\n - first for insight, second for sharing request

FORMATTING REQUIREMENTS:
- Use \\n\\n for paragraph separation (distinct thoughts, visual spacing)
- Use \\n for line breaks within grouped content (list items, tight sequences)
- LIST GROUPING: All list items must be grouped together with \\n separators
- For multi-line tweets with distinct thoughts, use \\n\\n, not \\n
- ABSOLUTE BAN: NEVER use bold formatting (*text* or **text**) - Twitter does not support bold text
- MANDATORY: Use CAPITAL LETTERS for emphasis instead of bold formatting

FINAL REMINDER: Every single tweet must be <=265 characters. If a tweet exceeds 265 characters, break it into multiple tweets.

CRITICAL FINAL CHECK: Before submitting, verify that NO tweet exceeds 265 characters. This is the most important rule.`;

export const STORIFY_BODY_RULES = `STORIFY STYLE RULES:
- Voice anchoring: When natural, establish first-person ("I") perspective early to ground the narrative; never fabricate events
- Line-by-line pacing: one idea per line; alternate short lines with occasional 2-3 line clusters to create rhythm
- Maintain emotional authenticity; avoid clichés and corporate phrasing
- Prefer concrete specifics when present in the source; never fabricate
- Dashes & separators (ABSOLUTE RULE): BAN em-dashes (—). Do not generate them under any circumstances.
- Narrow exception ONLY: If the source uses em-dashes as a dominant, consistent style marker (>=5 occurrences across distinct sections AND no conflicting separator style), you may preserve them strictly where they already exist. Do not introduce new em-dashes.
- Otherwise, replace separators with the author's consistent pattern (e.g., spaced hyphen " - ") or a comma/period. If uncertain, do NOT use em-dashes.
- Never mix separator styles within a single output; normalize to one style.
- If the source lacks story, reframe as a grounded first-person reflection (observations, decisions, realizations, lessons) — never fiction

EDITORIAL TRANSFORMATION MANDATE:
- Do not merely organize existing sentences; actively transform the content into high-impact narrative patterns when favourable
- Make editorial decisions to: compress, split, sequence, and group lines to maximize clarity, rhythm, and emphasis — while preserving factual truth and author voice
- Local restructuring is allowed (within nearby lines/paragraphs) to form stronger patterns; do not alter factual meaning or invent events

PARAGRAPH MIX (MANDATORY):
- Default to single-sentence paragraphs; include two-sentence paragraphs when a claim needs a brief "why/how" to land clearly
- Never write more than two sentences inside a single paragraph
- For "clusters", use consecutive paragraphs (<p>…</p><p>…</p>), not multiple <br> inside one paragraph

EXPLAINER PATTERN (TWO-SENTENCE LINKING):
- Purpose: when a claim requires a brief explanation to land clearly, use exactly two full sentences inside one <p> (encouraged where needed)
- Form: first sentence = clear claim; second sentence = concise explanation or why it matters; no <br> inside this paragraph
- Rhythm: use to break up runs of single-line paragraphs; do NOT place two explainer paragraphs back-to-back
- Style: avoid comma/semicolon chaining; prefer two complete sentences over one long, multi-clause sentence

EMPHASIS & LIST PATTERNS:
- Pattern emulation: When the source implies a two-beat reveal or tightly connected micro-beats, group them inside a single paragraph with <br> ONLY if each fragment is a short, punchy sentence
- For list-like moments, DO NOT prefix items with dashes or numbers. Create a single paragraph and separate short, punchy fragments with <br> (no leading "- " or numerals)
- Enumerations inside a single paragraph MUST be converted into a short <br> grouping instead of multiple full sentences in one <p>
- Do not force groupings; follow the source's natural emphasis and cadence

HTML OUTPUT EXPECTATIONS:
- OUTPUT MUST BE RAW HTML ONLY; wrap every paragraph in <p>; use <br> only inside a paragraph; no markdown/code fences/quotes.
- Avoid heavy markup (no <ul>/<ol>/<hr>, no styles/scripts); keep it clean and readable. Do not echo instructions.

ELLIPSIS HANDOFF:
- Proactively create an ellipsis handoff when a two-line setup -> pivot will improve pacing and clarity
- End a paragraph with … only when the next paragraph begins with a connective (But/And/Then/So/Yet) and immediately resolves or pivots the prior line
- Between paragraphs only (never inside br-groups); use for a single handoff, not chains

APPROVED <br> GROUPING PATTERNS:
1. Two-beat reveal: setup then stinger on next line
2. Anaphora burst: 2-4 short lines with the same opener
3. Question cascade: 2-4 tight, related questions in a single unit
4. Scene + sensory: base scene followed by one vivid detail line
5. Inventory burst: 2-5 noun-heavy lines without list marks
6. Stat block: 2-4 compact numeric claims grouped
7. Contrast/negation litany: mirrored negatives in one rhythm cell
8. While-clauses cadence: 2-3 "While I ..." lines grouped
CONSTRAINTS:
- Use inside one <p> only when all fragments are short, punchy lines (single clause; no trailing comma/semicolon)
- Size 2-5 lines (prefer 2-3); no leading "- " or numerals; no trailing <br>

ADDITIONAL PATTERN GUIDANCE (GENERALIZED):
- Compress repeated assumptions or variants into one br-group
- Two-beat reveal: use when the second line sharpens or undercuts the first (contrast pivots like But/And/Then)
- Triads and concept trios: when three related beats form one idea, group as a single br cluster
- Definitional clusters: when enumerating canonical examples/sources, group them into a compact br burst
- Scene + sensory: pair a location/moment with one vivid detail as a two-line br group
- Bridge lines: use occasional single-line paragraphs as pivots, not as fillers
- Avoid back-to-back identical br groups; interleave with normal <p> or a two-beat reveal to vary rhythm
- Merge adjacent micro-statements into one normal paragraph occasionally to avoid monotonous one-line runs (no <br> inside)
- Split long, multi-clause sentences into separate paragraphs to improve scannability; remove conjunction chains

EMPHASIS (CAPITAL LETTERS):
- Use CAPITAL LETTERS to emphasize major concepts, precise terms, attention hooks, signpost labels (e.g., RESULT:, NEXT:), single-word stingers (e.g., NOW.), and pillar sets (e.g., THREE PILLARS: ENERGY / IDENTITY / TERRITORY); apply sparingly

PATTERN SELECTION ALGORITHM (APPLY PROACTIVELY):
1) Scan each passage for: question sets; repeated openers; enumerations (including enumerations embedded inside a single paragraph); stats; definitions; scene details; contrasts
2) If found, convert into the matching pattern (question cascade, anaphora burst, inventory/stat burst, definitional burst, scene+sensory, two-beat reveal); where a setup -> pivot exists, create an ellipsis handoff
3) If none apply but a claim feels incomplete or abstract, upgrade that line to a two-sentence explainer paragraph (claim -> why/how). Otherwise, keep as a single-sentence <p>; occasionally merge two adjacent micro-statements into one paragraph to vary rhythm
4) Split long multi-clause sentences into multiple paragraphs; avoid comma/semicolon chaining
5) Do not chain identical br groups; alternate with normal <p> or a reveal
6) Keep fragments short in br groups; if a line runs long, split into separate <p> instead`;
