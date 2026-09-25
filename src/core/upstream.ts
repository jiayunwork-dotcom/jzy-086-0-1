import type { CharacteristicLine } from './characteristics.js';

/**
 * 上游边界：大容积水库，水头锁死为恒定值 H_R。
 *
 * 边界节点只被逆流而上的 C⁻ 特征线到达（锚点为相邻内点 B）：
 *
 *   C⁻:  H_P = Cm + Bm · Q_P
 *
 * 代入 H_P = H_R：
 *
 *   Q_P = (H_R − Cm) / Bm
 *
 * 允许 Q_P 为负（反射波作用下出现倒流）。
 */
export function solveUpstreamReservoir(
  reservoirHead: number,
  cm: CharacteristicLine,
): { head: number; flow: number } {
  return {
    head: reservoirHead,
    flow: (reservoirHead - cm.constTerm) / cm.inertiaTerm,
  };
}
