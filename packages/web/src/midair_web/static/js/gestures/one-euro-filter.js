// OneEuroFilter: 速度適応型ローパスフィルタ
// 静止時はジッターを強く除去、素早い動きは遅延なく通過させる
//
// 参考: Géry Casiez et al., "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input"

class OneEuroFilter1D {
  constructor(minCutoff, beta, dCutoff) {
    this.minCutoff = minCutoff;
    this.beta      = beta;
    this.dCutoff   = dCutoff;
    this._x  = null;
    this._dx = 0;
  }

  _alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x, dt) {
    if (this._x === null) { this._x = x; return x; }
    const rawDx = (x - this._x) / dt;
    const aDx   = this._alpha(this.dCutoff, dt);
    this._dx    = aDx * rawDx + (1 - aDx) * this._dx;
    const cutoff = this.minCutoff + this.beta * Math.abs(this._dx);
    const a      = this._alpha(cutoff, dt);
    this._x      = a * x + (1 - a) * this._x;
    return this._x;
  }

  reset() { this._x = null; this._dx = 0; }
}

// 3D ランドマーク1点用フィルタ (x/y/z それぞれ独立)
class OneEuroFilter3D {
  constructor(opts) {
    this.fx = new OneEuroFilter1D(opts.minCutoff, opts.beta, opts.dCutoff);
    this.fy = new OneEuroFilter1D(opts.minCutoff, opts.beta, opts.dCutoff);
    this.fz = new OneEuroFilter1D(opts.minCutoff, opts.beta, opts.dCutoff);
  }

  filter(pt, dt) {
    return {
      x: this.fx.filter(pt.x,        dt),
      y: this.fy.filter(pt.y,        dt),
      z: this.fz.filter(pt.z ?? 0,   dt),
    };
  }

  reset() { this.fx.reset(); this.fy.reset(); this.fz.reset(); }
}

// 21点ランドマーク全体のスムーザー
export class LandmarkSmoother {
  constructor(opts = {}) {
    this._opts = { minCutoff: 1.0, beta: 0.007, dCutoff: 1.0, ...opts };
    this._filters = Array.from({ length: 21 }, () => new OneEuroFilter3D(this._opts));
  }

  smooth(landmarks, dt) {
    return landmarks.map((lm, i) => this._filters[i].filter(lm, dt));
  }

  updateParams({ minCutoff, beta, dCutoff } = {}) {
    const o = {
      minCutoff: minCutoff ?? this._opts.minCutoff,
      beta:      beta      ?? this._opts.beta,
      dCutoff:   dCutoff   ?? this._opts.dCutoff,
    };
    this._opts = o;
    this._filters = Array.from({ length: 21 }, () => new OneEuroFilter3D(o));
  }

  reset() { this._filters.forEach(f => f.reset()); }
}
