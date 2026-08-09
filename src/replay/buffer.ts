/** Allocation-bounded presentation history. Slots and interpolation scratch are
 * created once; capturing a frame performs no object or typed-array allocation. */

export interface PresentationBufferOptions {
  seconds?: number;
  hz?: number;
  floatCount: number;
}

export class PresentationRingBuffer {
  readonly hz: number;
  readonly capacity: number;
  readonly floatCount: number;
  private readonly times: Float64Array;
  private readonly frames: Float32Array[];
  private head = 0;
  private count = 0;

  constructor(options: PresentationBufferOptions) {
    this.hz = options.hz ?? 30;
    this.capacity = Math.max(2, Math.ceil((options.seconds ?? 12) * this.hz));
    this.floatCount = options.floatCount;
    if (!Number.isInteger(this.floatCount) || this.floatCount < 1) throw new Error('floatCount must be positive');
    this.times = new Float64Array(this.capacity);
    this.frames = Array.from({ length: this.capacity }, () => new Float32Array(this.floatCount));
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }

  oldestTime(): number {
    return this.count ? this.timeAt(0) : 0;
  }

  newestTime(): number {
    return this.count ? this.timeAt(this.count - 1) : 0;
  }

  push(time: number, write: (target: Float32Array) => void): void {
    if (!Number.isFinite(time)) throw new Error('presentation frame time must be finite');
    const index = (this.head + this.count) % this.capacity;
    const slot = this.count < this.capacity ? index : this.head;
    if (this.count === this.capacity) this.head = (this.head + 1) % this.capacity;
    else this.count++;
    this.times[slot] = time;
    write(this.frames[slot]);
  }

  /** Interpolates surrounding captured frames. Quaternion offsets point at the
   * x component of packed xyzw values and are slerped allocation-free. */
  sample(time: number, target: Float32Array, quaternionOffsets: readonly number[] = []): boolean {
    if (target.length !== this.floatCount) throw new Error('presentation sample target has the wrong size');
    if (!this.count) return false;
    if (time <= this.timeAt(0)) {
      target.set(this.frameAt(0));
      return true;
    }
    if (time >= this.timeAt(this.count - 1)) {
      target.set(this.frameAt(this.count - 1));
      return true;
    }

    let lo = 0;
    let hi = this.count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.timeAt(mid) <= time) lo = mid;
      else hi = mid;
    }
    const ta = this.timeAt(lo);
    const tb = this.timeAt(hi);
    const k = (time - ta) / Math.max(1e-6, tb - ta);
    const a = this.frameAt(lo);
    const b = this.frameAt(hi);
    target.set(a);
    for (let i = 0; i < target.length; i++) {
      if (quaternionOffsets.includes(i)) {
        const ax = a[i], ay = a[i + 1], az = a[i + 2], aw = a[i + 3];
        let bx = b[i], by = b[i + 1], bz = b[i + 2], bw = b[i + 3];
        let dot = ax * bx + ay * by + az * bz + aw * bw;
        if (dot < 0) { dot = -dot; bx = -bx; by = -by; bz = -bz; bw = -bw; }
        if (dot > 0.9995) {
          target[i] = ax + (bx - ax) * k;
          target[i + 1] = ay + (by - ay) * k;
          target[i + 2] = az + (bz - az) * k;
          target[i + 3] = aw + (bw - aw) * k;
        } else {
          const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
          const scale = Math.sin(theta);
          const wa = Math.sin((1 - k) * theta) / scale;
          const wb = Math.sin(k * theta) / scale;
          target[i] = ax * wa + bx * wb;
          target[i + 1] = ay * wa + by * wb;
          target[i + 2] = az * wa + bz * wb;
          target[i + 3] = aw * wa + bw * wb;
        }
        i += 3;
      } else {
        target[i] = a[i] + (b[i] - a[i]) * k;
      }
    }
    return true;
  }

  private physical(logical: number): number {
    return (this.head + logical) % this.capacity;
  }

  private timeAt(logical: number): number {
    return this.times[this.physical(logical)];
  }

  private frameAt(logical: number): Float32Array {
    return this.frames[this.physical(logical)];
  }
}
