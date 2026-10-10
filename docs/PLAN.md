# Explainer: updated plan (v2)

A script becomes a narrated, animated 2D explainer video, drawn by code in the browser. This is its own product and repository, separate from the Mapflyover map editor.

## 0. Two rules that govern everything

**Keep it separate.** The Explainer is its own app in its own repository, apart from the Mapflyover map editor. It imports nothing from the map code, and a test checks that its source depends only on React, Next and itself. (It started inside the Mapflyover repository for phases 1 and 2 and was moved out afterwards.)

**We do not build or host the components. The agent does.** We provide a small, safe, fixed set of building blocks, the rules they must follow, and worked examples. The agent designs whatever the topic needs (an engine, a vaccine, a bank, a water cycle) as data, inside those rules, and the project carries it. There is no component library to grow, nothing to host, and no code from agents is ever run.

## 1. What it makes

A faceless-channel explainer ("how a car engine works"): dark blueprint line-art by default, bold flat colour for Shorts. One script renders as 16:9 and 9:16. Narration and word times come from a text-to-speech service (see Open decisions); captions highlight word by word. Everything on screen is drawn by code, so no stock footage is needed.

## 2. Principles

1. **Browser-first.** Preview, scrubbing and export run in the browser. No server rendering.
2. **The server is only for narration** (one text-to-speech provider, with per-plan character caps). Everything else runs in the browser.
3. **Deterministic.** Every frame is a pure function of time: `drawFrame(ctx, project, t, size)`. No randomness, no clock, no hidden state (seeded random only). Preview, scrubbing, export and agent checks always agree.
4. **Declarative authoring, no code.** Agents write JSON. Motion and geometry are expressed in a small **expression language** (arithmetic, `sin`, `cos`, `sqrt`, `min`, `max`, `clamp`, `mix`, `ease`, `if`, named variables, time `t`). It is parsed once, has no loops, no I/O and no access to anything else, and is limited in size and cost. That is what makes agent-made components safe, checkable and identical in preview and export.
5. **Agents get parts, not pixels.** Layout is semantic (regions of the frame, relative sizes), so 16:9 and 9:16 share one script.
6. **Timing follows the narration.** Reveals are anchored to words (`{ "word": "piston" }`) or fractions of a scene, so a changed script keeps everything in sync.
7. **Named parts with colour slots.** Every shape an agent draws belongs to a named part. Themes set defaults; the user or agent can recolour any part; colours can animate. Labels inherit their part's colour.
8. **2D only.** No Three.js.

## 3. What we provide

| We provide | Notes |
|---|---|
| **Renderer** | One canvas, `drawFrame`, themes (blueprint, flat), captions, transitions, scene fades |
| **Fixed scene blocks** | title, list, comparison, chart, countdown, timeline: the common, well-checked layouts |
| **The `drawing` block** | Where agents build their own components: shapes (line, rect, circle, polygon, path, arc, text, icons drawn from shapes), groups, named parts, variables, animation expressions, conditions, particles from a seeded rule |
| **Validator** | Rejects unsafe or broken drawings with messages an agent can fix: unknown names, expression errors, too many shapes, overlap, unreadable colour contrast, text too long, things off-screen, nothing happening for too long |
| **Examples** | Worked drawings the agent copies from: the four-stroke engine, gears, a flow diagram, a bar race. They are data, shipped in the guide, not code we maintain per topic |
| **Agent guide** | Leads with the house style, the expression language, the rules, the examples and a checklist; defaults in code, not only in text (the lesson from the map tool) |

The engine built in phase 1 was hand-written TypeScript, as the reference that proves what the language must express. In phase 2 it was re-written as a `drawing` example in the agent's own language (`examples/engine.ts`), a test proved the two compute identical numbers and colours in both themes, and the hand-written version was removed from the app. It now lives only in `tests/fixtures/engine-reference.ts`, where the equality test keeps using it. The app contains no built-in components.

## 4. Architecture (`src/explainer/`)

```
types.ts            project, scene, drawing, expression, part-slot types
schema.ts           validation and normalisation of scene JSON (never throws)
timing.ts           resolves cues to times from the word list; scene lengths
theme.ts            themes, palette, part colour resolution
expr/               the expression language: tokenizer, parser, evaluator, limits   (phase 2)
draw/
  frame.ts          drawFrame, the one pure entry point
  primitives.ts     helpers, seeded random, colour maths
  layout.ts         semantic layout for both aspect ratios
blocks/             title, bullets, (then) compare, chart, countdown, timeline, drawing
examples/           worked drawings as JSON (engine, gears, flow, ...)               (phase 2)
player/             preview player, scrubbing, theme switch, part colour panel
export/             WebCodecs + muxer in a worker                                    (phase 4)
mcp/                tools and validator, kept apart from src/lib/mcp                 (phase 6)
```

## 5. Phases and exit criteria

| # | Deliver | Done when |
|---|---|---|
| 1 ✅ | Types, schema, timing, themes with part slots, `drawFrame`, title and list blocks, preview player with scrubbing and theme switch, plus the hand-written engine as the reference | A project renders and scrubs; same time gives the same frame; both aspects; tests pass |
| 2 ✅ | **The expression language and the `drawing` block**; limits and validator; the engine re-written as a drawing example and proven equal to the reference | An agent-style JSON drawing of the engine plays identically to the reference; a second, different drawing works with no new app code; hostile input is rejected |
| 3 | Narration through the chosen TTS (see Open decisions), word-anchored cues, scene lengths from word times, animated captions, music and effects | A script becomes a narrated video in preview |
| 4 | Export: WebCodecs, muxer, worker, audio mix; 16:9 and 9:16; unsupported-browser message | A downloaded mp4 matches the preview; phones capped at 720p |
| 5 | Fixed blocks (compare, chart, countdown, timeline), templates, brand kit | Three templates produce complete videos |
| 6 | MCP tools, validator wired to agents, the guide with examples | A basic prompt yields a good video made of agent-authored components |
| 7 | Accounts, plans, limits and billing (see Open decisions); landing page | Paid limits enforced |

A phase starts only after the previous one's exit criteria are met and reported.

## 6. Risks

- **Expression language design** is the heart of phase 2: small enough to be safe and fast (evaluated for hundreds of shapes at 60 fps and again at export), rich enough to express a crank and a gear train. Hard limits on size, nesting and total cost per frame.
- **Agent drawing quality.** An agent drawing from scratch is less polished than a hand-built component. Mitigations: strong examples, a validator that catches bad layout and contrast, theme-driven styling, and previews the agent can check.
- **WebCodecs**: test with `VideoEncoder.isConfigSupported` at runtime; AAC is the variable part. Cap phones at 720p.
- **Narration cost**: one shared monthly free allowance; per-plan caps from the first narrated feature; consider a Standard-voice tier.
- **Fonts**: preview and export must load the same fonts, including inside the worker.
- **Content policy**: platforms demote repetitive templated content. The product warns users and the guide pushes variety.

## 7. Open decisions since the move to its own repository

The first plan reused Mapflyover's accounts, plans, billing, R2 storage and narration. As a separate app these are choices to make before phase 3 and phase 7:

- **Narration.** Either this app has its own Google text-to-speech key and a small server route, or it calls Mapflyover's narration service. Own key is simpler to reason about and cost; calling Mapflyover shares its free monthly allowance and couples the two.
- **Accounts and billing.** Either its own sign-in and payments, or sign in with the same Mapflyover account and plan. Decide before phase 7; until then the app has no accounts.
- **Storage** of finished videos and uploads (own bucket, or none: exports download straight to the user's device).

## 8. Changes from v1

- Agents author their own components; we ship the language, rules and examples, not a mechanism library.
- The `drawing` block moves to phase 2 and is the centre of the product.
- Hand-written mechanisms are references only, then removed.
- Agent code is never executed; everything is declarative data plus a restricted expression language.
