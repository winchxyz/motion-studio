export const meta = {
  name: 'motion-video',
  description: 'Make a motion video from one brief: research, three concepts judged by a panel, sound, storyboard, style sheet and assets, styleframes, every shot built and reviewed in parallel, whole-film critic loops, delivery in every format',
  whenToUse: 'The user describes a video to make (music video, brand or product spot, launch film, showreel, social ad). args: { brief, film?, notes?, refs?, formats?, gate?: "look" | "none", from?, until?, credits?, rounds?, models?: { worker?, judge? }, listen?: false }. It stops after the song for the user to listen; resume with from: "plan".',
  phases: [
    { title: 'Brief', detail: 'film folder, brief.md, references, truth and zeitgeist' },
    { title: 'Concept', detail: 'three directions, a judge panel, one concept' },
    { title: 'Sound', detail: 'the song or the score, timed' },
    { title: 'Plan', detail: 'storyboard on the grid, composition and text plan, shot list' },
    { title: 'Look', detail: 'style sheet, characters, sets, clips, style.js, styleframes' },
    { title: 'Build', detail: 'every shot built, reviewed and fixed' },
    { title: 'Review', detail: 'whole-film critics and fixes until clean' },
    { title: 'Deliver', detail: 'every format, masters, previews, post copy' },
  ],
}

// ------------------------------------------------------------------ setup
const A = args || {}
const STAGES = ['brief', 'concept', 'sound', 'plan', 'look', 'build', 'review', 'deliver']
const from = STAGES.indexOf(A.from || 'brief')
const until = STAGES.indexOf(A.until || 'deliver')
if (from < 0 || until < 0) throw new Error(`from and until must be among ${STAGES.join(', ')}`)
if (from === 0 && !A.brief) throw new Error('args.brief is required: describe the video to make')
if (from > 0 && !A.film) throw new Error('args.film is required when resuming with args.from')
// the studio root: args.root, else the top of the git repository the session runs in
const ROOT = A.root ? String(A.root).replace(/[\\/]+$/, '') : null
const inRoot = p => (ROOT ? `${ROOT}/${p}` : p)
const GATE = A.gate || 'none'
const ROUNDS = A.rounds || 3
// The makers (research, concepts, sound, storyboard, art, styleframes, builders, fixers, delivery) run on Sonnet;
// the eyes (the judges, the concept synthesis and every critic) on Opus. args.models = { worker, judge } overrides.
const MAKER = { model: A.models?.worker || 'sonnet' }
const EYE = { model: A.models?.judge || 'opus' }
// shot builders and fixers think less per step (Sonnet's recommended effort for multi-step agent work)
const BUILDER = { ...MAKER, effort: A.models?.builderEffort || 'medium' }
let CREDITS = A.credits ?? 150          // Runway credits this run may spend
let spent = 0
const allowance = share => Math.max(0, Math.floor((CREDITS - spent) * share))
const run = at => from <= STAGES.indexOf(at) && STAGES.indexOf(at) <= until

const COMMON = `You are part of the studio's motion-video workflow. Studio root: ${ROOT || 'the top of this git repository (git rev-parse --show-toplevel)'}; run every command from there; its CLAUDE.md applies.
Read these skills before working: .claude/skills/motion-craft/SKILL.md (the quality bar) and the ones named below.
Work only inside the film folder you are given unless told otherwise. Edit code with Edit/Write, never Bash heredocs.
Look at your own output (render stills or sheets and Read the images) before you report; report honestly what you saw.
Every turn re-reads everything already in your context, so keep it lean: read only the parts of files your task
needs, batch your edits between renders, and look at sheets small (--tw 240) and at full-size stills only where
you need the detail. Work in few, deliberate passes: make all the edits a change needs, then render once and look;
about three render-and-look passes per task, not dozens. While iterating render with --samples 2 (add --scale 0.5
for motion checks); full samples only for the final check.${A.notes ? `
Studio notes for this run (from the director, not the client): ${A.notes}` : ''}`

const S_SETUP = { type: 'object', required: ['film', 'kind', 'title', 'duration', 'formats', 'summary'], properties: {
  film: { type: 'string' }, kind: { type: 'string', enum: ['music-video', 'spot'] }, title: { type: 'string' },
  duration: { type: 'number' }, formats: { type: 'array', items: { type: 'string' } }, credits_available: { type: 'number' },
  summary: { type: 'string' } } }
const S_CONCEPT = { type: 'object', required: ['name', 'logline', 'hook', 'story', 'visual', 'technique', 'text_strategy', 'credits_estimate', 'why'], properties: {
  name: { type: 'string' }, logline: { type: 'string' }, hook: { type: 'string' }, story: { type: 'array', items: { type: 'string' } },
  visual: { type: 'string' }, technique: { type: 'string' }, text_strategy: { type: 'string' }, risks: { type: 'string' },
  credits_estimate: { type: 'number' }, why: { type: 'string' } } }
const S_JUDGE = { type: 'object', required: ['scores'], properties: { scores: { type: 'array', items: { type: 'object', required: ['name', 'score', 'note'], properties: {
  name: { type: 'string' }, score: { type: 'number' }, note: { type: 'string' } } } } } }
const S_DONE = { type: 'object', required: ['ok', 'summary'], properties: {
  ok: { type: 'boolean' }, summary: { type: 'string' }, credits_spent: { type: 'number' }, files: { type: 'array', items: { type: 'string' } } } }
const S_PLAN = { type: 'object', required: ['shots', 'assets'], properties: {
  shots: { type: 'array', items: { type: 'object', required: ['id', 'at', 'summary', 'technique'], properties: {
    id: { type: 'string' }, at: { type: 'number' }, dur: { type: 'number' }, summary: { type: 'string' }, technique: { type: 'string' },
    assets: { type: 'array', items: { type: 'string' } }, styleframe: { type: 'boolean' } } } },
  assets: { type: 'array', items: { type: 'object', required: ['id', 'kind', 'brief'], properties: {
    id: { type: 'string' }, kind: { type: 'string', enum: ['character', 'set', 'still', 'clip', 'font', 'other'] }, brief: { type: 'string' },
    generate: { type: 'boolean' }, depends_on: { type: 'array', items: { type: 'string' } } } } } } }
const S_FINDINGS = { type: 'object', required: ['findings'], properties: { findings: { type: 'array', items: { type: 'object', required: ['shot', 'issue', 'fix', 'severity'], properties: {
  t: { type: 'number' }, shot: { type: 'string' }, issue: { type: 'string' }, fix: { type: 'string' }, severity: { type: 'string', enum: ['major', 'minor'] } } } } } }

// ------------------------------------------------------------------ 1. brief
let F = { film: A.film }
if (run('brief')) {
  phase('Brief')
  F = await agent(`${COMMON}
Skills: motion-brief, motion-film.
The user's brief, verbatim:
"""${A.brief}"""
${A.refs?.length ? `References given: ${A.refs.join(', ')}` : ''}
${A.formats ? `Formats requested: ${A.formats.join(', ')}` : ''}
1. Decide the film: ${A.film ? `the folder is "${A.film}" (it may already hold research: read it first and keep it)` : 'a short folder name (a-z, 0-9, -)'}, music-video or spot, a working title, the length
   in seconds (music videos: whole bars of the song later; default 45-60 s; spots 30 s) and the formats
   (default h and v).
2. If <folder> does not exist in the studio root, create it: node studio/tools/new-film.mjs <folder> --template <kind> --title "<title>".
3. Fill brief.md's Brief section from the user's words (keep their words where they are specific).
4. Runway: call whoami and report credits.total as credits_available (0 if Runway is unavailable).
Return the structured summary.`, { ...MAKER, label: 'setup', schema: S_SETUP })
  if (!F) throw new Error('setup failed')
  if (typeof F.credits_available === 'number') CREDITS = Math.min(CREDITS, Math.max(0, F.credits_available - 10))
  log(`${F.film}: ${F.kind}, ${F.duration} s, formats ${F.formats.join('/')}; up to ${CREDITS} Runway credits`)
  const dir = inRoot(F.film)
  await parallel([
    () => agent(`${COMMON}
Skills: motion-reference.
Film folder: ${dir}. Brief: ${dir}/brief.md.
Find what this film should learn from. ${A.refs?.length ? `Download and break down the given references (${A.refs.join(', ')}) with yt-dlp and studio/tools/breakdown.py into refs/.` : 'Use refs/ and styles/README.md, and search the web for 3-6 strong motion pieces close to this brief (music videos, title sequences, launch films).'}
For each: what makes it work (hook, one idea per section, type treatment, transitions, pacing numbers where measured).
Write ${dir}/research/references.md: the takeaways this film should use, each concrete enough to design from.`, { ...MAKER, label: 'references', phase: 'Brief' }),
    () => agent(`${COMMON}
Skills: motion-brief.
Film folder: ${dir}. Brief: ${dir}/brief.md.
Research the subject. For a brand or product: official assets (logo as SVG path data, colours, fonts or the
closest free stand-ins, the real UI), what it does in its own words, numbers with dates, handles checked on the
platform. For a cultural or AI topic: the events, memes, phrases and images the audience knows (dates,
sources), and which of them read instantly on screen. Everything with its source.
Write ${dir}/research/truth.md and fill the Truth section of brief.md.`, { ...MAKER, label: 'truth', phase: 'Brief' }),
  ])
}
const DIR = inRoot(F.film)

// ------------------------------------------------------------------ 2. concept (judge panel)
if (run('concept')) {
  phase('Concept')
  const LENSES = [
    ['type', 'carried by typography and graphic systems: the lyrics or lines ARE the picture, with a strong graphic world around them'],
    ['world', 'carried by a protagonist and a world: generated characters and sets, redrawn and animated in code'],
    ['technique', 'carried by a striking rendering idea (3D, footage redrawn as ink or print, a physical texture) that makes people ask how it was made'],
  ]
  const concepts = (await parallel(LENSES.map(([key, lens]) => () => agent(`${COMMON}
Skills: motion-storyboard, motion-art, motion-film.
Film folder: ${DIR}. Read brief.md, research/references.md, research/truth.md, styles/README.md.
Invent ONE concept for this film, ${lens}. It must be different in subject, view and rendering from the
obvious version. Give: a name, a one-line logline, the hook (exactly what the first 2 s show and say), the
story as 5-10 beats, the visual system (palette hexes, type pairing, look chain from studio/engine/looks.js,
texture, camera language), the technique (what is code, what is generated stills, what is generated video,
what is 3D), the text strategy (where lyrics or lines are huge, where they are subtitles), risks, a Runway
credit estimate (images ~5-20 each, video far more; this run allows ${CREDITS}), and why it would travel on X.
Stay feasible for this engine within a few hours of building.
Make the pitch visible, the way a director pitches with frames: in ${DIR}/concepts/${key}/ write a small film
(film.json: fps 60, duration 3, formats ["h", "v"]; film.js drawing the hook and one key moment from the brand's
real assets with the engine) and render stills of both in 16:9 and 9:16
(node studio/tools/render.mjs ${DIR}/concepts/${key} --stills 0.8,2.2 --format h, then --format v).
These frames are what the judges and the client see first: they must meet motion-craft. No Runway spend here.
Save the pitch as ${DIR}/concepts/${key}.md with the stills embedded.`, { ...MAKER, label: `concept:${key}`, schema: S_CONCEPT })))).filter(Boolean)
  const JUDGES = [
    ['attention', 'the first 2 seconds, retention, how shareable it is on X, clarity of the idea'],
    ['craft', 'coherence of the visual system, typographic quality, whether it can look better than the references'],
    ['feasibility', 'what this engine, the Runway budget and a few hours of agent work can actually deliver at a high bar'],
  ]
  const text = JSON.stringify(concepts, null, 1)
  const verdicts = (await parallel(JUDGES.map(([key, lens]) => () => agent(`${COMMON}
Judge these concepts for the film in ${DIR} (brief.md) through one lens only: ${lens}.
Look at each concept's frames first (${DIR}/concepts/<key>/out/stills/, both formats), then read its pitch.
Score each 1-10 with a one-paragraph note. Be harsh; a 10 is better than every reference in refs/.
${text}`, { ...EYE, label: `judge:${key}`, schema: S_JUDGE })))).filter(Boolean)
  const total = {}
  for (const v of verdicts) for (const s of v.scores) total[s.name] = (total[s.name] || 0) + s.score
  const ranked = Object.entries(total).sort((a, b) => b[1] - a[1])
  log(`concept scores: ${ranked.map(([n, s]) => `${n} ${s}`).join(', ')}`)
  await agent(`${COMMON}
Skills: motion-film.
Film folder: ${DIR}. The concepts and the judges' verdicts:
${text}
${JSON.stringify(verdicts, null, 1)}
Take the winner (${ranked[0]?.[0]}), graft in the best ideas from the others where they strengthen it, fix what
the judges criticised, and write ${DIR}/concept.md: logline, hook, beats, visual system, technique, text
strategy, credit plan. Update brief.md's Art direction and Sound sections to match.`, { ...EYE, label: 'concept:final', schema: S_DONE })
}

// ------------------------------------------------------------------ 3. sound
if (run('sound')) {
  phase('Sound')
  const r = await agent(`${COMMON}
Skills: motion-song (music videos) or the spot template's sound.py (spots).
Film folder: ${DIR}. Read brief.md and concept.md.
Music video: use the user's song if the brief supplies one; otherwise write lyrics to the concept (lyrics.txt)
and generate the song with Runway generate_music (lyria-3-pro, 8 credits; two takes, so the user can choose;
allowance ${allowance(0.2)} credits). Save with node studio/tools/fetch.mjs (--cost), analyse with
python studio/tools/song.py <film>/assets/song.mp3 --lyrics <film>/lyrics.txt, choose the stretch the film uses
(start on a downbeat, whole bars), and set songStart, duration and audio in film.json. Nothing is built on audio
the user has not heard: cut what the film would use from each take (song, voice-over, music bed) into
out/listen-<name>.mp3 (a short fade at each end) and list those files in files. The user is waiting to listen,
so keep this stage short: the takes, the stretch and the listening files, then return; word timing checks and
document updates wait until after the user's pick.
Spot: set bpm and duration (whole bars) in film.json, plan the score in brief.md, and generate voice-over only
if the concept needs it (generate_speech, 1 credit per 50 characters; two voices to choose from).
Report the credits spent.`, { ...MAKER, label: 'sound', schema: S_DONE })
  spent += r?.credits_spent || 0
  // the user hears the audio before anything is built on it (args.listen: false skips this stop)
  const takes = (r?.files || []).filter(f => /listen-[^\\/]*\.(mp3|wav)$/i.test(f))
  if (takes.length && A.listen !== false && until > STAGES.indexOf('sound')) {
    log('stopping after the sound: the user listens to the takes first')
    return { stopped: 'sound', film: F.film, credits_spent: spent, listen: takes, next: `play the takes to the user; after their pick and yes, set film.json to that take and run again with { film: '${F.film}', from: 'plan' }` }
  }
}

// ------------------------------------------------------------------ 4. plan
let PLAN = null
if (run('plan')) {
  phase('Plan')
  const planPrompt = extra => `${COMMON}
Skills: motion-storyboard, motion-build.
Film folder: ${DIR}. Read brief.md, concept.md, assets/song.json (music videos) and film.json.
If storyboard.md and shots/ already hold a plan (a resumed run), build on it: keep what works, fix what the
notes name, finish what is missing.
Write storyboard.md: every shot on the grid (beat and time), its lyric or line, the picture, the composition
(where the subject sits, where the text sits and at what scale class: hero / headline / subtitle / none), the
transition in, the technique (code / still / clip / 3D) and the assets it needs. The first 2 s are the hook.
Mark 4-6 shots as styleframes (the hook plus one per section). Then write shots/index.js to match (every shot
with its time from the grid or the lyrics and its transition) and give every shot a BOARD build instead of a
stub: shots/<id>.js drawing the shot as a storyboard frame from the brand's real assets and the planned text,
with composition, scale and placement right and finish left for later (add \`export const board = true\`).
Make the plan visible: a storyboard sheet with one frame per shot at its key moment
(node studio/tools/render.mjs ${F.film} --sheet <t1,t2,...> --cols 6 --tw 360 --samples 2 --name storyboard-h, and
--format v --name storyboard-v), and an animatic, the boards timed to the song
(node studio/tools/render.mjs ${F.film} --video --draft --samples 1 --scale 0.5 --name animatic --sound).
Look at both. List the assets (characters and sets before the stills and clips that use them), with generate: true
only for those Runway has to make and false for those cut, resampled or drawn from art that already exists.${extra}`
  PLAN = await agent(planPrompt(''), { ...MAKER, label: 'storyboard', schema: S_PLAN })
  const critique = await agent(`${COMMON}
Skills: motion-storyboard, motion-craft.
Critique the storyboard: ${DIR}/storyboard.md and its frames (${DIR}/out/storyboard-h.jpg, ${DIR}/out/storyboard-v.jpg),
against brief.md and concept.md: is the hook strong enough to stop
a scroll, does every line get a picture, is text readable (holds, scale variety, clean space behind it), does
the energy follow the song, is anything infeasible or off-concept? Return findings (shot, issue, fix, severity).`, { ...MAKER, label: 'storyboard:critic', agentType: 'motion-critic', ...EYE, schema: S_FINDINGS })
  const major = (critique?.findings || []).filter(f => f.severity === 'major')
  const minor = (critique?.findings || []).filter(f => f.severity !== 'major')
  if (major.length) {
    log(`storyboard: ${major.length} major notes, revising`)
    PLAN = await agent(planPrompt(`\nRevise the existing storyboard and shot list to fix these notes:\n${JSON.stringify(major, null, 1)}${minor.length ? `\nAlso fix these minor ones where it is cheap:\n${JSON.stringify(minor, null, 1)}` : ''}`), { ...MAKER, label: 'storyboard:revise', schema: S_PLAN })
  }
  log(`${PLAN?.shots?.length || 0} shots, ${PLAN?.assets?.length || 0} assets planned`)
}
if (!PLAN && run('look')) PLAN = await agent(`${COMMON}
Read ${DIR}/storyboard.md and ${DIR}/shots/index.js and return the shot list and the assets still to make (skip
those already made: in assets/gen/manifest.json or already in assets/), with generate: true only for those Runway
has to make.`, { ...MAKER, label: 'plan:read', schema: S_PLAN })

// ------------------------------------------------------------------ 5. look
if (run('look')) {
  phase('Look')
  const r0 = await agent(`${COMMON}
Skills: motion-art, motion-craft, motion-build.
Film folder: ${DIR}. Read brief.md, concept.md, storyboard.md.
Set the film's look. If the concept uses generated art, make the style sheet with Runway (at most 3 tries;
allowance ${allowance(0.15)} credits) and save it with fetch.mjs. Get the fonts (node studio/tools/fonts.mjs
"<Family>" ${F.film}). Write style.js: PALETTE, FONTS, TYPE scale, LOOK chain, CAPTION, MOTION, following the
concept's visual system. Report credits spent.`, { ...MAKER, label: 'style', schema: S_DONE })
  spent += r0?.credits_spent || 0
  const planned = (PLAN?.assets || []).filter(a => a.kind !== 'font' && a.kind !== 'other')
  // art made from what already exists (cut, resampled, redrawn in code) is one agent's job; each generation gets its own
  const prep = planned.filter(a => a.generate === false)
  const assets = planned.filter(a => a.generate !== false)
  if (prep.length) await agent(`${COMMON}
Skills: motion-art, motion-build.
Film folder: ${DIR}. Read concept.md and the storyboard's asset list. Prepare these assets from art that already
exists, generating nothing:
${JSON.stringify(prep.map(a => ({ id: a.id, kind: a.kind, brief: a.brief })), null, 1)}
Save each where the storyboard expects it, wire it in where the plan says, and look at every result.`, { ...MAKER, label: 'art-prep', phase: 'Look', schema: S_DONE })
  const tier = k => (k === 'character' || k === 'set' ? 0 : k === 'still' ? 1 : 2)
  for (const t of [0, 1, 2]) {
    const batch = assets.filter(a => tier(a.kind) === t)
    if (!batch.length) continue
    const each = Math.floor(allowance(t === 2 ? 0.7 : 0.4) / batch.length)
    if (each < 4) { log(`credits too low for ${batch.length} ${['characters/sets', 'stills', 'clips'][t]}: ${batch.map(a => a.id).join(', ')} left to code`); continue }
    const rs = await parallel(batch.map(a => () => agent(`${COMMON}
Skills: motion-art.
Film folder: ${DIR}. Read concept.md, the style sheet in assets/gen/ and manifest.json.
Generate asset "${a.id}" (${a.kind}): ${a.brief}
Use the style sheet${a.depends_on?.length ? ` and ${a.depends_on.join(', ')}` : ''} as referenceImages so it belongs to the same world.
At most ${each} credits. Save with node studio/tools/fetch.mjs ${F.film} <url> assets/gen/${a.id}.<ext> --cost <credits> ...;
clips also go through python studio/tools/seq.py into assets/seq/${a.id} --sheet. Look at the result; one retry
if it fails the poster test. Report credits spent.`, { ...MAKER, label: `asset:${a.id}`, phase: 'Look', schema: S_DONE })))
    for (const r of rs.filter(Boolean)) spent += r.credits_spent || 0
    log(`${batch.length} ${['characters/sets', 'stills', 'clips'][t]} done; ${spent} credits spent of ${CREDITS}`)
  }
  const frames = (PLAN?.shots || []).filter(s => s.styleframe).map(s => s.id)
  await agent(`${COMMON}
Skills: motion-build, motion-craft, motion-art.
Film folder: ${DIR}. Build the styleframe shots fully, as final quality: ${frames.join(', ') || 'the hook and one shot per section'}.
Each in its own shots/<id>.js, wired in shots/index.js. Render stills at each shot's key moment in every format
(node studio/tools/render.mjs ${F.film} --stills <t1,t2,...> --format h, then v, ...) and look at them.
Iterate until each passes the poster test in motion-craft.`, { ...MAKER, label: 'styleframes', schema: S_DONE })
  const sf = await parallel(['composition and type', 'art direction and coherence with the concept'].map(lens => () => agent(`Review the styleframes of the film in ${DIR}: the stills in out/stills/ (all formats), against brief.md,
concept.md and storyboard.md, through this lens: ${lens}. Return findings (shot, issue, fix, severity).`, { ...MAKER, label: `styleframes:critic`, agentType: 'motion-critic', ...EYE, phase: 'Look', schema: S_FINDINGS })))
  const sfMajor = sf.filter(Boolean).flatMap(r => r.findings).filter(f => f.severity === 'major')
  if (sfMajor.length) await agent(`${COMMON}
Skills: motion-build, motion-craft.
Film folder: ${DIR}. Fix these styleframe notes, re-render the stills and look at them:
${JSON.stringify(sfMajor, null, 1)}`, { ...MAKER, label: 'styleframes:fix', schema: S_DONE })
  if (GATE === 'look') {
    log('stopping at the look for approval')
    return { stopped: 'look', film: F.film, credits_spent: spent, next: `approve the styleframes in ${DIR}/out/stills, then run again with { film: '${F.film}', from: 'build' }` }
  }
}

// ------------------------------------------------------------------ 6. build (every shot: build -> review -> fix)
let SHOTS = PLAN?.shots
if (run('build')) {
  phase('Build')
  if (!SHOTS) SHOTS = (await agent(`Read ${DIR}/shots/index.js and ${DIR}/storyboard.md; return the shot list.`, { ...MAKER, label: 'shots:read', schema: S_PLAN }))?.shots || []
  const todo = SHOTS.filter(s => !s.styleframe)
  log(`building ${todo.length} shots (${SHOTS.length - todo.length} already built as styleframes)`)
  await pipeline(todo,
    s => agent(`${COMMON}
Skills: motion-build, motion-craft, motion-art.
Film folder: ${DIR}. Read style.js, your shot's part of storyboard.md (grep -n "${s.id}" storyboard.md, then Read that
range) and one or two styleframe shots close to yours (they set the bar and the idiom).
Build shot "${s.id}" (starts ${s.at} s): ${s.summary}. Technique: ${s.technique}.
Write only shots/${s.id}.js (and its import line in shots/index.js if it is still a stub). Render a sheet of
the shot (node studio/tools/render.mjs ${F.film} --sheet <at>:<end>:0.1 --cols 8 --tw 300 --samples 4 --name shot-${s.id})
in h and v, look at it, and iterate until it matches the styleframes' quality.`, { ...BUILDER, label: `build:${s.id}`, phase: 'Build', schema: S_DONE }),
    (r, s) => agent(`Review shot "${s.id}" of the film in ${DIR}: the sheets out/shot-${s.id}*.jpg and out/sheet-*.jpg if present,
against storyboard.md, style.js and the styleframes (out/stills). Return findings (shot, issue, fix, severity).`, { ...MAKER, label: `review:${s.id}`, phase: 'Build', agentType: 'motion-critic', ...EYE, schema: S_FINDINGS }),
    (rev, s) => {
      const notes = (rev?.findings || []).filter(f => f.severity === 'major' || (rev.findings || []).length <= 3)
      if (!notes.length) return { ok: true, summary: `${s.id}: clean` }
      return agent(`${COMMON}
Skills: motion-build, motion-craft.
Film folder: ${DIR}. Fix shot "${s.id}" (shots/${s.id}.js only) for these notes, re-render its sheet and look:
${JSON.stringify(notes, null, 1)}`, { ...BUILDER, label: `fix:${s.id}`, phase: 'Build', schema: S_DONE })
    })
  await agent(`${COMMON}
Skills: motion-build, motion-review.
Film folder: ${DIR}. Assemble: make sure no stub remains (grep shots/index.js and the sheets), transitions connect,
captions and running devices sit right in every format. Render the whole film's sheets (h and v, 0.5 s) and fix
what does not flow.`, { ...BUILDER, label: 'assemble', schema: S_DONE })
}

// ------------------------------------------------------------------ 7. review loop
if (run('review')) {
  phase('Review')
  for (let round = 1; round <= ROUNDS; round++) {
    const tools = await agent(`${COMMON}
Skills: motion-review.
Film folder: ${DIR}. Render a review cut and check it: node studio/tools/render.mjs ${F.film} --video --format h --samples 6;
sheets of the whole film (h and v, 0.25 s, several pages); python studio/tools/qa.py ${F.film} --format h;
render.mjs --audit + node studio/tools/audit.mjs for h and v; frames from the real encode at the hook and every
section change (studio/tools/frames.py). Return the tool findings as findings (shot, issue, fix, severity), list
the sheet paths in files and the shot ids of shots/index.js, in order, in shots.`, { ...MAKER, label: `review:${round}:tools`, effort: 'low', schema: { type: 'object', required: ['findings', 'files'], properties: { findings: S_FINDINGS.properties.findings, files: { type: 'array', items: { type: 'string' } }, shots: { type: 'array', items: { type: 'string' } } } } })
    const ids = tools?.shots?.length ? tools.shots : (SHOTS || []).map(s => s.id)
    const LENSES = ['the hook, attention and pacing against the sound', 'typography, composition and readability in every format', 'art direction: coherence, craft, and whether it beats the references in refs/']
    const crit = await parallel(LENSES.map(lens => () => agent(`Review the whole film in ${DIR} through this lens: ${lens}.
Look at every sheet (${(tools?.files || []).join(', ') || 'out/sheet-*.jpg'}) and the stills, against brief.md, concept.md and storyboard.md.
Return findings (t, shot, issue, fix, severity). Name each finding's shot by exactly one id${ids.length ? ` of ${ids.join(', ')}` : ' from shots/index.js'},
or "film" when a note spans shots or shared code.`, { ...MAKER, label: `review:${round}:critic`, agentType: 'motion-critic', ...EYE, phase: 'Review', schema: S_FINDINGS })))
    const all = [...(tools?.findings || []), ...crit.filter(Boolean).flatMap(r => r.findings)]
    const major = all.filter(f => f.severity === 'major')
    log(`round ${round}: ${major.length} major, ${all.length - major.length} minor`)
    if (!major.length && round > 1) break
    // one fixer per shot, never two on the same file; notes naming no shot or several go to one film-wide fixer after them
    const shotOf = f => {
      const words = String(f.shot || '').toLowerCase().split(/[^a-z0-9_-]+/)
      const named = ids.filter(id => words.includes(String(id).toLowerCase()))
      return named.length === 1 ? named[0] : 'film'
    }
    const byShot = {}
    for (const f of (major.length ? major : all)) (byShot[shotOf(f)] ||= []).push(f)
    const { film: filmNotes, ...perShot } = byShot
    const fix = (shot, notes) => agent(`${COMMON}
Skills: motion-build, motion-craft.
Film folder: ${DIR}. Fix ${shot === 'film' ? 'these film-wide notes (shared code, film.js, style.js, shots/index.js, or several shots in turn)' : `shot "${shot}" (shots/${shot}.js only)`}:
${JSON.stringify(notes, null, 1)}
Re-render the affected range as a sheet and look at it.`, { ...BUILDER, label: `review:${round}:fix:${shot}`, phase: 'Review', schema: S_DONE })
    await parallel(Object.entries(perShot).map(([shot, notes]) => () => fix(shot, notes)))
    if (filmNotes?.length) await fix('film', filmNotes)
  }
}

// ------------------------------------------------------------------ 8. deliver
let D = null
if (run('deliver')) {
  phase('Deliver')
  D = await agent(`${COMMON}
Skills: motion-deliver, motion-review.
Film folder: ${DIR}. Render every format in film.json at full quality (node studio/tools/render.mjs ${F.film} --video --format <f>),
run node studio/tools/deliver.mjs ${F.film}, then python studio/tools/qa.py ${F.film} --format h on the master.
Write post.md: a title and copy for X (and Reddit), leading with the hook. Return the delivered files.`, { ...MAKER, label: 'deliver', schema: S_DONE })
}

return { film: F.film, dir: DIR, credits_spent: spent, delivered: D?.files || [], summary: D?.summary || 'stopped before delivery' }
