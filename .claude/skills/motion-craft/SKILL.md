---
name: motion-craft
description: The quality bar for anything this studio makes - typography, motion timing and easing, composition, colour, texture, the social hook, and what never ships (placeholder art, default type, PowerPoint motion). Read before designing concepts, styleframes or shots, and when judging whether a frame is good enough to show.
---

# Craft

The bar is the best finished films in this studio and the references in `refs/`. Nothing below that
bar is shown to the client: not a test, not a draft, not a "just to check".

## Never

- Placeholder art: blobs, grey boxes, stub shots, lorem, emoji standing in for a character. If the
  style needs a character, it gets real art (generated, or drawn with care in code).
- Default or system fonts, unstyled Canvas text, more than two families (plus a mono for labels).
- PowerPoint motion: everything centred, same size, same fade, same speed.
- Busy picture behind text. Text on a clean area, or on a panel of its own.
- Two ideas in one shot. A cut without a reason.

## Typography

- One display face, one text face, a mono for micro-labels. Contrast by size and weight.
- Scale at 1080 (multiply by F.u): hero 180-260, h1 130-160, h2 90-110, body and captions 40-54,
  micro 20-26 (decorative). A modular ratio (1.333 or 1.5) keeps sizes related.
- Tracking: display -2 to -4 % of size, caps labels +6-10 %. Headlines at most ~28 characters a line,
  2 lines for a hero.
- Kinetic type: words enter with 50-90 ms stagger, 350-550 ms each, snap easing; exits are quicker
  (250-350 ms) and simpler. A line holds at least 1 s + 0.25 s per word.
- Vary the scale over a film: hero moments (a word filling the frame) against subtitle moments. At the
  hook, text is big and present.

## Motion

- Entrances snap and settle (E.snap, bezier .16 1 .3 1); moves between states swift (inOutCubic);
  linear only for constant drift and spin. Overshoot at most 8 % (outBackSoft), none for premium.
- Duration grows with distance: small UI 200-300 ms, cards 400-600 ms, camera 0.8-1.5 s.
- Snap, then hold: a move is short, the rest after it is long enough to read.
- Living things never freeze: breath, sway, blink, weight shift. Anticipation before a jump, follow-
  through after a stop, secondary motion on loose parts.
- Transitions connect: match cuts on shape or position, an object becoming the next scene, cuts and
  flashes on the beat. Motion blur on (shutter 0.5).

## Composition and colour

- One focal point per frame; the strongest contrast sits on it. Subject on one third, type on the
  other, planned in the storyboard.
- 60-30-10: ground, support, accent. The accent marks the one thing to look at.
- Depth: foreground, subject, background; parallax sells it. Light has a direction.
- 9:16 is composed, not cropped: stack vertically, keep text in y 220-1560 and x 80-940.
- Texture makes it feel made: grain 0.02-0.04, paper, a subtle vignette. Bloom on dark shots only.

## The hook (social)

The first 1-2 s decide everything: a bold image and big type from frame 1, motion from frame 1, no
fade-in from black, no logo first. Deliver the promise of the video immediately. Give the end a
payoff or a loop back to the start.

## The poster test

Pause anywhere: would the frame work as a poster? Stills at the hook, at every section change and at
the most complex moment must pass it. Put your frame beside the reference stills in `refs/` and ask
honestly whether it belongs in that company. If not, it is not done.
