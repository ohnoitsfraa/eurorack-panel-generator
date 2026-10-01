import type { Pt } from '../types';
import type { Ring } from './poly';

/**
 * SVG path data to closed polylines.
 *
 * Icons arrive as path data, and the panel needs polygons it can extrude and
 * cut. Every command of the syntax is handled — absolute and relative, the
 * shorthand curves that follow on from the previous one, and elliptical arcs
 * — because icon sets use all of them: Material Symbols in particular leans on
 * T and q to keep its files small.
 *
 * Curves are flattened to a tolerance in the path's own units, so a 24-unit
 * icon and a 256-unit one come out equally smooth once scaled to size.
 */
export function svgPathToRings(d: string, tolerance: number): Ring[] {
  const rings: Ring[] = [];
  let ring: Pt[] = [];
  const tokens = tokenize(d);
  let i = 0;
  let cmd = '';
  let x = 0, y = 0;          // current point
  let sx = 0, sy = 0;        // start of the subpath
  let cx = 0, cy = 0;        // last control point, for S and T
  let prev = '';             // previous command, upper case

  const close = () => {
    if (ring.length >= 3) rings.push(ring);
    ring = [];
  };
  const lineTo = (nx: number, ny: number) => {
    const last = ring[ring.length - 1];
    if (!last || Math.abs(last.x - nx) > 1e-9 || Math.abs(last.y - ny) > 1e-9) ring.push({ x: nx, y: ny });
    x = nx; y = ny;
  };
  const num = () => {
    const t = tokens[i++];
    if (t === undefined || typeof t !== 'number') throw new Error('Malformed path data');
    return t;
  };
  const flag = () => num() !== 0;

  while (i < tokens.length) {
    const t = tokens[i];
    if (typeof t === 'string') { cmd = t; i++; }
    else if (!cmd) throw new Error('Path data must start with a command');
    // A command letter may be followed by several argument sets; after the
    // first, M becomes L, which is how a polyline is written briefly.
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;

    switch (C) {
      case 'M': {
        close();
        const nx = ox + num(), ny = oy + num();
        ring = [{ x: nx, y: ny }];
        x = sx = nx; y = sy = ny;
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': lineTo(ox + num(), oy + num()); break;
      case 'H': lineTo((rel ? x : 0) + num(), y); break;
      case 'V': lineTo(x, (rel ? y : 0) + num()); break;
      case 'C': {
        const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(), ex = ox + num(), ey = oy + num();
        cubic(x, y, x1, y1, x2, y2, ex, ey);
        cx = x2; cy = y2;
        break;
      }
      case 'S': {
        // The first control point mirrors the last one, if the last command
        // was a cubic; otherwise it sits on the current point.
        const x1 = prev === 'C' || prev === 'S' ? 2 * x - cx : x;
        const y1 = prev === 'C' || prev === 'S' ? 2 * y - cy : y;
        const x2 = ox + num(), y2 = oy + num(), ex = ox + num(), ey = oy + num();
        cubic(x, y, x1, y1, x2, y2, ex, ey);
        cx = x2; cy = y2;
        break;
      }
      case 'Q': {
        const x1 = ox + num(), y1 = oy + num(), ex = ox + num(), ey = oy + num();
        quad(x, y, x1, y1, ex, ey);
        cx = x1; cy = y1;
        break;
      }
      case 'T': {
        const x1 = prev === 'Q' || prev === 'T' ? 2 * x - cx : x;
        const y1 = prev === 'Q' || prev === 'T' ? 2 * y - cy : y;
        const ex = ox + num(), ey = oy + num();
        quad(x, y, x1, y1, ex, ey);
        cx = x1; cy = y1;
        break;
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag();
        const ex = ox + num(), ey = oy + num();
        arc(x, y, rx, ry, rot, large, sweep, ex, ey);
        break;
      }
      case 'Z': {
        lineTo(sx, sy);
        close();
        // A command after Z without an M starts from the subpath's start.
        ring = [{ x: sx, y: sy }];
        x = sx; y = sy;
        break;
      }
      default:
        throw new Error(`Unsupported path command ${cmd}`);
    }
    prev = C;
    // Z takes no arguments, so it cannot repeat implicitly.
    if (C === 'Z') cmd = '';
  }
  close();
  // A closing segment back to the start leaves the first point twice.
  return rings.map((r) => {
    const a = r[0], b = r[r.length - 1];
    return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 ? r.slice(0, -1) : r;
  }).filter((r) => r.length >= 3);

  function steps(len: number): number {
    // Enough segments that the chord never strays more than the tolerance
    // from the curve, for the curve's rough length.
    return Math.max(2, Math.min(64, Math.ceil(Math.sqrt(len / (tolerance * 8)) * 4)));
  }
  function cubic(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    const n = steps(Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2));
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      lineTo(
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      );
    }
  }
  function quad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) {
    const n = steps(Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1));
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      lineTo(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
    }
  }
  /** SVG's endpoint arc, by way of its centre form (SVG 1.1, appendix F.6). */
  function arc(x0: number, y0: number, rx: number, ry: number, rotDeg: number,
    large: boolean, sweep: boolean, x1: number, y1: number) {
    if (x0 === x1 && y0 === y1) return;
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (rx < 1e-12 || ry < 1e-12) { lineTo(x1, y1); return; }
    const phi = (rotDeg * Math.PI) / 180;
    const cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x0 - x1) / 2, dy = (y0 - y1) / 2;
    const px = cos * dx + sin * dy, py = -sin * dx + cos * dy;
    // Radii too small to reach are scaled up just enough, as the spec says.
    const lambda = (px * px) / (rx * rx) + (py * py) / (ry * ry);
    if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
    const num2 = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px;
    const den = rx * rx * py * py + ry * ry * px * px;
    const coef = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num2 / den));
    const cxp = coef * ((rx * py) / ry), cyp = coef * (-(ry * px) / rx);
    const ccx = cos * cxp - sin * cyp + (x0 + x1) / 2;
    const ccy = sin * cxp + cos * cyp + (y0 + y1) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => {
      const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      return a;
    };
    const t1 = ang(1, 0, (px - cxp) / rx, (py - cyp) / ry);
    let dt = ang((px - cxp) / rx, (py - cyp) / ry, (-px - cxp) / rx, (-py - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = steps(Math.abs(dt) * Math.max(rx, ry));
    for (let k = 1; k <= n; k++) {
      const a = t1 + (dt * k) / n;
      const ex = rx * Math.cos(a), ey = ry * Math.sin(a);
      // Land exactly on the endpoint, so the next segment starts from it.
      if (k === n) lineTo(x1, y1);
      else lineTo(cos * ex - sin * ey + ccx, sin * ex + cos * ey + ccy);
    }
  }
}

/**
 * Commands and numbers, in order.
 *
 * Path data is written as tightly as possible: "M2 2v10h2V4" and "0-16.5.5"
 * are three numbers each, separated only by a sign or a second decimal
 * point. Arc flags are single digits that may run straight into what follows
 * ("a8 8 0 1 1 14.44 6.88" may arrive as "a8 8 0 1114.44 6.88"), so they are
 * read one character at a time where they are expected.
 */
function tokenize(d: string): Array<string | number> {
  const out: Array<string | number> = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  let cmd = '';
  let argIndex = 0;
  while ((m = re.exec(d))) {
    if (m[1]) {
      out.push(m[1]);
      cmd = m[1].toUpperCase();
      argIndex = 0;
      continue;
    }
    const raw = m[2];
    // Arc arguments 4 and 5 (of 7) are flags: one digit each.
    if (cmd === 'A' && (argIndex % 7 === 3 || argIndex % 7 === 4) && /^[01]\d/.test(raw)) {
      out.push(Number(raw[0]));
      argIndex++;
      re.lastIndex = m.index + 1;
      continue;
    }
    out.push(Number(raw));
    argIndex++;
  }
  return out;
}
