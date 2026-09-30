---
name: motion-film
description: Make a motion video end to end in this studio (music video, brand or product spot, launch film, showreel, social ad). Use when the user asks for a motion video, reel, spot, music video or animation, or to continue one. Runs the motion-video workflow (.claude/workflows/motion-video.js) from the user's brief, or its stages by hand.
---

# Making a film

The default is the workflow: `Workflow({ name: 'motion-video', args: { brief: '<the user's words>' } })`.
It runs brief -> concept -> sound -> plan -> look -> build -> review -> deliver with a team of agents
(WORKFLOW.md explains every stage). Pass the user's words verbatim as `brief`; add `refs`, `formats`,
`credits`, `gate: 'look'` if they asked to approve the look first, `from` + `film` to resume,
`until` to stop early.

Before calling it:
- Read the film's notes.md and brief.md if the film exists (a resume), and the latest chat feedback.
- Say in one or two lines what will happen and roughly what it costs (credits cap, time).
While it runs, relay progress briefly. When it returns, look at the deliverables yourself
(styleframes sheet, frames from the preview encode), then send the phone preview with SendUserFile
and say where the masters are. If it stopped at the look, send the styleframes and ask for the yes.

## By hand (a small change, a single stage, a fix)

The stages map to skills: motion-brief, motion-song, motion-storyboard, motion-art, motion-build,
motion-review, motion-deliver; motion-craft is the bar for all of them. Resume the workflow with
`from` when a stage needs redoing wholesale (e.g. `{ film, from: 'review' }` after notes).

## Habits that make the films good

- The user judges by watching: clarity and fidelity first, density last. Nothing below the bar of
  their reels is shown to them, ever: no tests, no placeholders.
- One idea per beat, held long enough to read; transitions carry meaning or land on the beat.
- Real assets only; generated media is a base that code redraws.
- Look at every change through frames; never claim what you have not looked at.
