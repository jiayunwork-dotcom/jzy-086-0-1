import type { DiscretizationSpec, GridInfo } from '../types.js';
import { gridError, limitError } from './errors.js';

/** 步数硬上限的默认值与绝对封顶，防止异常输入把推进拖成死循环。 */
export const DEFAULT_MAX_STEPS = 200_000;
export const ABSOLUTE_MAX_STEPS = 5_000_000;

/** 内部数值吻合的相对容差。 */
const GRID_MATCH_REL_TOL = 1e-9;
const TIME_MATCH_REL_TOL = 1e-9;

export interface BuildGridInput {
  length: number;
  waveSpeed: number;
  closureTime: number;
  discretization?: DiscretizationSpec;
}

/**
 * 构造贴格网格。
 *
 * 特征线法在固定矩形网格上要求库朗数恰为 1：
 *
 *   Δx = a · Δt  （即 C = a·Δt/Δx = 1）
 *
 * - 只给 segments：Δx = L/N，Δt = L/(N·a)，天然贴格；
 * - 只给 dt：N = L/(a·dt) 必须为整数，否则报网格错误，绝不勉强推进；
 * - 二者同给：必须在数值容差内互相吻合，否则报错。
 *
 * 时间层同样要求模拟总时长是 Δt 的整数倍；默认时长取
 * “关闭历时 + 2 个往返周期（4L/a）”，并向上取整到整步。
 */
export function buildGrid(input: BuildGridInput): GridInfo {
  const { length, waveSpeed, closureTime } = input;
  const disc = input.discretization ?? {};

  const travelTime = length / waveSpeed; // L/a，单程波传播时间

  let segments: number;
  let dt: number;
  let dx: number;

  if (disc.segments !== undefined && disc.dt !== undefined) {
    segments = disc.segments;
    dt = disc.dt;
    dx = length / segments;
    const dtFromGrid = dx / waveSpeed;
    const scale = Math.max(Math.abs(dt), dtFromGrid);
    if (Math.abs(dt - dtFromGrid) > GRID_MATCH_REL_TOL * scale) {
      gridError(
        '给定的时间步长与管段数不满足贴格条件 Δx = a·Δt（库朗数必须恰为 1），拒绝勉强推进',
        {
          givenDt: dt,
          dtRequiredByGrid: dtFromGrid,
          dx,
          waveSpeed,
          segments,
          courant: (waveSpeed * dt) / dx,
        },
      );
    }
  } else if (disc.segments !== undefined) {
    segments = disc.segments;
    dx = length / segments;
    dt = dx / waveSpeed;
  } else {
    // 只给 dt
    dt = disc.dt!;
    const nExact = length / (waveSpeed * dt);
    const nRounded = Math.round(nExact);
    if (
      nRounded < 2 ||
      Math.abs(nExact - nRounded) > GRID_MATCH_REL_TOL * Math.max(1, nExact)
    ) {
      gridError(
        '给定的时间步长无法把管长等分为整数段（要求 L/(a·dt) 为整数），凑不出贴格网格',
        {
          givenDt: dt,
          requiredSegmentsExact: nExact,
          waveSpeed,
          length,
        },
      );
    }
    segments = nRounded;
    dx = length / segments;
    dt = dx / waveSpeed; // 以网格为准，消去舍入误差
  }

  // ---- 时间层 ----
  const roundTrip = (4 * length) / waveSpeed; // 4L/a

  let steps: number;
  let simulationTime: number;
  if (disc.simulationTime !== undefined) {
    simulationTime = disc.simulationTime;
    const stepsExact = simulationTime / dt;
    const stepsRounded = Math.round(stepsExact);
    if (
      Math.abs(stepsExact - stepsRounded) >
      TIME_MATCH_REL_TOL * Math.max(1, stepsExact)
    ) {
      gridError(
        '模拟时长不是时间步长的整数倍，时间网格不贴格',
        {
          simulationTime,
          dt,
          stepsExact,
        },
      );
    }
    steps = stepsRounded;
  } else {
    // 默认：关闭完成后再观察两个往返周期，向上取整保证覆盖完整。
    steps = Math.ceil((closureTime + 2 * roundTrip) / dt);
    simulationTime = steps * dt;
  }

  if (steps < 1) {
    gridError('推进步数至少为 1', { steps });
  }

  const maxSteps = Math.min(
    disc.maxSteps ?? DEFAULT_MAX_STEPS,
    ABSOLUTE_MAX_STEPS,
  );
  if (steps > maxSteps) {
    limitError(
      `推进步数 ${steps} 超过上限 ${maxSteps}，已终止（可调大 discretization.maxSteps 或加粗网格）`,
      { steps, maxSteps },
    );
  }

  return {
    segments,
    dx,
    dt,
    courant: (waveSpeed * dt) / dx,
    steps,
    simulationTime,
  };
}
