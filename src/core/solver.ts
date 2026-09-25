import { cMinus, cPlus, solveInterior } from './characteristics.js';
import { GRAVITY } from './constants.js';
import {
  FRICTION_LINEARIZATION,
  pipeHydraulics,
} from './friction.js';
import { limitError, validationError } from './errors.js';
import { buildGrid } from './grid.js';
import { solveDownstreamValve } from './downstream.js';
import { solveUpstreamReservoir } from './upstream.js';
import type {
  GridInfo,
  PipeSpec,
  PipeState,
  ReservoirSpec,
  ValveSample,
} from '../types.js';
import type { OpeningFn } from './valveSchedule.js';

export interface SolverInput {
  pipe: Required<PipeSpec>;
  reservoir: Required<ReservoirSpec>;
  initialVelocity: number;
  opening: OpeningFn;
  discretization?: import('../types.js').DiscretizationSpec;
}

/** 推进过程中累积的水量/弹性蓄量协调量（供连续性核算）。 */
export interface ContinuityAccumulator {
  /** 每时间层 |蓄量变率 − 净流入|·Δt 之和 (m³)。 */
  numVolume: number;
  /** 每时间层 |净入流|·Δt 之和 (m³)，作归一化基准。 */
  denVolume: number;
  /** 全流程累计净入流体积 (m³)。 */
  netInflowVolume: number;
  /** 全流程蓄量变化 (m³)。 */
  storageChange: number;
}

export interface SolverResult {
  grid: GridInfo;
  meta: {
    area: number;
    B: number;
    R: number;
    initialFlow: number;
    initialValveHead: number;
    frictionLinearization: typeof FRICTION_LINEARIZATION;
  };
  valveSeries: ValveSample[];
  finalState: PipeState;
  continuity: ContinuityAccumulator;
}

/**
 * 网格与时间推进：按时间层 n = 0..steps 推进。
 *
 * 每个时间层内：
 *  - 所有内点由正、负两条到达特征线联立；
 *  - 上游锁死水库水头（与到达的 C⁻ 联立）；
 *  - 下游阀门把孔口方程与到达的 C⁺ 联立求解（不手写水头增量）。
 *
 * 摩阻采用时间中心正切线性化，每个时间层做两遍扫描：
 * 第一遍以旧时间层流量为锚点预估，第二遍以旧值与预估值的平均为
 * 锚点校正，使线性化误差达到二阶。
 */
export function runSolver(input: SolverInput): SolverResult {
  const { pipe, reservoir, initialVelocity: V0, opening, discretization } = input;

  const grid = buildGrid({
    length: pipe.length,
    waveSpeed: pipe.waveSpeed,
    closureTime: opening.closureTime,
    discretization,
  });

  const { area, B, R } = pipeHydraulics({
    diameter: pipe.diameter,
    waveSpeed: pipe.waveSpeed,
    frictionFactor: pipe.frictionFactor,
    dx: grid.dx,
  });

  const Q0 = V0 * area;

  // ---- 初始稳态水头线：均匀流 + 沿程摩阻坡降 ----
  // H(x) = H_R − S_f·x,  S_f = f V0²/(2 g D)
  const frictionSlope =
    (pipe.frictionFactor * V0 * V0) / (2 * GRAVITY * pipe.diameter);
  const initialValveHead = reservoir.head - frictionSlope * pipe.length;
  if (!(initialValveHead > 0)) {
    validationError(
      '水库水头不足以克服全程沿程摩阻来维持给定初始流速，初始阀门作用水头非正',
      {
        reservoirHead: reservoir.head,
        frictionLoss: frictionSlope * pipe.length,
        initialValveHead,
      },
    );
  }

  const N = grid.segments;
  const heads = new Array<number>(N + 1);
  const flows = new Array<number>(N + 1);
  for (let i = 0; i <= N; i++) {
    heads[i] = reservoir.head - frictionSlope * (i * grid.dx);
    flows[i] = Q0;
  }

  // 弹性蓄量节点系数 gA/a²，配空间梯形权
  const storageCoef = (GRAVITY * area) / (pipe.waveSpeed * pipe.waveSpeed);
  const nodeWeight = (i: number): number =>
    i === 0 || i === N ? 0.5 * grid.dx : grid.dx;

  const continuity: ContinuityAccumulator = {
    numVolume: 0,
    denVolume: 0,
    netInflowVolume: 0,
    storageChange: 0,
  };

  const valveSeries: ValveSample[] = [];
  const recordValve = (
    n: number,
    time: number,
    tau: number,
    head: number,
    flow: number,
  ): void => {
    valveSeries.push({
      step: n,
      time,
      opening: tau,
      head,
      flow,
      velocity: flow / area,
    });
  };

  recordValve(0, 0, 1, heads[N]!, flows[N]!);

  const newHeads = new Array<number>(N + 1);
  const newFlows = new Array<number>(N + 1);
  const predFlows = new Array<number>(N + 1);
  const hyd = { area, B, R };

  const maxSteps = Math.min(
    discretization?.maxSteps ?? 200_000,
    5_000_000,
  );

  const advanceOneLayer = (
    tau: number,
    usePredictor: boolean,
  ): { clamped: boolean } => {
    let clamped = false;

    // 上游水库边界：C⁻ 自节点 1 到达
    const qRefUp = usePredictor ? flows[1]! : 0.5 * (flows[1]! + predFlows[1]!);
    const cmUp = cMinus(heads[1]!, flows[1]!, qRefUp, hyd);
    const up = solveUpstreamReservoir(reservoir.head, cmUp);
    newHeads[0] = up.head;
    newFlows[0] = up.flow;

    // 内点：C⁺、C⁻ 联立
    for (let i = 1; i < N; i++) {
      const qRefL = usePredictor
        ? flows[i - 1]!
        : 0.5 * (flows[i - 1]! + predFlows[i - 1]!);
      const qRefR = usePredictor
        ? flows[i + 1]!
        : 0.5 * (flows[i + 1]! + predFlows[i + 1]!);
      const cp = cPlus(heads[i - 1]!, flows[i - 1]!, qRefL, hyd);
      const cm = cMinus(heads[i + 1]!, flows[i + 1]!, qRefR, hyd);
      const s = solveInterior(cp, cm);
      newHeads[i] = s.head;
      newFlows[i] = s.flow;
    }

    // 下游阀门边界：C⁺ 自节点 N−1 到达，与孔口方程联立
    const qRefDn = usePredictor
      ? flows[N - 1]!
      : 0.5 * (flows[N - 1]! + predFlows[N - 1]!);
    const cpDown = cPlus(heads[N - 1]!, flows[N - 1]!, qRefDn, hyd);
    const valve = solveDownstreamValve(cpDown, {
      opening: tau,
      initialFlow: Q0,
      initialHead: initialValveHead,
    });
    clamped = valve.clamped;
    newHeads[N] = valve.head;
    newFlows[N] = valve.flow;

    return { clamped };
  };

  for (let n = 1; n <= grid.steps; n++) {
    if (n > maxSteps) {
      limitError('推进步数超过上限，强制终止', { steps: n, maxSteps });
    }

    const time = n * grid.dt;
    const tau = opening.openingAt(time);

    // 第一遍：预估
    advanceOneLayer(tau, true);
    for (let i = 0; i <= N; i++) predFlows[i] = newFlows[i]!;
    // 第二遍：以半步中心锚点校正
    advanceOneLayer(tau, false);

    // ---- 连续性（水量/弹性蓄量）核算：时间梯形、空间梯形 ----
    let storageRate = 0;
    for (let i = 0; i <= N; i++) {
      storageRate +=
        storageCoef * nodeWeight(i) * (newHeads[i]! - heads[i]!) / grid.dt;
    }
    const inFlow = 0.5 * (flows[0]! + newFlows[0]!);
    const outFlow = 0.5 * (flows[N]! + newFlows[N]!);
    const netIn = inFlow - outFlow;
    continuity.numVolume += Math.abs(storageRate - netIn) * grid.dt;
    continuity.denVolume += Math.abs(netIn) * grid.dt;
    continuity.netInflowVolume += netIn * grid.dt;
    continuity.storageChange += storageRate * grid.dt;

    for (let i = 0; i <= N; i++) {
      heads[i] = newHeads[i]!;
      flows[i] = newFlows[i]!;
    }

    recordValve(n, time, tau, heads[N]!, flows[N]!);
  }

  const finalState: PipeState = {
    time: grid.simulationTime,
    heads: heads.slice(),
    flows: flows.slice(),
    velocities: flows.map((q) => q / area),
  };

  return {
    grid,
    meta: {
      area,
      B,
      R,
      initialFlow: Q0,
      initialValveHead,
      frictionLinearization: FRICTION_LINEARIZATION,
    },
    valveSeries,
    finalState,
    continuity,
  };
}
