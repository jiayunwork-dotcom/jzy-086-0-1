import type {
  ClosureSchedule,
  DiscretizationSpec,
  PipeSpec,
  ReservoirSpec,
  SimulationRequest,
} from '../types.js';
import { GRAVITY } from './constants.js';
import { validationError } from './errors.js';
import { buildOpeningFn, type OpeningFn } from './valveSchedule.js';

/** 校验后的请求。 */
export interface ValidatedRequest {
  pipe: Required<PipeSpec>;
  reservoir: Required<ReservoirSpec>;
  initialVelocity: number;
  discretization: DiscretizationSpec | undefined;
  opening: OpeningFn;
}

function isPlainNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 按需求逐项校验：
 * - 波速、管长、管径非正即非法；
 * - 关闭历时为负非法；
 * - 缺水库水头或缺初始流速非法。
 */
export function validateRequest(raw: unknown): ValidatedRequest {
  if (typeof raw !== 'object' || raw === null) {
    validationError('请求体必须是 JSON 对象');
  }
  const req = raw as Record<string, unknown>;

  // ---- 管道 ----
  const pipeRaw = req.pipe as Record<string, unknown> | undefined;
  if (typeof pipeRaw !== 'object' || pipeRaw === null) {
    validationError('缺少管道参数 pipe（需含 length/diameter/waveSpeed/frictionFactor）');
  }

  const length = pipeRaw.length;
  const diameter = pipeRaw.diameter;
  const waveSpeed = pipeRaw.waveSpeed;
  const frictionFactor = pipeRaw.frictionFactor;

  if (!isPlainNumber(length) || length <= 0) {
    validationError('管长 length 必须为正数', { length });
  }
  if (!isPlainNumber(diameter) || diameter <= 0) {
    validationError('管径 diameter 必须为正数', { diameter });
  }
  if (!isPlainNumber(waveSpeed) || waveSpeed <= 0) {
    validationError('波速 waveSpeed 必须为正数', { waveSpeed });
  }
  if (!isPlainNumber(frictionFactor) || frictionFactor < 0) {
    validationError('摩阻系数 frictionFactor 必须为非负数', {
      frictionFactor,
    });
  }

  const pipe: Required<PipeSpec> = { length, diameter, waveSpeed, frictionFactor };

  // ---- 水库 ----
  const resRaw = req.reservoir as Record<string, unknown> | undefined;
  if (typeof resRaw !== 'object' || resRaw === null) {
    validationError('缺少上游水库参数 reservoir（需含 head）');
  }
  const head = resRaw.head;
  if (!isPlainNumber(head) || head <= 0) {
    validationError('缺少有效的水库水头 reservoir.head（必须为正数）', { head });
  }
  const reservoir: Required<ReservoirSpec> = { head };

  // ---- 初始流速 ----
  if (!('initialVelocity' in req)) {
    validationError('缺少初始流速 initialVelocity');
  }
  const v0 = req.initialVelocity;
  if (!isPlainNumber(v0) || v0 <= 0) {
    validationError('初始流速 initialVelocity 必须为正数（初始时刻阀门全开、有正向流动）', {
      initialVelocity: v0,
    });
  }

  // ---- 关闭规律 ----
  const closureRaw = req.closure as Record<string, unknown> | undefined;
  if (typeof closureRaw !== 'object' || closureRaw === null) {
    validationError('缺少阀门关闭规律 closure（kind=linear 或 piecewise）');
  }
  const closure = validateClosure(closureRaw);

  // ---- 离散参数（网格贴格的细节在 grid 模块里判）----
  let discretization: DiscretizationSpec | undefined;
  if (req.discretization !== undefined && req.discretization !== null) {
    if (typeof req.discretization !== 'object') {
      validationError('discretization 必须是对象');
    }
    discretization = validateDiscretization(
      req.discretization as Record<string, unknown>,
    );
  }

  return {
    pipe,
    reservoir,
    initialVelocity: v0,
    discretization,
    opening: buildOpeningFn(closure),
  };
}

function validateClosure(raw: Record<string, unknown>): ClosureSchedule {
  if (raw.kind === 'linear') {
    if (!('closureTime' in raw)) {
      validationError('线性关闭规律缺少关闭历时 closureTime');
    }
    const Tc = raw.closureTime;
    if (!isPlainNumber(Tc) || Tc < 0) {
      validationError('关闭历时 closureTime 不能为负且必须有限', {
        closureTime: Tc,
      });
    }
    return { kind: 'linear', closureTime: Tc };
  }

  if (raw.kind === 'piecewise') {
    if (!Array.isArray(raw.points)) {
      validationError('分段关闭规律需要 points 数组');
    }
    return {
      kind: 'piecewise',
      points: raw.points as ReadonlyArray<{ time: number; opening: number }>,
    };
  }

  validationError('关闭规律 closure.kind 只支持 linear 或 piecewise', {
    kind: raw.kind,
  });
}

function validateDiscretization(
  raw: Record<string, unknown>,
): DiscretizationSpec {
  const out: DiscretizationSpec = {};

  if ('segments' in raw && raw.segments !== undefined) {
    if (!Number.isInteger(raw.segments) || (raw.segments as number) < 2) {
      validationError('管段数 segments 必须是 >= 2 的整数', {
        segments: raw.segments,
      });
    }
    out.segments = raw.segments as number;
  }

  if ('dt' in raw && raw.dt !== undefined) {
    if (!isPlainNumber(raw.dt) || raw.dt <= 0) {
      validationError('时间步长 dt 必须为正数', { dt: raw.dt });
    }
    out.dt = raw.dt as number;
  }

  if (
    out.segments === undefined &&
    out.dt === undefined
  ) {
    validationError('离散参数至少要给 segments 或 dt 中的一个（二者决定贴格网格）');
  }

  if ('simulationTime' in raw && raw.simulationTime !== undefined) {
    if (!isPlainNumber(raw.simulationTime) || raw.simulationTime <= 0) {
      validationError('模拟时长 simulationTime 必须为正数', {
        simulationTime: raw.simulationTime,
      });
    }
    out.simulationTime = raw.simulationTime as number;
  }

  if ('maxSteps' in raw && raw.maxSteps !== undefined) {
    if (!Number.isInteger(raw.maxSteps) || (raw.maxSteps as number) <= 0) {
      validationError('maxSteps 必须为正整数', { maxSteps: raw.maxSteps });
    }
    out.maxSteps = raw.maxSteps as number;
  }

  return out;
}

/** 儒可夫斯基瞬时关闭水头跃升 a·V0/g（供各模块共享口径）。 */
export function joukowskyRise(waveSpeed: number, v0: number): number {
  return (waveSpeed * v0) / GRAVITY;
}
