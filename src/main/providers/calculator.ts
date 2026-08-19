import type { ResultItem } from '../../shared/types.js'

/**
 * Small expression evaluator: tokenizer -> shunting-yard -> RPN eval.
 * Deliberately not `eval` / `Function`, since query text is arbitrary input.
 */

type Token =
  | { t: 'num'; v: number }
  | { t: 'op'; v: string }
  | { t: 'fn'; v: string }
  | { t: 'lparen' }
  | { t: 'rparen' }
  | { t: 'comma' }

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
}

const FUNCTIONS: Record<string, { arity: number; fn: (...a: number[]) => number }> = {
  sqrt: { arity: 1, fn: Math.sqrt },
  cbrt: { arity: 1, fn: Math.cbrt },
  abs: { arity: 1, fn: Math.abs },
  round: { arity: 1, fn: Math.round },
  floor: { arity: 1, fn: Math.floor },
  ceil: { arity: 1, fn: Math.ceil },
  sign: { arity: 1, fn: Math.sign },
  sin: { arity: 1, fn: Math.sin },
  cos: { arity: 1, fn: Math.cos },
  tan: { arity: 1, fn: Math.tan },
  asin: { arity: 1, fn: Math.asin },
  acos: { arity: 1, fn: Math.acos },
  atan: { arity: 1, fn: Math.atan },
  ln: { arity: 1, fn: Math.log },
  log: { arity: 1, fn: Math.log10 },
  log10: { arity: 1, fn: Math.log10 },
  log2: { arity: 1, fn: Math.log2 },
  exp: { arity: 1, fn: Math.exp },
  rad: { arity: 1, fn: (d) => (d * Math.PI) / 180 },
  deg: { arity: 1, fn: (r) => (r * 180) / Math.PI },
  min: { arity: 2, fn: Math.min },
  max: { arity: 2, fn: Math.max },
  pow: { arity: 2, fn: Math.pow },
  atan2: { arity: 2, fn: Math.atan2 },
  hypot: { arity: 2, fn: Math.hypot },
}

const PRECEDENCE: Record<string, number> = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
  '%': 2,
  '//': 2,
  '^': 4,
  'u-': 5,
  // Postfix percent binds tighter than anything it could be written next to.
  pct: 6,
}

const RIGHT_ASSOC = new Set(['^', 'u-'])

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const s = input.replace(/\s+/g, ' ')

  while (i < s.length) {
    const c = s[i]

    if (c === ' ') {
      i++
      continue
    }

    if (/[0-9.]/.test(c)) {
      const hex = /^0[xX][0-9a-fA-F]+/.exec(s.slice(i))
      if (hex) {
        tokens.push({ t: 'num', v: parseInt(hex[0], 16) })
        i += hex[0].length
        continue
      }
      const bin = /^0[bB][01]+/.exec(s.slice(i))
      if (bin) {
        tokens.push({ t: 'num', v: parseInt(bin[0].slice(2), 2) })
        i += bin[0].length
        continue
      }
      const num = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(s.slice(i))
      if (!num) throw new Error('bad number')
      tokens.push({ t: 'num', v: parseFloat(num[0]) })
      i += num[0].length
      // Trailing k/m/b suffixes: "12k" -> 12000.
      const suffix = /^[kKmMbB]\b/.exec(s.slice(i))
      if (suffix) {
        const mult = { k: 1e3, m: 1e6, b: 1e9 }[suffix[0].toLowerCase() as 'k' | 'm' | 'b']
        const last = tokens[tokens.length - 1] as { t: 'num'; v: number }
        last.v *= mult
        i += suffix[0].length
      }
      continue
    }

    if (/[a-zA-Z_]/.test(c)) {
      const word = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(s.slice(i))![0]
      const lower = word.toLowerCase()
      if (lower in CONSTANTS) tokens.push({ t: 'num', v: CONSTANTS[lower] })
      else if (lower in FUNCTIONS) tokens.push({ t: 'fn', v: lower })
      else throw new Error('unknown identifier: ' + word)
      i += word.length
      continue
    }

    if (c === '(') {
      tokens.push({ t: 'lparen' })
      i++
      continue
    }
    if (c === ')') {
      tokens.push({ t: 'rparen' })
      i++
      continue
    }
    if (c === ',') {
      tokens.push({ t: 'comma' })
      i++
      continue
    }

    if (s.startsWith('//', i)) {
      tokens.push({ t: 'op', v: '//' })
      i += 2
      continue
    }
    if (s.startsWith('**', i)) {
      tokens.push({ t: 'op', v: '^' })
      i += 2
      continue
    }

    if ('+-*/%^'.includes(c)) {
      const prev = tokens[tokens.length - 1]
      if (c === '%') {
        // "%" is modulo between two operands but percent when nothing follows:
        // "17 % 5" -> 2, while "10%" and "5 + 10%" -> 0.1 and 5.1.
        const rest = s.slice(i + 1).trimStart()
        const postfix = rest === '' || ')+-*/%^,'.includes(rest[0])
        if (postfix && prev && (prev.t === 'num' || prev.t === 'rparen')) {
          tokens.push({ t: 'op', v: 'pct' })
          i++
          continue
        }
      }
      const unary = c === '-' && (!prev || prev.t === 'op' || prev.t === 'lparen' || prev.t === 'comma')
      tokens.push({ t: 'op', v: unary ? 'u-' : c })
      i++
      continue
    }

    throw new Error('unexpected character: ' + c)
  }
  return tokens
}

function toRpn(tokens: Token[]): Token[] {
  const out: Token[] = []
  const stack: Token[] = []

  for (const tok of tokens) {
    if (tok.t === 'num') out.push(tok)
    else if (tok.t === 'fn') stack.push(tok)
    else if (tok.t === 'comma') {
      while (stack.length && stack[stack.length - 1].t !== 'lparen') out.push(stack.pop()!)
      if (!stack.length) throw new Error('misplaced comma')
    } else if (tok.t === 'op') {
      // Postfix: its operand is already on the output, so it applies at once.
      if (tok.v === 'pct') {
        out.push(tok)
        continue
      }
      while (stack.length) {
        const top = stack[stack.length - 1]
        if (top.t !== 'op') break
        const higher = PRECEDENCE[top.v] > PRECEDENCE[tok.v]
        const equalLeft = PRECEDENCE[top.v] === PRECEDENCE[tok.v] && !RIGHT_ASSOC.has(tok.v)
        if (!higher && !equalLeft) break
        out.push(stack.pop()!)
      }
      stack.push(tok)
    } else if (tok.t === 'lparen') stack.push(tok)
    else {
      while (stack.length && stack[stack.length - 1].t !== 'lparen') out.push(stack.pop()!)
      if (!stack.length) throw new Error('unbalanced parentheses')
      stack.pop()
      if (stack.length && stack[stack.length - 1].t === 'fn') out.push(stack.pop()!)
    }
  }

  while (stack.length) {
    const top = stack.pop()!
    if (top.t === 'lparen' || top.t === 'rparen') throw new Error('unbalanced parentheses')
    out.push(top)
  }
  return out
}

function evalRpn(rpn: Token[]): number {
  const stack: number[] = []
  for (const tok of rpn) {
    if (tok.t === 'num') {
      stack.push(tok.v)
      continue
    }
    if (tok.t === 'fn') {
      const def = FUNCTIONS[tok.v]
      if (stack.length < def.arity) throw new Error('missing arguments for ' + tok.v)
      const args = stack.splice(stack.length - def.arity, def.arity)
      stack.push(def.fn(...args))
      continue
    }
    if (tok.t === 'op') {
      if (tok.v === 'u-') {
        if (!stack.length) throw new Error('bad expression')
        stack.push(-stack.pop()!)
        continue
      }
      if (tok.v === 'pct') {
        if (!stack.length) throw new Error('bad expression')
        stack.push(stack.pop()! / 100)
        continue
      }
      if (stack.length < 2) throw new Error('bad expression')
      const b = stack.pop()!
      const a = stack.pop()!
      switch (tok.v) {
        case '+': stack.push(a + b); break
        case '-': stack.push(a - b); break
        case '*': stack.push(a * b); break
        case '/': stack.push(a / b); break
        case '%': stack.push(a % b); break
        case '//': stack.push(Math.floor(a / b)); break
        case '^': stack.push(Math.pow(a, b)); break
        default: throw new Error('unknown operator ' + tok.v)
      }
      continue
    }
    throw new Error('bad expression')
  }
  if (stack.length !== 1) throw new Error('bad expression')
  return stack[0]
}

export function evaluate(expr: string): number {
  return evalRpn(toRpn(tokenize(expr)))
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : Number.isNaN(n) ? 'NaN' : '-∞'
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toLocaleString('en-US')
  const abs = Math.abs(n)
  if (abs !== 0 && (abs < 1e-6 || abs >= 1e15)) return n.toExponential(6).replace(/\.?0+e/, 'e')
  // Trim float noise like 0.30000000000000004 without losing real precision.
  const rounded = parseFloat(n.toPrecision(12))
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 10 })
}

/** Cheap gate so ordinary words never reach the parser. */
function looksLikeMath(q: string): boolean {
  if (!q) return false
  if (/^=/.test(q)) return true
  if (!/[0-9]/.test(q)) return false
  if (!/^[0-9a-zA-Z_.,()+\-*/%^ ]+$/.test(q)) return false
  // Needs at least one operator or a function call to be worth evaluating;
  // a bare "42" or a version number like "2.1.2" is not a calculation.
  return /[+\-*/%^]|\b(sqrt|sin|cos|tan|log|ln|abs|round|floor|ceil|pow|min|max|exp)\s*\(/.test(q)
}

export function calculatorProvider(query: string): ResultItem[] {
  const expr = query.startsWith('=') ? query.slice(1).trim() : query.trim()
  if (!looksLikeMath(query)) return []
  if (!expr) return []

  let value: number
  try {
    value = evaluate(expr)
  } catch {
    return []
  }
  if (Number.isNaN(value) && !/nan/i.test(expr)) return []

  const text = formatNumber(value)
  const raw = String(value)
  return [
    {
      id: 'calc:' + expr,
      title: text,
      subtitle: expr + '  —  Enter to copy',
      glyph: '=',
      // Calculations are almost always what you want when they parse.
      score: 1.15,
      provider: 'calculator',
      action: { kind: 'copy', text: raw },
      altActions: [
        { label: 'Copy formatted result', action: { kind: 'copy', text }, hint: 'Ctrl+Enter' },
        {
          label: 'Search the web for this expression',
          action: { kind: 'openUrl', url: 'https://www.google.com/search?q=' + encodeURIComponent(expr) },
        },
      ],
    },
  ]
}
