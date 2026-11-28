// Literal 1 is always true. Cell occupancy uses the next variables, followed by ray events.
export const TRUE = 1;
export const FALSE = -TRUE;
const clauseLimit = 100000;

export class CellConstraints {
  private next: number;
  private readonly clauses: number[][] = [];
  private readonly expressions = new Map<string, number>();

  constructor(private readonly cellCount: number) {
    this.next = cellCount + 2;
  }

  require(...literals: number[]) {
    const clean = new Set(literals.filter((lit) => lit !== FALSE));
    if (clean.has(TRUE) || [...clean].some((lit) => clean.has(-lit))) return;
    if (this.clauses.length >= clauseLimit) throw Error('投影可见性约束数量超过计算上限。');
    this.clauses.push([...clean]);
  }

  or(literals: number[]) {
    if (literals.includes(TRUE)) return TRUE;
    const clean = [...new Set(literals.filter((lit) => lit !== FALSE))].sort((a, b) => a - b);
    if (!clean.length) return FALSE;
    if (clean.length === 1) return clean[0];
    const key = clean.join(',');
    const prior = this.expressions.get(key);
    if (prior !== undefined) return prior;
    const result = this.next++;
    this.expressions.set(key, result);
    this.require(-result, ...clean);
    for (const lit of clean) this.require(result, -lit);
    return result;
  }

  and(...literals: number[]) {
    return -this.or(literals.map((lit) => -lit));
  }

  solve() {
    const values = new Int8Array(this.next);
    values[TRUE] = 1;
    const score = new Uint32Array(this.next);
    const watches = Array.from({ length: 2 * this.next }, (): number[] => []);
    const trail: number[] = [];
    let head = 0;
    // A bounded search keeps noisy or insufficient measurements from occupying the worker.
    let work = 1_600_000;
    const signed = (lit: number) => values[Math.abs(lit)] * Math.sign(lit);
    const watch = (lit: number) => watches[lit + this.next];
    const assign = (lit: number) => {
      if (signed(lit)) return signed(lit) > 0;
      values[Math.abs(lit)] = Math.sign(lit);
      trail.push(lit);
      return true;
    };
    for (const [index, clause] of this.clauses.entries()) {
      if (!clause.length) return { status: 'INCONSISTENT' } as const;
      for (const lit of clause) score[Math.abs(lit)]++;
      if (clause.length === 1) {
        if (!assign(clause[0])) return { status: 'INCONSISTENT' } as const;
      } else {
        watch(clause[0]).push(index);
        watch(clause[1]).push(index);
      }
    }
    const propagate = () => {
      while (head < trail.length) {
        const lit = -trail[head++];
        const list = watch(lit);
        for (let i = 0; i < list.length;) {
          if (--work <= 0) return false;
          const id = list[i],
            clause = this.clauses[id];
          if (clause[0] === lit) [clause[0], clause[1]] = [clause[1], clause[0]];
          if (signed(clause[0]) > 0) {
            i++;
            continue;
          }
          let j = 2;
          while (j < clause.length && signed(clause[j]) < 0) j++;
          work -= j - 2;
          if (j < clause.length) {
            [clause[1], clause[j]] = [clause[j], clause[1]];
            list[i] = list[list.length - 1];
            list.pop();
            watch(clause[1]).push(id);
          } else {
            if (!assign(clause[0])) return false;
            i++;
          }
        }
      }
      return true;
    };
    const order = Array.from({ length: this.cellCount }, (_, i) => i + 2).sort(
      (a, b) => score[b] - score[a],
    );
    const decisions: { cursor: number; trailLength: number; flipped: boolean }[] = [];
    let cursor = 0;
    for (;;) {
      if (propagate()) {
        while (cursor < order.length && values[order[cursor]]) cursor++;
        if (cursor === order.length)
          return { status: 'SOLVED', cells: values.slice(2, this.cellCount + 2) } as const;
        decisions.push({ cursor, trailLength: trail.length, flipped: false });
        // Prefer material when the drawing supplies no reason to introduce an enclosed void.
        assign(order[cursor++]);
        continue;
      }
      if (work <= 0) return { status: 'LIMIT' } as const;
      let decision = decisions.pop();
      while (decision?.flipped) decision = decisions.pop();
      if (!decision) return { status: 'INCONSISTENT' } as const;
      while (trail.length > decision.trailLength) values[Math.abs(trail.pop()!)] = 0;
      head = trail.length;
      cursor = decision.cursor + 1;
      decision.flipped = true;
      decisions.push(decision);
      assign(-order[decision.cursor]);
    }
  }
}
