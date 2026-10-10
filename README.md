# Explainer

A script becomes a narrated, animated 2D explainer video, drawn by code in the browser. Agents (Claude, ChatGPT or any other) draw their own components as data inside a small set of safe building blocks; the app never runs agent code.

This is a separate product from the Mapflyover map editor.

## Status

Phases 1 and 2 of [docs/PLAN.md](docs/PLAN.md) are done:

- the scene schema, timing, themes (blueprint and bold flat) and the pure `drawFrame(ctx, project, t, size)`
- the title and list blocks, and a preview player with scrubbing, a theme switch and a colour picker for named parts
- the expression language and the `drawing` block ([docs/DRAWING.md](docs/DRAWING.md)): shapes, named parts, formulas, events, a side panel, with limits and a checker that explains every mistake
- two worked examples written purely as data: a four-stroke engine and the water cycle (`src/explainer/examples`)

Not built yet: narration, export to mp4, accounts and billing, the agent tools (see the plan).

## Run it

```bash
npm install
npm run dev      # http://localhost:9003
npm test         # the explainer's tests
npm run build
```

## How it is organised

```
src/explainer/
  types.ts, schema.ts, timing.ts, theme.ts   the project format and its checks
  expr/                                      the formula language
  drawing/                                   compile (checks) and render (evaluate, then paint) for agent-written drawings
  draw/                                      drawFrame, layout, drawing helpers
  blocks/                                    title and list
  examples/                                  worked drawings, as data
  player/                                    the preview player
src/app/                                     the Next.js shell
tests/                                       tests, including fixtures/engine-reference.ts (the engine as ordinary code,
                                             used only to prove the data version computes exactly the same numbers)
docs/                                        PLAN.md (the plan) and DRAWING.md (how an agent draws)
```

## Rules the code keeps

- A frame is a pure function of time: no randomness, no clock, no hidden state. Preview, scrubbing, export and checks always agree.
- Drawings are data. Formulas can only compute numbers; nothing from an agent is executed.
- The app has no built-in components: everything on screen in a drawing is written by the author or the agent.
