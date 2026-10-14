/**
 * Curated training-data author list for anchor blending.
 * Ported from openwriter-site/src/lib/writers-voice/author-hints.ts
 */

export const AUTHOR_HINTS: { author: string; category: string; style_note: string }[] = [
  { author: 'Ernest Hemingway', category: 'literary', style_note: 'iceberg theory, short declarative, almost no adjectives, hard nouns and verbs' },
  { author: 'Cormac McCarthy', category: 'literary', style_note: 'no commas in dialogue, long unpunctuated runs, biblical cadence' },
  { author: 'Joan Didion', category: 'literary', style_note: 'measured precision, lists of three, the specific over the general' },
  { author: 'David Foster Wallace', category: 'literary', style_note: 'maximalist sentences, footnote energy, recursive parentheticals, vocabulary' },
  { author: 'Toni Morrison', category: 'literary', style_note: 'rhythmic repetition, sensory specificity, vernacular weaved with formal' },
  { author: 'James Baldwin', category: 'literary', style_note: 'long balanced sentences, moral urgency in clause stacking, semicolons used as breath marks' },
  { author: 'Annie Dillard', category: 'literary', style_note: 'observational compression, present-tense immediacy, sentence as image' },
  { author: 'Marilynne Robinson', category: 'literary', style_note: 'theological cadence in plain words, long meditative sentences, Calvinist patience' },

  { author: 'Paul Graham', category: 'essayist', style_note: 'thinking out loud, simple words, short sentences mixed with one long earned conclusion' },
  { author: 'Patrick McKenzie', category: 'essayist', style_note: 'long discursive sentences with parenthetical asides, domain-specific precision, dry humor' },
  { author: 'Tim Urban', category: 'essayist', style_note: 'extended metaphors, conversational asides, building up frameworks with named characters' },
  { author: 'Scott Alexander', category: 'essayist', style_note: 'rationalist sectioning, exhaustive enumeration of possibilities, fair-witness analysis' },
  { author: 'Ben Thompson', category: 'essayist', style_note: 'business-strategy decomposition, recurring framework names, lots of "this is why"' },
  { author: 'Tyler Cowen', category: 'essayist', style_note: 'compressed, list-heavy, blogger-shorthand, range of references in one paragraph' },
  { author: 'Malcolm Gladwell', category: 'essayist', style_note: 'narrative anchor → general principle → reversal, three-act essay structure' },
  { author: 'Adam Grant', category: 'essayist', style_note: 'research-anchored, paired contrasts, gentle prescriptive framing' },

  { author: 'Mark Manson', category: 'self-help', style_note: 'period-heavy clean prose, "Your X is Y" definitional moves, profane confidence, direct second-person' },
  { author: 'James Clear', category: 'self-help', style_note: 'concept-coinage backbone, numbered enumeration, clean instructional cadence, named laws/frameworks' },
  { author: 'Ryan Holiday', category: 'self-help', style_note: 'Stoic-instructional, drawing concepts from antiquity, clean delivery, repetition for emphasis' },
  { author: 'Tim Ferriss', category: 'self-help', style_note: 'list-heavy, hack/protocol framing, second-person direct, capitalized concept names' },
  { author: 'Cal Newport', category: 'self-help', style_note: 'academic-instructional, named frameworks, research-backed prescriptions, sober register' },
  { author: 'Greg McKeown', category: 'self-help', style_note: 'one-idea-per-page rhythm, named principles, short paragraphs, prescriptive minimalism' },
  { author: 'Brené Brown', category: 'self-help', style_note: 'vulnerability-as-rhetoric, personal anecdotes anchoring research, conversational warmth' },

  { author: 'Nassim Nicholas Taleb', category: 'polemicist', style_note: 'concept-coinage (Black Swan, antifragile), aphoristic stabs, attacking IYI, ancient-thinker citations' },
  { author: 'Jordan Peterson', category: 'polemicist', style_note: 'lecture cadence, biological-evolutionary framing, religious overlay, definitional pivots' },
  { author: 'Curtis Yarvin', category: 'polemicist', style_note: 'reactionary historical, concept-naming as branding, sneering wit, long allusive sentences' },
  { author: 'Camille Paglia', category: 'polemicist', style_note: 'punchy contrarian, aesthetic-biological frame, dense allusion, no hedging' },
  { author: 'Bryan Caplan', category: 'polemicist', style_note: 'libertarian-economic, direct refutation, hypothetical thought experiments, plain professorial prose' },

  { author: 'Naval Ravikant', category: 'tech', style_note: 'aphoristic, tweet-shaped, concept-as-brand, distilled-wisdom cadence' },
  { author: 'Marc Andreessen', category: 'tech', style_note: 'manifesto-mode, accumulating short declarative lines, exhortation register' },
  { author: 'Sam Altman', category: 'tech', style_note: 'short, contrarian, "obvious in hindsight" framing, blog-post brevity' },
  { author: 'Peter Thiel', category: 'tech', style_note: 'paradox-as-thesis, philosophical-tech crossover, Strauss-influenced indirection' },
  { author: 'Joel Spolsky', category: 'tech', style_note: 'conversational tech-blog, anecdote-then-principle, signposting humor' },
  { author: 'Steve Yegge', category: 'tech', style_note: 'long discursive rants, programmer-culture inside jokes, accumulating digressions' },

  { author: 'Michael Lewis', category: 'journalist', style_note: 'character-first reporting, scene-as-argument, clean unobtrusive prose' },
  { author: 'Sebastian Junger', category: 'journalist', style_note: 'documentary precision, anthropological framing, present-tense narrative' },
  { author: 'Jon Krakauer', category: 'journalist', style_note: 'present-tense urgency, sensory immediacy, restraint in adjective use' },
  { author: 'John McPhee', category: 'journalist', style_note: 'list-as-paragraph, structural patterning, long sentences with specific detail' },
  { author: 'Ta-Nehisi Coates', category: 'journalist', style_note: 'meditative-historical, repetition as emphasis, address as form of argument' },
  { author: 'Tom Wolfe', category: 'journalist', style_note: 'New Journalism, exclamation, capitalization, italics for sound, voice-jumping' },

  { author: 'David Sedaris', category: 'memoirist', style_note: 'comic understatement, family scenes, deadpan one-liners as paragraph closers' },
  { author: 'Anne Lamott', category: 'memoirist', style_note: 'confessional warmth, self-deprecating humor, sentence fragments for emphasis' },
  { author: 'Anthony Bourdain', category: 'memoirist', style_note: 'profane confidence, food as window, baroque vocabulary mixed with kitchen-slang' },
  { author: 'Rick Bragg', category: 'memoirist', style_note: 'Southern oral cadence, specific-detail compression, sentence rhythms from speech' },
  { author: 'Mary Karr', category: 'memoirist', style_note: 'lyric memoir, line-break-tight sentences, Catholic-rural register' },

  { author: 'La Rochefoucauld', category: 'aphorist', style_note: 'epigrammatic, paired antithesis, cynical wit in one breath' },
  { author: 'Friedrich Nietzsche', category: 'aphorist', style_note: 'aphoristic, hammer-blows of declaration, philosophical provocation' },
  { author: 'E.M. Cioran', category: 'aphorist', style_note: 'pessimistic aphorism, paradoxical brevity, polished despair' },
  { author: 'Eric Hoffer', category: 'aphorist', style_note: 'longshoreman intellectual, declarative wisdom, sociological observation' },

  { author: 'Steven Pinker', category: 'academic-popular', style_note: 'cognitive-science precision, numbered argument, defending Enlightenment, ironic asides' },
  { author: 'Richard Dawkins', category: 'academic-popular', style_note: 'precise zoological prose, metaphor as scaffolding, polemical clarity' },
  { author: 'Robert Sapolsky', category: 'academic-popular', style_note: 'neuroendocrine framing, dense citation, jokes nested in dense paragraphs' },
  { author: 'Carl Sagan', category: 'academic-popular', style_note: 'cosmic-scale lyric, science-as-wonder cadence, accessible majesty' },
  { author: 'Daniel Kahneman', category: 'academic-popular', style_note: 'System 1 / System 2 framing, dispassionate exposition, named cognitive biases' },
  { author: 'Yuval Noah Harari', category: 'academic-popular', style_note: 'sweeping historical synthesis, declarative simplification, "imagined orders" type concepts' },
  { author: 'Jared Diamond', category: 'academic-popular', style_note: 'continent-scale comparison, geographic-determinist framing, list of factors enumeration' },

  { author: 'C.S. Lewis', category: 'religious-philosophical', style_note: 'clear analogical prose, common-sense apologetics, "imagine that" framing' },
  { author: 'G.K. Chesterton', category: 'religious-philosophical', style_note: 'paradox-as-rhetoric, joyful contrarian, accumulating images per sentence' },
  { author: 'Thomas Merton', category: 'religious-philosophical', style_note: 'contemplative prose, slow paragraphs, Catholic-Buddhist hybrid' },

  { author: 'Peter Drucker', category: 'business', style_note: 'dry analytical, principle-then-example, professorial calm' },
  { author: 'Andy Grove', category: 'business', style_note: 'engineering-direct management, framework-naming, lean instructional' },
  { author: 'Ben Horowitz', category: 'business', style_note: 'war-stories anchored to lessons, hip-hop epigraphs, conversational toughness' },

  { author: 'Visakan Veerasamy', category: 'short-form', style_note: 'thread-shaped, hyperlinked references, generous tone, recursive callbacks' },

  { author: 'Ocean Vuong', category: 'poetic-prose', style_note: 'lyric memoir, line-conscious paragraphs, image-as-argument' },
  { author: 'Maggie Nelson', category: 'poetic-prose', style_note: 'theory-personal hybrid, numbered fragments, citations interleaved' },
];

export function getAuthorHintBlock(): string {
  const byCategory: Record<string, typeof AUTHOR_HINTS> = {};
  for (const a of AUTHOR_HINTS) {
    (byCategory[a.category] ||= []).push(a);
  }
  const lines: string[] = [];
  for (const [cat, authors] of Object.entries(byCategory)) {
    lines.push(`\n[${cat}]`);
    for (const a of authors) {
      lines.push(`- ${a.author}: ${a.style_note}`);
    }
  }
  return lines.join('\n');
}
