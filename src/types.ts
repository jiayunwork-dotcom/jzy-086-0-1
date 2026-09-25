/**
 * 服务对外的请求/响应数据结构（JSON over HTTP）。
 *
 * 全部采用 SI 单位：长度 m，时间 s，流速 m/s，水头 m，流量 m^3/s。
 */

/** 等截面管道几何与水力参数。 */
export interface PipeSpec {
  /** 管长 L (m)，必须 > 0。 */
  length: number;
  /** 内径 D (m)，必须 > 0。 */
  diameter: number;
  /** 水锤波速 a (m/s)，必须 > 0。 */
  waveSpeed: number;
  /** 达西-魏斯巴赫摩阻系数 f（无量纲），必须 >= 0。 */
  frictionFactor: number;
}

/** 上游恒定水库边界。 */
export interface ReservoirSpec {
  /** 水库恒定水头 H_R (m, 相对同一基准面)，必须 > 0。 */
  head: number;
}

/**
 * 阀门关闭规律。
 * - kind=linear：相对开度 τ 在 [0, closureTime] 内由 1 线性降到 0；
 * - kind=piecewise：调用方以 (time, opening) 数据点覆盖，内部线性插值。
 * 相对开度 1 = 全开，0 = 全关。
 */
export type ClosureSchedule =
  | { kind: 'linear'; closureTime: number }
  | { kind: 'piecewise'; points: ReadonlyArray<{ time: number; opening: number }> };

/** 离散控制。时间步长由特征线贴格要求 Δx = a·Δt 决定。 */
export interface DiscretizationSpec {
  /** 管段数 N（节点数 N+1），与 dt 至少给一个；同时给时必须互相吻合。 */
  segments?: number;
  /** 时间步长 (s)。 */
  dt?: number;
  /** 模拟总时长 (s)；不给则自动取“关闭完成 + 两个波往返周期”。 */
  simulationTime?: number;
  /** 推进步数硬上限，防止异常输入导致死循环。默认 200000，封顶 5000000。 */
  maxSteps?: number;
}

/** 完整计算请求。 */
export interface SimulationRequest {
  pipe: PipeSpec;
  reservoir: ReservoirSpec;
  /** 初始（稳态、阀门全开）管内平均流速 V0 (m/s)，必须 > 0。 */
  initialVelocity: number;
  closure: ClosureSchedule;
  discretization?: DiscretizationSpec;
}

/** 贴格后的计算网格。 */
export interface GridInfo {
  segments: number;
  dx: number;
  dt: number;
  courant: number;
  steps: number;
  simulationTime: number;
}

/** 阀门处一个时刻的采样。 */
export interface ValveSample {
  step: number;
  time: number;
  opening: number;
  head: number;
  flow: number;
  velocity: number;
}

/** 全管一个时刻的快照（默认只给末态）。 */
export interface PipeState {
  time: number;
  /** 各节点水头 H_i (m)。 */
  heads: number[];
  /** 各节点流量 Q_i (m^3/s)。 */
  flows: number[];
  /** 各节点断面平均流速 V_i (m/s)。 */
  velocities: number[];
}

/** 波往返周期观测结果。 */
export interface WaveObservation {
  /** 理论往返周期 4L/a (s)。 */
  theoreticalPeriod: number;
  /** 由阀门水头相邻跃升峰观测到的周期 (s)，无法稳定识别时为 null。 */
  observedPeriod: number | null;
  /** 各跃升峰首次出现的时刻 (s)。 */
  peakTimes: number[];
}

/** 计算结果摘要。 */
export interface SimulationSummary {
  /** 阀门处峰值水头 H_max (m)。 */
  peakHead: number;
  /** 峰值出现时刻 (s)。 */
  peakTime: number;
  /** 初始阀门水头 (m)。 */
  initialValveHead: number;
  /** 峰值相对初态的跃升 ΔH (m)。 */
  peakRise: number;
  /** 儒可夫斯基瞬时关闭跃升 a·V0/g (m)。 */
  joukowskyRise: number;
  /** 峰值跃升与儒可夫斯基值之比。 */
  peakToJoukowskyRatio: number;
  /** 全局水量/弹性蓄量平衡的相对残差（越小越协调）。 */
  continuityResidual: number;
}

/** 采用的摩阻线性化方法说明。 */
export interface FrictionInfo {
  model: 'darcy-weisbach';
  /** 稳态二次损失项 R·Q|Q| 在每条特征线上的线性化方式。 */
  linearization:
    | 'explicit-time-centered-tangent';
  description: string;
}

/** 完整计算响应。 */
export interface SimulationResponse {
  grid: GridInfo;
  friction: FrictionInfo;
  summary: SimulationSummary;
  valve: {
    /** 阀门处每个时间层的采样。 */
    series: ValveSample[];
    finalState: PipeState;
  };
  wave: WaveObservation;
}

/** 结构化错误响应。 */
export interface ErrorResponse {
  error: {
    code: ServiceErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

import type { ServiceErrorCode } from './core/errors.js';
