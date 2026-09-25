import { GRAVITY } from './constants.js';
import { runSolver, type SolverInput } from './solver.js';
import { joukowskyRise, validateRequest } from './validation.js';
import type {
  SimulationResponse,
  ValveSample,
  WaveObservation,
} from '../types.js';

/**
 * 峰值摘要与波往返周期观测。
 *
 * 无摩擦、瞬时全关时阀门水头理论上呈方波式阶跃：
 *   t = 0      首次跃升 ΔH_J = aV0/g（峰值 1）
 *   t = 2L/a   水库反射的负波回到阀门，水头跌到谷值
 *   t = 4L/a   再反射回来，水头重新跃升（峰值 2）
 * 故“阀门水头第二次达到峰值”的时刻与首次之差即往返周期 4L/a。
 */

export interface PeakInfo {
  index: number;
  time: number;
  head: number;
  rise: number;
}

/** 找阀门序列中的最大水头点。 */
export function findPeak(series: readonly ValveSample[]): PeakInfo {
  let best = 0;
  for (let i = 1; i < series.length; i++) {
    if (series[i]!.head > series[best]!.head) best = i;
  }
  return {
    index: best,
    time: series[best]!.time,
    head: series[best]!.head,
    rise: 0,
  };
}

/**
 * 识别“跃升峰”出现的时刻。
 *
 * 以水头跃升量超过首个峰值跃升的一半为阈值，把连续超阈的时间层归为一个峰段；
 * 每个峰段取其第一个样本（跃升沿的到达时刻）。
 * 缓慢关闭时水头单峰缓升，也只会形成一个峰段，因此无法观测周期时返回空。
 */
export function findJumpPeakTimes(
  series: readonly ValveSample[],
  initialHead: number,
): number[] {
  if (series.length < 2) return [];

  let maxRise = 0;
  for (const s of series) {
    const rise = s.head - initialHead;
    if (rise > maxRise) maxRise = rise;
  }
  if (maxRise <= 0) return [];

  const threshold = initialHead + 0.5 * maxRise;
  const times: number[] = [];
  let inPeak = false;
  for (const s of series) {
    if (s.head >= threshold) {
      if (!inPeak) {
        times.push(s.time);
        inPeak = true;
      }
    } else {
      inPeak = false;
    }
  }
  return times;
}

function observeWave(
  series: readonly ValveSample[],
  initialHead: number,
  length: number,
  waveSpeed: number,
): WaveObservation {
  const theoreticalPeriod = (4 * length) / waveSpeed;
  const peakTimes = findJumpPeakTimes(series, initialHead);
  const observedPeriod =
    peakTimes.length >= 2 ? peakTimes[1]! - peakTimes[0]! : null;
  return { theoreticalPeriod, observedPeriod, peakTimes };
}

/** 由任意请求（未校验的 JSON）计算完整响应。 */
export function simulate(rawRequest: unknown): SimulationResponse {
  const validated = validateRequest(rawRequest);
  const solverInput: SolverInput = {
    pipe: validated.pipe,
    reservoir: validated.reservoir,
    initialVelocity: validated.initialVelocity,
    opening: validated.opening,
    discretization: validated.discretization,
  };
  const result = runSolver(solverInput);

  const { valveSeries, grid, finalState, meta, continuity } = result;
  const initialValveHead = meta.initialValveHead;

  const peak = findPeak(valveSeries);
  const peakRise = peak.head - initialValveHead;
  const jRise = joukowskyRise(
    validated.pipe.waveSpeed,
    validated.initialVelocity,
  );

  // 连续性相对残差：|蓄量变率 − 净流入| 的时间积分 / |净流入| 的时间积分。
  // 净入流趋于零（全关后）时分母很小，再补一个以 Q0·T 为尺度的口径。
  const q0Scale = meta.initialFlow * grid.simulationTime;
  const residualScale = Math.max(continuity.denVolume, q0Scale);
  const continuityResidual =
    residualScale > 0 ? continuity.numVolume / residualScale : 0;

  const wave = observeWave(
    valveSeries,
    initialValveHead,
    validated.pipe.length,
    validated.pipe.waveSpeed,
  );

  return {
    grid: {
      segments: grid.segments,
      dx: grid.dx,
      dt: grid.dt,
      courant: grid.courant,
      steps: grid.steps,
      simulationTime: grid.simulationTime,
    },
    friction: {
      model: 'darcy-weisbach',
      linearization: meta.frictionLinearization,
      description:
        '达西-魏斯巴赫二次摩阻 Q|Q| 采用显式时间中心正切线性化: Q|Q| ≈ 2|Q*|Q_new − Q*|Q*|，参考流量 Q* 取旧时间层流量与新时间层预估值的算术平均（预估-校正两遍扫描）。',
    },
    summary: {
      peakHead: peak.head,
      peakTime: peak.time,
      initialValveHead,
      peakRise,
      joukowskyRise: jRise,
      peakToJoukowskyRatio: jRise !== 0 ? peakRise / jRise : 0,
      continuityResidual,
    },
    valve: {
      series: valveSeries,
      finalState,
    },
    wave,
  };
}

/** 供测试直接引用的物理量口径。 */
export { GRAVITY };
