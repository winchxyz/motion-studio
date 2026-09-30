export const meta = {
  name: 'motion-video',
  description: 'Make a motion video from one brief. Direct by default: a quick setup, then the concept with key frames and the audio takes made at the same time, a stop for the user to look and listen, one agent that makes the whole film, one critic, one pass that fixes and delivers. preset "lean" splits the making across a planner, a look stage and parallel builders (long films); preset "full" adds a judge panel, a drawn storyboard and per-shot builders.',
  whenToUse: 'The user describes a video to make (music video, brand or product spot, launch film, showreel, social ad). args: { brief, film?, notes?, refs?, formats?, preset?: "direct" | "lean" | "full", gate?: "look" | "none", from?, until?, credits?, rounds?, samples?, models?: { worker?, judge?, builderEffort? }, listen?: false }. It stops after the sound so the user sees the key frames and hears the audio; resume with from: "plan".',
  phases: [
    { title: 'Brief', detail: 'film folder and a short brief.md' },
    { title: 'Concept', detail: 'the concept with key frames (and, in direct, the audio takes at the same time)' },
    { title: 'Sound', detail: 'song, or narrator and music bed, timed; then the user looks and listens' },
    { title: 'Plan', detail: 'direct: one agent makes the whole film; lean: a shot table and a note per shot' },
    { title: 'Look', detail: 'lean and full: style, shared kit, assets, hero shots, a critic' },
    { title: 'Build', detail: 'lean and full: shots built in groups or one by one' },
    { title: 'Review', detail: 'a critic on the whole film, then fixes' },
    { title: 'Deliver', detail: 'every format, masters, previews, post copy' },
  ],
}

// ------------------------------------------------------------------ setup
const A = args || {}
// direct (default): one agent makes the whole film after the approval stop, like a single motion designer; the
// fastest and cheapest path for films up to about a minute. lean: the making split across a planner, a look stage
// and parallel builders. full: the judge panel, a drawn storyboard with a critic, a builder + reviewer + fixer per
// shot, up to three review rounds.
const PRESET = A.preset || 'direct'
if (!['direct', 'lean', 'full'].includes(PRESET)) throw new Error('preset must be direct, lean or full')
const DIRECT = PRESET === 'direct'
const LEAN = PRESET !== 'full'           // direct shares the lean rules where it does not replace a stage
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
const ROUNDS = A.rounds || (LEAN ? 1 : 3)
const FINAL_SAMPLES = A.samples || (LEAN ? 8 : 0)   // motion-blur samples for the masters; 0 keeps film.json's
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
needs (grep, then Read a range), batch your edits between renders, and look at sheets small (--tw 240) and at
full-size stills only where you need the detail. Budget: about three render-and-look passes and about 15 images
in all. While iterating render with --samples 2 (add --scale 0.5 for motion checks); full samples only for the
final check. What is still off after that goes in your summary as open, not into more passes.
The film's documents stay short because every agent reads them: brief.md 6 KB, concept.md 5 KB, storyboard.md
12 KB, shots/<id>.md 1.5 KB at most. Research, evidence and reasoning go to research/ and evidence/.${A.notes ? `
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
  ok: { type: 'boolean' }, summary: { type: 'string' }, credits_spent: { type: 'number' }, files: { type: 'array', items: { type: 'string' } },
  open: { type: 'array', items: { type: 'string' } } } }
const S_PLAN = { type: 'object', required: ['shots', 'assets'], properties: {
  shots: { type: 'array', items: { type: 'object', required: ['id', 'at', 'summary', 'technique'], properties: {
    id: { type: 'string' }, at: { type: 'number' }, dur: { type: 'number' }, summary: { type: 'string' }, technique: { type: 'string' },
    assets: { type: 'array', items: { type: 'string' } }, styleframe: { type: 'boolean' } } } },
  groups: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
  assets: { type: 'array', items: { type: 'object', required: ['id', 'kind', 'brief'], properties: {
    id: { type: 'string' }, kind: { type: 'string', enum: ['character', 'set', 'still', 'clip', 'font', 'other'] }, brief: { type: 'string' },
    generate: { type: 'boolean' }, depends_on: { type: 'array', items: { type: 'string' } } } } } } }
const S_FINDINGS = { type: 'object', required: ['findings'], properties: { findings: { type: 'array', items: { type: 'object', required: ['shot', 'issue', 'fix', 'severity'], properties: {
  t: { type: 'number' }, shot: { type: 'string' }, issue: { type: 'string' }, fix: { type: 'string' }, severity: { type: 'string', enum: ['major', 'minor'] } } } } } }

// ------------------------------------------------------------------ 1. brief
let F = { film: A.film }
if (run('brief')) {
  phase('Brief')
  const decide = `The user's brief, verbatim:
"""${A.brief}"""
${A.refs?.length ? `References given: ${A.refs.join(', ')}` : ''}
${A.formats ? `Formats requested: ${A.formats.join(', ')}` : ''}
1. Decide the film: ${A.film ? `the folder is "${A.film}" (it may already hold research: read it first and keep it)` : 'a short folder name (a-z, 0-9, -)'}, music-video or spot, a working title, the length
   in seconds (music videos: whole bars of the song later; default 45-60 s; spots 30 s) and the formats
   (default h and v).
2. If <folder> does not exist in the studio root, create it: node studio/tools/new-film.mjs <folder> --template <kind> --title "<title>".`
  if (DIRECT) {
    F = await agent(`${COMMON}
Skills: motion-film.
${decide}
3. Write a short brief.md (3 KB at most): the user's words, what it is, who it is for, the one message, the length
   and the formats. The research comes next, with the concept.
4. Runway: call whoami and report credits.total as credits_available (0 if Runway is unavailable).
Keep this quick: the decisions and the folder only. Return the structured summary.`, { ...MAKER, effort: 'low', label: 'setup', schema: S_SETUP })
  } else if (LEAN) {
    F = await agent(`${COMMON}
Skills: motion-brief, motion-film.
${decide}
3. Research the subject in one pass: for a brand or product its official assets (logo as SVG path data, colours,
   fonts or the closest free stand-ins, the real UI), what it is in its own words, numbers with dates, handles
   checked on the platform; for a cultural topic the events, phrases and images the audience knows. Everything
   with its source, in research/truth.md.
4. Write brief.md from the user's words and the research, 6 KB at most: what it is, who it is for, the one message,
   the facts that go on screen with their sources (the Truth section), the length and the formats. A film about a
   brand or project says plainly what it is and how to join.
5. ${A.refs?.length ? 'Break the given references down with yt-dlp and studio/tools/breakdown.py into refs/ and write their takeaways to research/references.md.' : 'No references were given: pick the closest style cards in styles/README.md instead of searching the web.'}
6. Runway: call whoami and report credits.total as credits_available (0 if Runway is unavailable).
Return the structured summary.`, { ...MAKER, label: 'brief', schema: S_SETUP })
  } else {
    F = await agent(`${COMMON}
Skills: motion-brief, motion-film.
${decide}
3. Fill brief.md's Brief section from the user's words (keep their words where they are specific).
4. Runway: call whoami and report credits.total as credits_available (0 if Runway is unavailable).
Return the structured summary.`, { ...MAKER, label: 'setup', schema: S_SETUP })
  }
  if (!F) throw new Error('setup failed')
  if (typeof F.credits_available === 'number') CREDITS = Math.min(CREDITS, Math.max(0, F.credits_available - 10))
  log(`${F.film}: ${F.kind}, ${F.duration} s, formats ${F.formats.join('/')}; up to ${CREDITS} Runway credits; ${PRESET} preset`)
  if (!LEAN) {
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
}
const DIR = inRoot(F.film)

// ------------------------------------------------------------------ 2. concept (direct: with the sound, at the same time)
let KEYFRAMES = []
let SOUND = null
const soundPrompt = together => `${COMMON}
Skills: motion-song (music videos) or the spot template's sound.py (spots).
Film folder: ${DIR}. ${together ? `Read brief.md. The concept is being written at the same time by another agent: take the
mood, pace and length from the user's words, write your notes to evidence/sound.md (not brief.md or concept.md,
which it is editing), and touch only film.json's audio, song and bpm fields.` : 'Read brief.md and concept.md.'}
Music video: use the user's song if the brief supplies one; otherwise write lyrics to the concept (lyrics.txt)
and generate the song with Runway generate_music (lyria-3-pro, 8 credits; two takes, so the user can choose;
allowance ${allowance(0.2)} credits). Save with node studio/tools/fetch.mjs (--cost), analyse with
python studio/tools/song.py <film>/assets/song.mp3 --lyrics <film>/lyrics.txt, choose the stretch the film uses
(start on a downbeat, whole bars), and set songStart, duration and audio in film.json.
Spot: set bpm and duration (whole bars) in film.json and plan the score; a narrator only if the brief needs one
(generate_speech, 1 credit per 50 characters; two voices to choose from, over the music bed); a music bed from
Runway generate_music when the brief asks for music (two takes to choose from, within the allowance).
The film's timing lives in one file that every later stage reads instead of working it out again: the song's
json from song.py, or for a narrator assets/timing.json (bpm, beats, bars, and each line with its start and end
in film time); film.json's song points at it, and its audio.song at the audio file.
Nothing is built on audio the user has not heard: cut what the film would use from each take (the song, each
voice over the bed, the bed alone, or a draft of a synthesized score) into out/listen-<name>.mp3 (a short fade
at each end) and list those files in files. The user is waiting to listen, so keep this stage short: the takes,
the stretch and the listening files, then return; word timing checks and document updates wait until after the
user's pick. Report the credits spent.`
if (run('concept')) {
  phase('Concept')
  if (DIRECT) {
    const [c, s] = await parallel([
      () => agent(`${COMMON}
Skills: motion-brief, motion-storyboard, motion-art, motion-film.
Film folder: ${DIR}. Read brief.md and the style cards in styles/README.md. The music is being made at the same time
by another agent: leave film.json's audio, song and bpm fields and the sound files to it.
1. Research only what the film will state as fact: official assets (logo as SVG path data, colours, fonts or the
   closest free stand-ins, the real UI), the facts and numbers with dates and sources, handles checked. Write them
   to research/truth.md and add the facts that go on screen to brief.md's Truth section.
2. The concept, in concept.md (4 KB at most): name, logline, the hook (what the first 2 s show and say), 5-8 beats,
   the visual system (palette hexes, type pairing, look chain from studio/engine/looks.js, texture, camera), the
   technique, and where the real information sits on screen. Different from the obvious version, and small enough
   for one agent to build in about an hour.
3. Make it visible: in ${DIR}/concept/ write a small film (film.json: fps 60, duration 3, the film's formats;
   film.js drawing the hook and one key moment with the engine, from real assets) and render stills at 0.8 and
   2.2 s in each format (node studio/tools/render.mjs ${DIR}/concept --stills 0.8,2.2 --format <f>). The user sees
   them with the audio before anything else is built, so they must meet motion-craft; the making starts from their
   code. No Runway spend here. List the stills in files.`, { ...MAKER, effort: 'medium', label: 'pitch', phase: 'Concept', schema: S_DONE }),
      () => (run('sound') ? agent(soundPrompt(true), { ...MAKER, effort: 'medium', label: 'sound', phase: 'Sound', schema: S_DONE }) : null),
    ])
    KEYFRAMES = (c?.files || []).filter(f => /\.(jpg|png)$/i.test(f))
    SOUND = s
  } else if (LEAN) {
    const c = await agent(`${COMMON}
Skills: motion-storyboard, motion-art, motion-film.
Film folder: ${DIR}. Read brief.md and the style cards in styles/README.md.
Choose the strongest concept for this brief: different in subject, view and rendering from the obvious version,
and feasible on this engine within a few hours of building. Write concept.md, 5 KB at most: name, logline, the
hook (exactly what the first 2 s show and say), 5-8 beats, the visual system (palette hexes, type pairing, look
chain from studio/engine/looks.js, texture, camera), the technique (what is code, generated stills or video, 3D),
where the real information sits on screen, and the Runway credit plan (this run allows ${CREDITS}).
Make it visible: in ${DIR}/concept/ write a small film (film.json: fps 60, duration 3, formats ["h", "v"]; film.js
drawing the hook and one key moment with the engine, from real assets) and render stills of both in 16:9 and 9:16
(node studio/tools/render.mjs ${DIR}/concept --stills 0.8,2.2 --format h, then --format v). The user sees these
frames next to the audio before anything else is built, so they must meet motion-craft; the look stage starts
from their code. No Runway spend here. List the stills in files.`, { ...MAKER, label: 'concept', schema: S_DONE })
    KEYFRAMES = (c?.files || []).filter(f => /\.(jpg|png)$/i.test(f))
  } else {
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
}

// ------------------------------------------------------------------ 3. sound (then the user looks and listens)
if (run('sound')) {
  phase('Sound')
  const r = SOUND || await agent(soundPrompt(false), { ...MAKER, ...(DIRECT ? { effort: 'medium' } : {}), label: 'sound', schema: S_DONE })
  spent += r?.credits_spent || 0
  // the user sees the key frames and hears the audio before anything is built on them (args.listen: false skips it)
  const takes = (r?.files || []).filter(f => /listen-[^\\/]*\.(mp3|wav)$/i.test(f))
  if (takes.length && A.listen !== false && until > STAGES.indexOf('sound')) {
    log('stopping after the sound: the user sees the key frames and hears the takes first')
    return { stopped: 'sound', film: F.film, preset: PRESET, credits_spent: spent, listen: takes, look: KEYFRAMES,
      next: `show the user the key frames (${DIR}/concept/out/stills or ${DIR}/concepts/) and play the takes; after their pick and yes, set film.json to that take and run again with { film: '${F.film}', from: 'plan' }` }
  }
}

// ------------------------------------------------------------------ 4. plan
let PLAN = null
let MADE = null                          // direct: what the one maker returns (its sheets go to the critic)
if (run('plan')) {
  phase('Plan')
  if (DIRECT) {
    MADE = await agent(`${COMMON}
Skills: motion-build, motion-craft, motion-storyboard, motion-art.
Film folder: ${DIR}. Read brief.md, concept.md, film.json and the timing file it points at, notes.md if present, and
the concept film in concept/ (its code is your starting point). If the film already has a plan, a kit or built
shots (a resumed run), continue from them instead of starting over.
Make the whole film in this one session, the way a single motion designer would:
1. A short shot list in storyboard.md (8 KB at most): each shot's id, start and length from the timing file, the
   text on screen verbatim, the picture in a sentence, the transition in.
2. The fonts (node studio/tools/fonts.mjs "<Family>" ${F.film}), style.js, then every shot in shots/<id>.js, wired in
   shots/index.js, reusing the concept film's code. No stub may remain.
3. Check as you go on small sheets (--samples 2 --tw 240). When every shot is in, check the whole film: a sheet at
   0.5 s in each format, a draft cut (node studio/tools/render.mjs ${F.film} --video --format h --draft --samples 2
   --scale 0.5) through python studio/tools/qa.py ${F.film} --format h, and the text audit (render.mjs --audit and
   node studio/tools/audit.mjs, each format). Fix what they flag.
Budget for the whole film: two or three render-and-look passes per shot and about 40 images in all.
Do not render the masters: the finishing pass does, after a critic has looked. Return the final sheet paths in
files and what is still open in open.`, { ...BUILDER, label: 'make', schema: S_DONE })
  } else if (LEAN) {
    PLAN = await agent(`${COMMON}
Skills: motion-storyboard, motion-build.
Film folder: ${DIR}. Read brief.md, concept.md, film.json and the timing file film.json points at.
If storyboard.md and shots/ already hold a plan (a resumed run), build on it.
1. storyboard.md, 12 KB at most: one row per shot with its id, start and length (read from the timing file, never
   typed seconds), the line or text on screen verbatim, the picture in one sentence, and the transition in. The
   first 2 s are the hook; every line gets a picture; one idea at a time.
2. shots/<id>.md for every shot, 1.5 KB at most: the composition in each format (where the subject and the text
   sit, the text's scale class: hero / headline / subtitle), the motion, the assets it uses. A builder reads only
   the notes of its own shots.
3. shots/index.js: every shot with its time from the timing file and its transition, each importing its own file
   shots/<id>.js, which you create as a stub (export default stub('<id>', '<intent>') with stub from ./_stub.js),
   so builders only ever write their own shot files.
4. Mark two shots as heroes (styleframe: true): the hook and the most demanding shot. Split the other shots into
   groups of 3-5 consecutive shots and return them as groups (arrays of ids) in film order.
5. List the assets, with generate: true only for those Runway has to make.
No drawings and no renders at this stage.`, { ...MAKER, label: 'plan', schema: S_PLAN })
  } else {
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
  }
  if (!DIRECT) log(`${PLAN?.shots?.length || 0} shots, ${PLAN?.groups?.length || 0} groups, ${PLAN?.assets?.length || 0} assets planned`)
}
if (!DIRECT && !PLAN && run('look')) PLAN = await agent(`${COMMON}
Read ${DIR}/storyboard.md and ${DIR}/shots/index.js and return the shot list (styleframe: true for the hero or
styleframe shots), ${LEAN ? 'the groups (runs of 3-5 consecutive non-hero shots, in film order), ' : ''}and the assets still to make (skip
those already made: in assets/gen/manifest.json or already in assets/), with generate: true only for those Runway
has to make.`, { ...MAKER, label: 'plan:read', schema: S_PLAN })

// ------------------------------------------------------------------ 5. look (lean and full; direct makes it in the plan stage)
if (!DIRECT && run('look')) {
  phase('Look')
  const r0 = await agent(`${COMMON}
Skills: motion-art, motion-craft, motion-build.
Film folder: ${DIR}. Read brief.md, concept.md${LEAN ? ', storyboard.md and the concept film in concept/ (its code is the starting point)' : ', storyboard.md'}.
Set the film's look. If the concept uses generated art, make the style sheet with Runway (at most 3 tries;
allowance ${allowance(0.15)} credits) and save it with fetch.mjs. Get the fonts (node studio/tools/fonts.mjs
"<Family>" ${F.film}). Write style.js: PALETTE, FONTS, TYPE scale, LOOK chain, CAPTION, MOTION, following the
concept's visual system.${LEAN ? ` Then write kit.js: the recurring objects, type treatments and transitions of
this film (move the concept film's drawing code there), so shot builders compose instead of reinventing. Keep
this stage short: it only sets up what every shot shares.` : ''} Report credits spent.`, { ...MAKER, label: LEAN ? 'look:style' : 'style', schema: S_DONE })
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
Film folder: ${DIR}. Build the ${LEAN ? 'hero' : 'styleframe'} shots fully, as final quality: ${frames.join(', ') || 'the hook and one shot per section'}.
Each in its own shots/<id>.js${LEAN ? ' (read their notes shots/<id>.md, and use and extend kit.js, which every shot will share)' : ', wired in shots/index.js'}. Render stills at each
shot's key moment in every format (node studio/tools/render.mjs ${F.film} --stills <t1,t2,...> --format h, then v, ...)
and look at them. ${LEAN ? 'They and kit.js set the standard every other shot is built to.' : 'Iterate until each passes the poster test in motion-craft.'}`, { ...MAKER, label: LEAN ? 'look:heroes' : 'styleframes', schema: S_DONE })
  const lenses = LEAN ? ['composition, type and art direction, and coherence with the concept'] : ['composition and type', 'art direction and coherence with the concept']
  const sf = await parallel(lenses.map(lens => () => agent(`Review the ${LEAN ? 'hero shots' : 'styleframes'} of the film in ${DIR}: the stills in out/stills/ (all formats), against brief.md,
concept.md and storyboard.md, through this lens: ${lens}. Return findings (shot, issue, fix, severity).`, { ...MAKER, label: LEAN ? 'look:critic' : 'styleframes:critic', agentType: 'motion-critic', ...EYE, phase: 'Look', schema: S_FINDINGS })))
  const sfMajor = sf.filter(Boolean).flatMap(r => r.findings).filter(f => f.severity === 'major')
  if (sfMajor.length) await agent(`${COMMON}
Skills: motion-build, motion-craft.
Film folder: ${DIR}. Fix these notes on the ${LEAN ? 'hero shots and kit.js' : 'styleframes'}, re-render the stills and look at them:
${JSON.stringify(sfMajor, null, 1)}`, { ...MAKER, label: LEAN ? 'look:fix' : 'styleframes:fix', schema: S_DONE })
  if (GATE === 'look') {
    log('stopping at the look for approval')
    return { stopped: 'look', film: F.film, credits_spent: spent, next: `approve the stills in ${DIR}/out/stills, then run again with { film: '${F.film}', from: 'build' }` }
  }
}

// ------------------------------------------------------------------ 6. build
let SHOTS = PLAN?.shots
let GROUPS = null                        // lean: the runs of shots each builder owns, reused by the review's fixers
if (!DIRECT && run('build')) {
  phase('Build')
  if (!SHOTS) SHOTS = (await agent(`Read ${DIR}/shots/index.js and ${DIR}/storyboard.md; return the shot list (styleframe: true for the hero or styleframe shots).`, { ...MAKER, label: 'shots:read', schema: S_PLAN }))?.shots || []
  const heroes = SHOTS.filter(s => s.styleframe).map(s => s.id)
  const todo = SHOTS.filter(s => !s.styleframe)
  if (LEAN) {
    // groups of consecutive shots, one builder each, all at once; nothing shared is edited while they work
    const order = [...SHOTS].sort((a, b) => a.at - b.at)
    const endOf = id => { const i = order.findIndex(s => s.id === id); return order[i + 1]?.at ?? order[i].at + (order[i].dur || 3) }
    const known = new Set(todo.map(s => s.id))
    GROUPS = (PLAN?.groups || []).map(g => g.filter(id => known.has(id))).filter(g => g.length)
    const grouped = new Set(GROUPS.flat())
    const rest = order.filter(s => known.has(s.id) && !grouped.has(s.id)).map(s => s.id)
    for (let i = 0; i < rest.length; i += 4) GROUPS.push(rest.slice(i, i + 4))
    log(`building ${todo.length} shots in ${GROUPS.length} groups (${heroes.length} heroes built in the look stage)`)
    await parallel(GROUPS.map((g, i) => () => {
      const t0 = Math.min(...g.map(id => order.find(s => s.id === id).at)), t1 = Math.max(...g.map(endOf))
      return agent(`${COMMON}
Skills: motion-build, motion-craft, motion-art.
Film folder: ${DIR}. Build shots ${g.join(', ')} (${t0.toFixed(2)}-${t1.toFixed(2)} s) to the standard of the hero shots.
Read style.js, kit.js, the hero shots' code (${heroes.map(id => `shots/${id}.js`).join(', ') || 'the styleframes'}) and the notes of your shots
only (${g.map(id => `shots/${id}.md`).join(', ')}), not the whole storyboard.
Write only your shots' files (${g.map(id => `shots/${id}.js`).join(', ')}): other builders are working on the other shots at the same
time, and nothing shared changes while they do. Use kit.js as it is; if something every shot needs is missing,
build it in your own file and say so in your summary.
Look at your range as one sheet per pass (node studio/tools/render.mjs ${F.film} --sheet ${t0.toFixed(2)}:${t1.toFixed(2)}:0.25 --cols 8 --tw 240
--samples 2 --name group-${i + 1}, and --format v --name group-${i + 1}-v), at most three passes.`, { ...BUILDER, label: `build:${g.join('+')}`, phase: 'Build', schema: S_DONE })
    }))
  } else {
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
}

// ------------------------------------------------------------------ 7. review
let CRIT = null                          // direct: the critic's notes, fixed by the finishing pass
if (run('review') && DIRECT) {
  phase('Review')
  const sheets = (MADE?.files || []).filter(f => /\.(jpg|png)$/i.test(f))
  CRIT = await agent(`Review the whole film in ${DIR}: the hook, the pacing against the sound, typography, composition and
readability in every format, and the art direction. Look at the sheets (${sheets.join(', ') || 'the newest sheets in out/'}) and the stills,
against brief.md and concept.md. Return findings (t, shot, issue, fix, severity); major only for what a viewer
would notice.`, { ...MAKER, label: 'review:critic', agentType: 'motion-critic', ...EYE, schema: S_FINDINGS })
  log(`critic: ${(CRIT?.findings || []).filter(f => f.severity === 'major').length} major, ${(CRIT?.findings || []).filter(f => f.severity !== 'major').length} minor`)
} else if (run('review')) {
  phase('Review')
  for (let round = 1; round <= ROUNDS; round++) {
    const tools = await agent(`${COMMON}
Skills: motion-review.
Film folder: ${DIR}. Render a ${LEAN ? 'draft ' : ''}review cut and check it: node studio/tools/render.mjs ${F.film} --video --format h ${LEAN ? '--draft --samples 2 --scale 0.5' : '--samples 6'};
sheets of the whole film (h and v, ${LEAN ? '0.5' : '0.25'} s); python studio/tools/qa.py ${F.film} --format h;
render.mjs --audit + node studio/tools/audit.mjs for h and v; frames from the real encode at the hook and every
section change (studio/tools/frames.py); make sure no stub remains. Return the tool findings as findings (shot,
issue, fix, severity), list the sheet paths in files and the shot ids of shots/index.js, in order, in shots.`, { ...MAKER, label: `review:${round}:tools`, effort: 'low', schema: { type: 'object', required: ['findings', 'files'], properties: { findings: S_FINDINGS.properties.findings, files: { type: 'array', items: { type: 'string' } }, shots: { type: 'array', items: { type: 'string' } } } } })
    const ids = tools?.shots?.length ? tools.shots : (SHOTS || []).map(s => s.id)
    const LENSES = LEAN
      ? ['the hook, the pacing against the sound, typography, composition and readability in every format, and the art direction']
      : ['the hook, attention and pacing against the sound', 'typography, composition and readability in every format', 'art direction: coherence, craft, and whether it beats the references in refs/']
    const crit = await parallel(LENSES.map(lens => () => agent(`Review the whole film in ${DIR} through this lens: ${lens}.
Look at every sheet (${(tools?.files || []).join(', ') || 'out/sheet-*.jpg'}) and the stills, against brief.md, concept.md and storyboard.md.
Return findings (t, shot, issue, fix, severity). Name each finding's shot by exactly one id${ids.length ? ` of ${ids.join(', ')}` : ' from shots/index.js'},
or "film" when a note spans shots or shared code.`, { ...MAKER, label: `review:${round}:critic`, agentType: 'motion-critic', ...EYE, phase: 'Review', schema: S_FINDINGS })))
    const all = [...(tools?.findings || []), ...crit.filter(Boolean).flatMap(r => r.findings)]
    const major = all.filter(f => f.severity === 'major')
    log(`round ${round}: ${major.length} major, ${all.length - major.length} minor`)
    if (!major.length && round > 1) break
    // one fixer per shot (lean: per build group), never two on the same file; notes naming no shot or several go
    // to one film-wide fixer after them
    const shotOf = f => {
      const words = String(f.shot || '').toLowerCase().split(/[^a-z0-9_-]+/)
      const named = ids.filter(id => words.includes(String(id).toLowerCase()))
      return named.length === 1 ? named[0] : 'film'
    }
    const unitOf = {}
    for (const g of (GROUPS || [])) for (const id of g) unitOf[id] = g.join('+')
    for (const s of (SHOTS || []).filter(s => s.styleframe)) unitOf[s.id] = (SHOTS || []).filter(x => x.styleframe).map(x => x.id).join('+')
    const byUnit = {}
    for (const f of (major.length ? major : all)) { const s = shotOf(f); (byUnit[s === 'film' ? 'film' : (unitOf[s] || s)] ||= []).push(f) }
    const { film: filmNotes, ...perUnit } = byUnit
    const fix = (unit, notes) => agent(`${COMMON}
Skills: motion-build, motion-craft.
Film folder: ${DIR}. Fix ${unit === 'film' ? 'these film-wide notes (shared code, film.js, style.js, kit.js, shots/index.js, or several shots in turn)' : `shot${unit.includes('+') ? 's' : ''} ${unit.split('+').join(', ')} (${unit.split('+').map(id => `shots/${id}.js`).join(', ')} only)`}:
${JSON.stringify(notes, null, 1)}
Re-render the affected range as a sheet and look at it.`, { ...BUILDER, label: `review:${round}:fix:${unit}`, phase: 'Review', schema: S_DONE })
    await parallel(Object.entries(perUnit).map(([unit, notes]) => () => fix(unit, notes)))
    if (filmNotes?.length) await fix('film', filmNotes)
  }
}

// ------------------------------------------------------------------ 8. deliver
let D = null
if (run('deliver')) {
  phase('Deliver')
  const notes = DIRECT ? (CRIT?.findings || []).filter(f => f.severity === 'major') : []
  D = await agent(`${COMMON}
Skills: ${DIRECT ? 'motion-build, motion-craft, ' : ''}motion-deliver, motion-review.
Film folder: ${DIR}. ${notes.length ? `First fix these notes from the critic, re-render the affected ranges as sheets and look:
${JSON.stringify(notes, null, 1)}
Then deliver. ` : ''}Render every format in film.json at full quality (node studio/tools/render.mjs ${F.film} --video --format <f>${FINAL_SAMPLES ? ` --samples ${FINAL_SAMPLES}` : ''}),
run node studio/tools/deliver.mjs ${F.film}, then python studio/tools/qa.py ${F.film} --format h on the master.
Write post.md: a title and copy for X (and Reddit), leading with the hook. Return the delivered files.
${notes.length ? 'Beyond those notes' : 'This stage renders, packages and checks; it does not redesign'}: whatever fails a check goes in open for the
next run, unless it is a broken frame or file, which you fix and render again.`, { ...MAKER, effort: notes.length ? 'medium' : 'low', label: DIRECT ? 'finish' : 'deliver', schema: S_DONE })
}

return { film: F.film, dir: DIR, preset: PRESET, credits_spent: spent, delivered: D?.files || [], open: D?.open || [], summary: D?.summary || 'stopped before delivery' }
