---
name: motion-brief
description: Turn a one-line request into a film brief in this studio - intake questions, style direction from the style cards, research of official brand assets and facts, the Truth list. Use at the start of any new motion video, or when the user gives a subject, brand or product for a film.
---

# Brief

Goal: `<film>/brief.md` complete enough that storyboard and build need no guessing.

## Ask only what you cannot find (one AskUserQuestion, up to 4 questions)

- Length and formats (default: 30 s spot or 45-60 s music clip; 16:9 + 9:16).
- Style direction: offer 3-4 cards from `styles/README.md` as a line-up, each with one line on what
  it looks like; include the continuous brand reel (card A) as an option for brand work.
- Song (music videos): write lyrics together and generate with Runway, or a supplied track.
- On-screen language.
Everything else (palette, type, facts) comes from research.

## Research (a subagent keeps big pages out of context)

- The brand's own site, docs, brand kit, press page, app bundle. Get the logo as SVG path data,
  colours as hex, fonts (use the real font if it is free, else an OFL stand-in from Google Fonts:
  say which), the mascot if any, real UI (screenshots via the browser at 2x into `<film>/ref/`).
- Product truth: what it does, in the product's own words; numbers with their date; handles checked
  on the platform (a handle that looks right can be wrong: open it and see that it resolves).
- Write every fact into brief.md under Truth with where it was checked.

## brief.md sections

Brief (what, who, where it runs, length, formats, must show, feel in three words, style card),
Truth, Art direction (palette, type pairing, look chain from `looks.js`, texture, camera),
Sound (song or score, tempo, the moments the sound must hit), Lyrics (music videos).

Keep styles independent: a style chosen for one film does not leak names or motifs into another.
