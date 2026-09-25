import { characteristicTerms, type PipeHydraulics } from './friction.js';

/**
 * 正、负两族特征线在矩形网格上的咬合（库朗数 C=1）。
 *
 * 时间层 n → n+1 的内点 i（1 ≤ i ≤ N−1）：
 *
 *   C⁺（顺流，沿 +x 自左端点 A=(i−1, n) 到达）:
 *       H_P = Cp − Bp · Q_P
 *   C⁻（逆流，沿 −x 自右端点 B=(i+1, n) 到达）:
 *       H_P = Cm + Bm · Q_P
 *
 * 两式联立解出该点水头与流量：
 *
 *       Q_P = (Cp − Cm) / (Bp + Bm)
 *       H_P = Cp − Bp · Q_P
 *
 * @param qRefA / qRefB 摩阻线性化的锚点流量（旧值与新值预估的平均）。
 */

export interface CharacteristicLine {
  /** 特征线常数项（H 的量纲）。 */
  constTerm: number;
  /** 流量惯性项系数（含线性化摩阻）。 */
  inertiaTerm: number;
}

/** C⁺：锚点为左/上游节点 A。 */
export function cPlus(
  H_A: number,
  Q_A: number,
  qRefA: number,
  hyd: PipeHydraulics,
): CharacteristicLine {
  return characteristicTerms(H_A, Q_A, qRefA, hyd.B, hyd.R, 1);
}

/** C⁻：锚点为右/下游节点 B。 */
export function cMinus(
  H_B: number,
  Q_B: number,
  qRefB: number,
  hyd: PipeHydraulics,
): CharacteristicLine {
  return characteristicTerms(H_B, Q_B, qRefB, hyd.B, hyd.R, -1);
}

export interface InteriorState {
  head: number;
  flow: number;
}

/** 内点：正负两条到达特征线联立。 */
export function solveInterior(cp: CharacteristicLine, cm: CharacteristicLine): InteriorState {
  const flow = (cp.constTerm - cm.constTerm) / (cp.inertiaTerm + cm.inertiaTerm);
  const head = cp.constTerm - cp.inertiaTerm * flow;
  return { head, flow };
}
