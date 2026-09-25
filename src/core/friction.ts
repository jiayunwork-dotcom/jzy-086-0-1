import { GRAVITY } from './constants.js';

/**
 * 摩阻模型：达西-魏斯巴赫（Darcy–Weisbach）稳态二次损失。
 *
 * 单位管长摩阻坡度
 *
 *   S_f = f / (2 g D) · V|V|        [m / m]
 *
 * 用流量表示后，每一个管段（长度 Δx）沿特征线积分的摩阻项为
 *
 *   R · Q|Q|,   R = f Δx / (2 g D A²)
 *
 * 其中 A = π D²/4 为过流面积，B = a/(gA) 为特征线惯性系数。
 */

export interface PipeHydraulics {
  /** 过流面积 A (m²)。 */
  area: number;
  /** 特征线惯性系数 B = a/(gA) (s/m²)。 */
  B: number;
  /** 单管段摩阻系数 R = f Δx/(2 g D A²) (1/m^5)。 */
  R: number;
}

export function pipeHydraulics(params: {
  diameter: number;
  waveSpeed: number;
  frictionFactor: number;
  dx: number;
}): PipeHydraulics {
  const { diameter: D, waveSpeed: a, frictionFactor: f, dx } = params;
  const area = Math.PI * D * D / 4;
  const B = a / (GRAVITY * area);
  const R = (f * dx) / (2 * GRAVITY * D * area * area);
  return { area, B, R };
}

/**
 * 二次摩阻项 Q|Q| 的线性化方式：
 *
 * 「显式时间中心正切线性化」（explicit time-centered tangent）
 *
 *   Q|Q| ≈ 2|Q*|·Q_new − Q*|Q*|
 *
 * 即在参考流量 Q* 处对 φ(Q)=Q|Q| 作一阶（Newton/正切）展开。
 * Q* 取该特征线锚点旧时间层流量与该点新时间层预估值的算术平均
 * （半步中心锚点）：实现上用两遍扫描，第一遍以 Q*=Q_old 作预估，
 * 第二遍以 Q*=(Q_old + Q_pred)/2 作校正。
 *
 * 选它的理由：
 *  1. 线性化后特征线仍保持 H_P = C ∓ B'·Q_P 的一次形式，内点可直接联立；
 *  2. 在与初始稳态一致的水头分布下，φ 的正切在定常流处精确经过自身，
 *     稳态初值不发生数值漂移；
 *  3. 半步中心锚点把摩阻项的截断误差从一阶降到二阶，全局水量平衡
 *     残差可压到离散步长的截断误差量级。
 */
export const FRICTION_LINEARIZATION = 'explicit-time-centered-tangent' as const;

/**
 * 在参考流量 qRef 处线性化后，一条特征线的一次项系数与常数项。
 *
 * C⁺：H_P = Cp − Bp·Q_P
 * C⁻：H_P = Cm + Bm·Q_P
 *
 * @param H    旧时间层锚点节点水头
 * @param Qold 旧时间层锚点节点流量
 * @param qRef 线性化锚点流量（旧值与新值预估的平均）
 * @param sign 特征线方向：+1（C⁺），-1（C⁻）
 */
export function characteristicTerms(
  H: number,
  Qold: number,
  qRef: number,
  B: number,
  R: number,
  sign: 1 | -1,
): { constTerm: number; inertiaTerm: number } {
  const dampedB = B + 2 * R * Math.abs(qRef);
  const frictionConst = R * qRef * Math.abs(qRef);

  if (sign === 1) {
    // C⁺: H_P = H_A + B Q_A + R Q*|Q*| − (B + 2R|Q*|) Q_P
    return {
      constTerm: H + B * Qold + frictionConst,
      inertiaTerm: dampedB,
    };
  }
  // C⁻: H_P = H_B − B Q_B − R Q*|Q*| + (B + 2R|Q*|) Q_P
  return {
    constTerm: H - B * Qold - frictionConst,
    inertiaTerm: dampedB,
  };
}
