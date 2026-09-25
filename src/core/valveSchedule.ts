import type { ClosureSchedule } from '../types.js';
import { validationError } from './errors.js';

/**
 * 阀门关闭规律：相对开度 τ(t)，全开为 1、全关为 0。
 *
 * - linear：τ 在 [0, Tc] 内由 1 线性降至 0，之后恒为 0；
 * - piecewise：调用方数据点线性插值，首点前恒取首点值、末点后恒取末点值。
 */
export interface OpeningFn {
  openingAt(time: number): number;
  /** 关闭历时（调用方声明或由分段数据推断），用于默认时长与校验。 */
  readonly closureTime: number;
}

export function buildOpeningFn(schedule: ClosureSchedule): OpeningFn {
  if (schedule.kind === 'linear') {
    const Tc = schedule.closureTime;
    if (!Number.isFinite(Tc) || Tc < 0) {
      validationError('关闭历时不能为负', { closureTime: Tc });
    }
    return {
      closureTime: Tc,
      openingAt(t: number): number {
        if (t <= 0) return 1;
        if (t >= Tc) return 0;
        return 1 - t / Tc;
      },
    };
  }

  const pts = schedule.points;
  if (!Array.isArray(pts) || pts.length < 2) {
    validationError('分段关闭规律至少需要两个数据点', {
      gotPoints: Array.isArray(pts) ? pts.length : 0,
    });
  }

  const points = pts.map((p) => ({
    time: p?.time,
    opening: p?.opening,
  }));

  for (const p of points) {
    if (!Number.isFinite(p.time) || p.time < 0) {
      validationError('分段关闭数据点的时间必须为非负有限数', { point: p });
    }
    if (!Number.isFinite(p.opening) || p.opening < 0 || p.opening > 1) {
      validationError('分段关闭数据点的相对开度必须落在 [0, 1]', {
        point: p,
      });
    }
  }

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (cur.time <= prev.time) {
      validationError('分段关闭数据点的时间必须严格递增', {
        index: i,
        prevTime: prev.time,
        curTime: cur.time,
      });
    }
  }

  if (points[0]!.time !== 0 || points[0]!.opening !== 1) {
    validationError('分段关闭规律必须从 t=0、全开(τ=1) 开始', {
      firstPoint: points[0],
    });
  }

  const last = points[points.length - 1]!;
  if (last.opening !== 0) {
    validationError('分段关闭规律必须以全关(τ=0) 结束', { lastPoint: last });
  }

  const closureTime = last.time;

  return {
    closureTime,
    openingAt(t: number): number {
      if (t <= 0) return points[0]!.opening;
      if (t >= closureTime) return 0;

      // 二分定位区间
      let lo = 0;
      let hi = points.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (points[mid]!.time <= t) lo = mid;
        else hi = mid;
      }
      const p0 = points[lo]!;
      const p1 = points[hi]!;
      const frac = (t - p0.time) / (p1.time - p0.time);
      return p0.opening + frac * (p1.opening - p0.opening);
    },
  };
}
