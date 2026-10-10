# The `drawing` block: how an agent draws its own component

A `drawing` scene is data. The agent describes shapes, and formulas for how they move, using named values. Nothing the agent writes is ever run as code: the formulas are read by a small parser that can only compute numbers. This file is the reference; it becomes the core of the agent guide in phase 6. Two complete worked examples ship with the app: `src/explainer/examples/engine.ts` (a four-stroke engine) and `src/explainer/examples/water-cycle.ts`.

## A drawing in one picture

```json
{
  "block": "drawing",
  "title": "A spinning gear",
  "lengthMs": 12000,
  "stage": { "w": 8, "h": 6 },
  "params": { "teeth": 12, "speed": 40 },
  "vars": { "angle": "rad(t*speed)" },
  "parts": { "gear": { "color": "accent", "label": { "text": "Gear", "at": [3, 2.4], "to": [1.2, 1.2], "align": "left" } } },
  "shapes": [
    { "type": "circle", "part": "gear", "x": 0, "y": 0, "r": 1.4 },
    { "type": "line", "part": "gear", "repeat": 12, "let": { "a": "angle+i/n*tau" }, "x1": "1.4*cos(a)", "y1": "1.4*sin(a)", "x2": "1.8*cos(a)", "y2": "1.8*sin(a)", "width": 3 }
  ]
}
```

## The stage

`stage: { w, h, cx?, cy? }` is the drawing's own coordinate system: `w` by `h` units, with the point `(cx, cy)` (default 0, 0) at the middle of the picture. **y points up.** The renderer scales it to fit 16:9 and 9:16 by itself, so never think in pixels.

## Values

Anywhere a number is wanted you may write a number or an expression in quotes.

| Name | Meaning |
|---|---|
| `t` | seconds since the scene started |
| `ms`, `p`, `len` | milliseconds since the start; 0 to 1 through the scene; the scene's length in seconds |
| `portrait` | 1 in a vertical video |
| `flat` | 1 in the flat theme (0 in blueprint) |
| `pi`, `tau` | the constants |
| `params` | fixed numbers you name |
| `vars` | values worked out every frame, in order; a var may use earlier ones |
| `i`, `n` | inside a shape with `repeat`: this copy's number (from 0) and how many there are |
| `j`, `u` | inside a `curve`: the point number (0 to `n`) and `j / n` |
| `let` | per-copy values on a shape, in order |
| events | `events: { pop: { at, ms } }` gives `pop` (0, rising to 1, falling back) and `pop_age` (seconds since it began) |
| `hl_<part>` | 1 while a highlight cue is lit on that part |

Operators: `+ - * / % ^`, comparisons `< <= > >= == !=` (give 1 or 0), `&& || !`, and `( )`. Functions: `sin cos tan asin acos atan atan2 sqrt abs exp ln pow floor ceil round sign min max clamp mix lerp step smooth ease easeout wrap wrappi rad deg rand pulse if`.

- `wrap(x, p)` is `x` modulo `p`, never negative. `wrappi(x)` wraps an angle into -pi to pi.
- `mix(a, b, k)` blends; `smooth(a, b, x)` is a smooth 0 to 1 step; `ease(x)` eases 0 to 1; `clamp(x, lo, hi)`.
- `rand(n)` is a repeatable random number from 0 to 1 for a whole number `n`. Use `rand(i)` to give each copy its own look. It never changes from run to run.
- `if(condition, a, b)` chooses; both sides are worked out, so avoid dividing by zero in the side not chosen only if it matters (a bad number simply becomes 0).

A value that is not a finite number (a division by zero, the root of a negative) becomes 0 for that frame; it never breaks the picture. Expressions are limited to 500 characters and 160 parts. A whole drawing may cost at most about 220,000 expression steps per frame; the checker tells you if you are over.

## Shapes

Every shape may have: `part`, `id`, `when` (drawn only while it is not 0), `repeat` (1 to 200), `let`, `fill`, `stroke`, `alpha` (0 to 1), `width` (a multiple of the normal line), `emph` (0 to 1: thicker line and a glow), `dash: [on, off]`.

| Type | Fields |
|---|---|
| `line` | `x1 y1 x2 y2` |
| `rect` | `x0 y0 x1 y1`, optional `radius` |
| `circle` | `x y r` |
| `poly` | `points: [[x, y], ...]` (2 to 32), `close` (default true) |
| `curve` | `n` (1 to 200), `x`, `y` worked out for `j = 0..n`, `close` |
| `text` | `x y text size`, optional `align`, `weight` |
| `radial` | `rect: [x0, y0, x1, y1]`, `color`; a soft glow whose strength is the shape's `alpha` |

Shapes are drawn in order, first at the back. At most 90 shapes; use `repeat` and `curve` for many similar things.

## Parts and colour

A **part** is a named thing with one colour and optionally one label: `parts: { piston: { color, label } }`. A shape with `part: "piston"` is drawn in that part's colour: in the blueprint theme as a dark cut-out with a coloured outline, in the flat theme filled with the colour. The user can recolour any part with a colour picker, and one project colour setting reaches every shape of that part. Highlight cues (`cues: [{ at, do: "highlight", part }]`) thicken and glow a part for a moment.

A colour is: `"#ff6a00"`; a palette name (`bgTop bgBottom ink dim accent accent2 hot good panel`); a part name; `"part"` (the shape's own part); `{ "mix": [a, b], "by": 0.5 }` (`by` may be an expression); or `{ "byTheme": { "blueprint": a, "flat": b } }`.

`fill` is `"none"`, `"body"` (the default for closed shapes that have a part), or a colour. `stroke` is `"none"` or a colour (default: the part's outline colour).

Labels: `label: { text, at: [x, y], to: [x, y], align }`. `at` is where the words sit, `to` is where the thin leader line points; both may be expressions, so a label can follow a moving part. `align: "left"` means the words start at `at` and run to the right (use for labels on the right of the drawing); `"right"` means they end at `at` (for labels on the left).

## The side panel

`panel: { title, counter?, items: [{ title, text, active, progress?, color? }] }` lists up to six explanations beside (or, in a vertical video, under) the drawing. The item whose `active` expression is not 0 is lit and explained; `progress` (0 to 1) draws a bar under it.

## Timing to the narration

`events` and `cues` take `at`: a number of milliseconds from the start of the scene, `{ "word": "piston" }` (the moment that word is spoken in this scene; `occurrence` picks the 2nd, 3rd...), or `{ "frac": 0.5 }` (half way through the scene). Word timing only works once the video has narration.

## What the checker tells you

Every problem comes back as a sentence that says where and what, for example: `Scene 2: shape 8 ("gas") fill (by): the expression "pb*0.95" uses "pb", which is not defined.` A shape with a problem is left out and the rest still draws, so you can always look at a preview. Names must be letters, digits and `_`, start with a letter, not be a built-in or a function name, and not be one of JavaScript's own (`constructor`, `__proto__`, `toString`...).

## Good drawings

- Put one idea on screen at a time, and let the panel say it in words.
- Name every part you want the user to be able to recolour or highlight, and keep names meaningful (`piston`, `rain`), not numbered.
- Drive everything from a few `vars` (an angle, a stage number): derived values keep the picture consistent and make the formulas short.
- Prefer `repeat` with `rand(i)` for crowds, particles and rain; prefer `curve` for waves, cams, springs and paths.
- Check contrast: in the blueprint theme use bright part colours on the dark background; the theme's palette names already do.
- Leave the drawing room: keep important things inside the `stage`, and keep labels away from the panel.
