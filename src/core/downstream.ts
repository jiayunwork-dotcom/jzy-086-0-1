import type { CharacteristicLine } from './characteristics.js';

export interface ValveBoundaryParams {
  /** 当前相对开度 τ ∈ [0,1]。 */
  opening: number;
  /** 初始稳态流量 Q0 (m³/s)。 */
  initialFlow: number;
  /**
   * 初始稳态阀门作用水头 H0 (m)。
   * 孔口系数由初始稳态工况标定：Q = τ Q0·√(H/H0)。
   */
  initialHead: number;
}

export interface ValveBoundaryResult {
  head: number;
  flow: number;
  /** true 表示 Cp 已为负、出现负压，按液柱分离未建模处理而钳零（标记出来）。 */
  clamped: boolean;
}

/**
 * 下游边界：阀门孔口方程与顺流到达的 C⁺ 特征线联立求解。
 *
 *   C⁺（锚点为相邻内点 A）: H_P = Cp − Bp · Q_P
 *   阀门孔口（定常态孔流关系）: Q_P = τ Q0 · √(H_P / H0)
 *
 * 令 k = τ Q0/√H0、y = √H_P，则
 *
 *   y² + Bp·k·y − Cp = 0
 *   y  = (−Bp·k + √(Bp²k² + 4Cp)) / 2
 *
 * τ=0（全关）时二次方程退化为 y=0、Q_P=0，水头直接取 H_P=Cp。
 *
 * 本服务不建模液柱分离/汽化：若 Cp ≤ 0（理论上要出现负压），
 * 把阀门水头钳到 0、流量钳到 0 并置 clamped 标记，避免出现复数解。
 */
export function solveDownstreamValve(
  cp: CharacteristicLine,
  params: ValveBoundaryParams,
): ValveBoundaryResult {
  const { opening, initialFlow, initialHead } = params;
  const Cp = cp.constTerm;
  const Bp = cp.inertiaTerm;

  if (opening <= 0) {
    if (Cp > 0) {
      return { head: Cp, flow: 0, clamped: false };
    }
    return { head: 0, flow: 0, clamped: true };
  }

  if (Cp <= 0) {
    return { head: 0, flow: 0, clamped: true };
  }

  const k = (opening * initialFlow) / Math.sqrt(initialHead);
  const disc = Bp * Bp * k * k + 4 * Cp;
  const y = (-Bp * k + Math.sqrt(disc)) / 2;
  const head = y * y;
  const flow = k * y;
  return { head, flow, clamped: false };
}
