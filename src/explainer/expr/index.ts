// The expression language agents use to describe motion and geometry. It is deliberately tiny: numbers, named values, arithmetic, comparisons
// and a fixed list of maths functions. There are no loops, no assignments, no strings and no way to reach anything outside the values it is
// given, so an expression can only ever compute a number. Every expression is checked when the drawing is loaded and has a cost, so a
// drawing cannot be made slow or unsafe.

import { clamp, easeInOut, easeOut, hash01, lerp, smoothstep, wrapPi } from '../draw/primitives';

export const LIMITS = { source: 500, nodes: 160, depth: 20, name: 40 } as const;

export type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'un'; op: '-' | '!'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] };

export interface Expr { src: string; ast: Node; cost: number; vars: string[] }

/** Functions an expression may call: name, how many arguments (min and max), and what it computes. */
const FN: Record<string, { min: number; max: number; f: (...a: number[]) => number }> = {
  sin: { min: 1, max: 1, f: Math.sin }, cos: { min: 1, max: 1, f: Math.cos }, tan: { min: 1, max: 1, f: Math.tan },
  asin: { min: 1, max: 1, f: Math.asin }, acos: { min: 1, max: 1, f: Math.acos }, atan: { min: 1, max: 1, f: Math.atan }, atan2: { min: 2, max: 2, f: Math.atan2 },
  sqrt: { min: 1, max: 1, f: Math.sqrt }, abs: { min: 1, max: 1, f: Math.abs }, exp: { min: 1, max: 1, f: Math.exp }, ln: { min: 1, max: 1, f: Math.log },
  pow: { min: 2, max: 2, f: Math.pow }, floor: { min: 1, max: 1, f: Math.floor }, ceil: { min: 1, max: 1, f: Math.ceil }, round: { min: 1, max: 1, f: Math.round }, sign: { min: 1, max: 1, f: Math.sign },
  min: { min: 2, max: 6, f: Math.min }, max: { min: 2, max: 6, f: Math.max },
  clamp: { min: 3, max: 3, f: (x, a, b) => clamp(x, a, b) },
  mix: { min: 3, max: 3, f: (a, b, k) => lerp(a, b, k) }, lerp: { min: 3, max: 3, f: (a, b, k) => lerp(a, b, k) },
  step: { min: 2, max: 2, f: (edge, x) => (x >= edge ? 1 : 0) },
  smooth: { min: 3, max: 3, f: (a, b, x) => smoothstep(a, b, x) },
  ease: { min: 1, max: 1, f: easeInOut }, easeout: { min: 1, max: 1, f: easeOut },
  wrap: { min: 2, max: 2, f: (x, p) => (p === 0 ? 0 : ((x % p) + p) % p) },
  wrappi: { min: 1, max: 1, f: wrapPi },
  rad: { min: 1, max: 1, f: d => (d * Math.PI) / 180 }, deg: { min: 1, max: 1, f: r => (r * 180) / Math.PI },
  rand: { min: 1, max: 1, f: hash01 },
  pulse: { min: 3, max: 3, f: (x, a, b) => (x >= a && x < b ? 1 : 0) },
  if: { min: 3, max: 3, f: (c, a, b) => (c !== 0 && !Number.isNaN(c) ? a : b) },
};
export const FUNCTION_NAMES = Object.keys(FN);
export const CONSTANTS: Record<string, number> = { pi: Math.PI, tau: Math.PI * 2 };
/** Names a drawing may not use for its own values. */
export const RESERVED = new Set([...FUNCTION_NAMES, ...Object.keys(CONSTANTS)]);
const isConstant = (name: string) => Object.prototype.hasOwnProperty.call(CONSTANTS, name);

// ---- tokenizer ----
type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new Error(`"${src.slice(i, i + 6)}" is not a number`);
      out.push({ k: 'num', v: Number(m[0]) }); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      if (m[0].length > LIMITS.name) throw new Error(`the name "${m[0].slice(0, 12)}…" is too long`);
      out.push({ k: 'id', v: m[0] }); i += m[0].length; continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) { out.push({ k: 'op', v: two }); i += 2; continue; }
    if ('+-*/%^()<>,!'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    throw new Error(`the character "${c}" is not allowed`);
  }
  return out;
}

// ---- parser (precedence climbing) ----
const BIN_LEVELS: string[][] = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];

function parse(src: string): Node {
  const toks = tokenize(src);
  let pos = 0, nodes = 0;
  const peek = () => toks[pos];
  const take = () => toks[pos++];
  const isOp = (v: string) => { const t = peek(); return t?.k === 'op' && t.v === v; };
  const count = (depth: number) => { if (++nodes > LIMITS.nodes) throw new Error(`it is too long (more than ${LIMITS.nodes} parts); split it into named values in "vars"`); if (depth > LIMITS.depth) throw new Error('it is nested too deeply'); };

  const binary = (level: number, depth: number): Node => {
    if (level >= BIN_LEVELS.length) return unary(depth);
    let left = binary(level + 1, depth);
    for (;;) {
      const t = peek();
      if (t?.k === 'op' && BIN_LEVELS[level].includes(t.v)) { take(); count(depth); left = { t: 'bin', op: t.v, a: left, b: binary(level + 1, depth + 1) }; } else return left;
    }
  };
  const unary = (depth: number): Node => {
    if (isOp('-') || isOp('!')) { const op = (take() as { v: '-' | '!' }).v; count(depth); return { t: 'un', op, a: unary(depth + 1) }; }
    return power(depth);
  };
  const power = (depth: number): Node => {
    const base = primary(depth);
    if (isOp('^')) { take(); count(depth); return { t: 'bin', op: '^', a: base, b: unary(depth + 1) }; }   // right associative: 2^3^2 is 2^(3^2)
    return base;
  };
  const primary = (depth: number): Node => {
    const t = take();
    count(depth);
    if (!t) throw new Error('it ends too soon');
    if (t.k === 'num') return { t: 'num', v: t.v };
    if (t.k === 'op' && t.v === '(') { const inner = binary(0, depth + 1); if (!isOp(')')) throw new Error('a ")" is missing'); take(); return inner; }
    if (t.k === 'id') {
      if (isOp('(')) {
        take();
        const args: Node[] = [];
        if (!isOp(')')) for (;;) { args.push(binary(0, depth + 1)); if (isOp(',')) { take(); continue; } break; }
        if (!isOp(')')) throw new Error(`a ")" is missing after ${t.v}(`);
        take();
        return { t: 'call', fn: t.v.toLowerCase() === t.v ? t.v : t.v.toLowerCase(), args };
      }
      return { t: 'var', name: t.v };
    }
    throw new Error(`"${t.v}" is not expected here`);
  };

  const ast = binary(0, 0);
  if (pos < toks.length) throw new Error(`"${(toks[pos] as { v: string | number }).v}" is not expected here`);
  return ast;
}

function walk(n: Node, visit: (n: Node) => void) {
  visit(n);
  if (n.t === 'un') walk(n.a, visit);
  else if (n.t === 'bin') { walk(n.a, visit); walk(n.b, visit); }
  else if (n.t === 'call') n.args.forEach(a => walk(a, visit));
}

/**
 * Parses and checks an expression. `known` is the set of names it may use. Returns the compiled expression, or a plain sentence saying what is
 * wrong, written so an agent can fix it.
 */
export function compile(src: string, known: ReadonlySet<string>): { expr: Expr } | { error: string } {
  if (typeof src !== 'string' || !src.trim()) return { error: 'is empty' };
  if (src.length > LIMITS.source) return { error: `is longer than ${LIMITS.source} characters; split it into named values in "vars"` };
  let ast: Node;
  try { ast = parse(src); } catch (e) { return { error: e instanceof Error ? e.message : 'could not be read' }; }
  const vars = new Set<string>();
  let problem: string | null = null, cost = 0;
  walk(ast, n => {
    cost++;
    if (problem) return;
    if (n.t === 'var' && !isConstant(n.name) && !known.has(n.name)) {
      const near = [...known].filter(k => k.toLowerCase() === n.name.toLowerCase())[0];
      problem = `uses "${n.name}", which is not defined${near ? ` (did you mean "${near}"?)` : ''}`;
    } else if (n.t === 'var') vars.add(n.name);
    else if (n.t === 'call') {
      const f = Object.prototype.hasOwnProperty.call(FN, n.fn) ? FN[n.fn] : undefined;
      if (!f) problem = `calls "${n.fn}", which is not a function here. Available: ${FUNCTION_NAMES.join(', ')}`;
      else if (n.args.length < f.min || n.args.length > f.max) problem = `calls ${n.fn} with ${n.args.length} value${n.args.length === 1 ? '' : 's'}, but it takes ${f.min === f.max ? f.min : `${f.min} to ${f.max}`}`;
    }
  });
  if (problem) return { error: problem };
  return { expr: { src, ast, cost, vars: [...vars] } };
}

/** A number for the scope; anything that is not a finite number becomes 0, so one bad value cannot spoil the whole frame. */
export const safe = (v: number) => (Number.isFinite(v) ? v : 0);

export type Scope = Readonly<Record<string, number>>;

function run(n: Node, scope: Scope): number {
  switch (n.t) {
    case 'num': return n.v;
    case 'var': return isConstant(n.name) ? CONSTANTS[n.name] : (Object.prototype.hasOwnProperty.call(scope, n.name) ? scope[n.name] : 0);
    case 'un': { const a = run(n.a, scope); return n.op === '-' ? -a : (a === 0 || Number.isNaN(a) ? 1 : 0); }
    case 'bin': {
      if (n.op === '&&') { const a = run(n.a, scope); return a !== 0 && !Number.isNaN(a) && run(n.b, scope) !== 0 ? 1 : 0; }
      if (n.op === '||') { const a = run(n.a, scope); return (a !== 0 && !Number.isNaN(a)) || run(n.b, scope) !== 0 ? 1 : 0; }
      const a = run(n.a, scope), b = run(n.b, scope);
      switch (n.op) {
        case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b;
        case '%': return b === 0 ? 0 : ((a % b) + b) % b;
        case '^': return Math.pow(a, b);
        case '<': return a < b ? 1 : 0; case '<=': return a <= b ? 1 : 0; case '>': return a > b ? 1 : 0; case '>=': return a >= b ? 1 : 0;
        case '==': return a === b ? 1 : 0; case '!=': return a !== b ? 1 : 0;
      }
      return 0;
    }
    case 'call': return FN[n.fn].f(...n.args.map(a => run(a, scope)));
  }
}

/** Evaluates a compiled expression. The result can be NaN or infinite (for example, a division by zero): use `safe` on it. */
export const evaluate = (e: Expr, scope: Scope): number => run(e.ast, scope);
