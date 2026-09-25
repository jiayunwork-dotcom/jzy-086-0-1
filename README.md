# moc-waterhammer — 单管关阀水锤特征线法瞬变计算服务

一个轻量 HTTP 服务：喂入管道几何与阀门关闭规律，用**特征线法（Method of Characteristics, MOC）**
沿时间轴和管轴逐步推进，回报水头/流速随空间与时间的演化，重点给出**阀门处水头峰值**。

只做单管水锤瞬变这一个内核，**不提供任何前端页面**，输入输出全部走 JSON over HTTP。

- 运行时：Node.js 20（锁定）
- 语言：TypeScript（strict）
- HTTP：Fastify v4
- 单位：SI（m、s、m/s、m³/s、Pa 不出现，水头一律 m）

---

## 1. 数学模型

### 1.1 控制方程

等截面、线弹性薄壁管中的一维瞬变流（忽略对流项）：

```
∂H/∂t + (a²/gA) ∂Q/∂x = 0        连续
∂H/∂x + (1/gA) ∂Q/∂t + S_f = 0   动量
S_f = f V|V| / (2 g D) = R' Q|Q|
```

其中波速 `a` 为输入；摩阻采用**达西–魏斯巴赫**二次损失。

### 1.2 特征线与贴格

两族特征线：

```
C⁺: dx/dt = +a      dH + (a/gA) dQ + S_f·a·dt = 0
C⁻: dx/dt = −a      dH − (a/gA) dQ − S_f·a·dt = 0
```

固定矩形网格上要求**库朗数恰为 1**：

```
Δx = a · Δt  ⇔  C = aΔt/Δx = 1
```

服务**强制贴格**：给定 `segments` 则 Δt 由网格决定；给定 `dt` 则必须使 `L/(a·dt)`
为整数；两者同给必须互相吻合；模拟时长必须是 Δt 的整数倍。凑不出来就回结构化
错误 `grid`，绝不勉强推进。

### 1.3 摩阻线性化（写死的那一种）

每个管段沿特征线积分后的摩阻项为 `R·Q|Q|`，其中

```
R = f Δx / (2 g D A²),   A = πD²/4
```

对二次项 `φ(Q) = Q|Q|` 作**显式时间中心正切线性化**：

```
Q|Q| ≈ 2|Q*|·Q_new − Q*|Q*|
```

参考流量 `Q*` 取旧时间层锚点流量与新时间层预估值的算术平均。实现为每个时间层
**两遍扫描**：第一遍以 `Q*=Q_old` 预估，第二遍以 `Q*=(Q_old+Q_pred)/2` 校正。

- 线性化后特征线仍为一次形式，内点可直接联立；
- 定常流处正切精确经过自身，稳态初值不漂移；
- 半步中心锚点使摩阻截断误差为二阶。

### 1.4 内点联立

```
C⁺（自左端点 A）: H_P = Cp − Bp·Q_P
C⁻（自右端点 B）: H_P = Cm + Bm·Q_P
⇒ Q_P = (Cp − Cm)/(Bp + Bm),  H_P = Cp − Bp·Q_P
```

### 1.5 边界

- **上游**：大容积水库，水头锁死 `H_P = H_R`，与到达的 C⁻ 联立
  `Q_P = (H_R − Cm)/Bm`（允许倒流）。
- **下游阀门**：孔口方程由初始稳态工况标定
  `Q_P = τ·Q0·√(H_P/H0)`，与到达的 C⁺ `H_P = Cp − Bp·Q_P` **联立求二次方程**
  （令 `k=τQ0/√H0, y=√H_P`，解 `y² + Bp·k·y − Cp = 0`）。
  τ=0 时退化为 `Q_P=0, H_P=Cp`。服务不建模液柱分离，`Cp≤0` 时把阀门水头/流量
  钳零并标记（避免复数解）。

### 1.6 初始条件

阀门全开均匀流：全管 `Q=Q0=V0·A`，水头沿程线性扣除摩阻
`H(x) = H_R − (fV0²/2gD)·x`。

---

## 2. HTTP 接口

### `POST /simulate`

请求体：

```jsonc
{
  "pipe": { "length": 1000, "diameter": 0.5, "waveSpeed": 1000, "frictionFactor": 0.0 },
  "reservoir": { "head": 300 },
  "initialVelocity": 1.0,
  "closure": { "kind": "linear", "closureTime": 0.05 },
  "discretization": { "segments": 20 }
}
```

- `closure.kind`：
  - `"linear"`：τ 在 `[0, closureTime]` 由 1 线性降到 0；
  - `"piecewise"`：`points: [{time, opening}, …]` 线性插值覆盖，必须从
    `(0, 1)` 开始、以 `opening=0` 结束、时间严格递增。
- `discretization`：`segments` 与 `dt` 至少给一个；可选 `simulationTime`
  （不给则自动取“关闭完成 + 2 个往返周期”）与 `maxSteps`（默认 200000，硬顶 5000000）。

响应（节选）：

```jsonc
{
  "grid": { "segments": 20, "dx": 50, "dt": 0.05, "courant": 1, "steps": 161, "simulationTime": 8.05 },
  "friction": { "model": "darcy-weisbach", "linearization": "explicit-time-centered-tangent", "description": "…" },
  "summary": {
    "peakHead": 401.94, "peakTime": 0.05,
    "initialValveHead": 300, "peakRise": 101.94,
    "joukowskyRise": 101.94, "peakToJoukowskyRatio": 1.0,
    "continuityResidual": 4.4e-19
  },
  "valve": {
    "series": [ { "step": 0, "time": 0, "opening": 1, "head": 300, "flow": 0.196, "velocity": 1 }, … ],
    "finalState": { "time": 8.05, "heads": […21 点], "flows": […], "velocities": […] }
  },
  "wave": { "theoreticalPeriod": 4, "observedPeriod": 4, "peakTimes": [0.05, 4.05, 8.05] }
}
```

错误响应（结构化）：

```jsonc
{ "error": { "code": "validation | grid | limit", "message": "…", "details": { … } } }
```

- `validation` → HTTP 400：参数非法/缺字段/关闭历时为负/分段规律不自洽等；
- `grid` → HTTP 400：离散参数凑不出库朗数为 1 的贴格网格（附 `courant`、实算段数等细节）；
- `limit` → HTTP 422：推进步数超过上限。

### `GET /healthz`

返回 `{"status":"ok"}`。

---

## 3. 近瞬时关闭算例（可与儒可夫斯基估计直接比对）

`examples/instant-closure.json`：L=1000 m，D=0.5 m，a=1000 m/s，V0=1 m/s，
H_R=300 m，无摩擦，N=20（Δt=0.05 s），关闭历时恰为一个 Δt。

```
儒可夫斯基跃升 ΔH_J = aV0/g = 1000·1/9.81 = 101.94 m
计算峰值水头         = 401.94 m   （跃升 101.94 m）
峰值/儒可夫斯基     = 1.0000000000000002
波往返周期 4L/a     = 4 s；第二峰时刻 − 首峰时刻 = 4.05 − 0.05 = 4 s
```

另一算例 `examples/piecewise-closure.json` 演示分段（多段折线）关闭。

---

## 4. 一键启动

### 容器（推荐）

```bash
docker compose up --build        # 构建并启动，监听 0.0.0.0:8080

# 调用
curl -s -X POST http://localhost:8080/simulate \
  -H 'content-type: application/json' \
  --data @examples/instant-closure.json
```

### 本地直接跑

```bash
npm ci                 # Node 20
npm test               # 自动化测试
npm run build          # 产出 dist/
npm start              # 启动 HTTP 服务（默认端口 8080，可用 PORT 覆盖）
```

---

## 5. 模块划分（内核与边界各自独立）

```
src/
  main.ts                    进程入口
  server.ts                  HTTP 层（Fastify），只负责收发与错误码映射
  types.ts                   请求/响应数据结构
  core/
    constants.ts             g 等物理常量
    errors.ts                validation/grid/limit 结构化错误
    validation.ts            输入校验
    valveSchedule.ts         线性 / 分段关闭规律 τ(t)
    grid.ts                  贴格网格（Δx=aΔt、整数步、步数上限）
    friction.ts              达西摩阻系数 + Q|Q| 时间中心正切线性化
    characteristics.ts       C⁺/C⁻ 系数与内点联立
    upstream.ts              上游水库边界
    downstream.ts            下游阀门边界（孔口方程联立 C⁺）
    solver.ts                网格上的时间推进（预估-校正两遍）
    analysis.ts              峰值/周期观测、连续性残差、组装响应
    *.test.ts                自动化测试
```

---

## 6. 自动化测试（`npm test`，node:test）

用水力学规律钉死正确性，均带明确容差：

1. **非法与不贴格输入**：波速/管长/管径非正、关闭历时为负、缺水库水头或初始流速、
   分段规律不自洽 → `validation`；`dt` 凑不出整数段、`segments` 与 `dt` 不吻合、
   模拟时长非整步 → `grid`；步数超限 → `limit`。
2. **瞬时关闭逼近儒可夫斯基**：无摩擦近瞬时全关，`ΔH` 与 `aV0/g` 的相对差 < 1e-9，
   峰值/儒可夫斯基比与 1 的差 < 1e-9。
3. **往返周期 ≈ 4L/a**：由阀门第二次跃升峰时刻观测，与理论值差不超过一个时间步长。
4. **缓关峰值低于瞬时关**：Tc = 5·(4L/a) 时峰值/儒可夫斯基比 < 0.2，且严格小于瞬时峰值。
5. **流量协调**：无摩擦时“管内弹性蓄量变化率 = 上游入流 − 阀门出流”的时间积分相对
   残差 < 1e-10；带摩阻时验证残差随网格加密按一阶收敛（边界管段摩阻离散误差）。
6. 另含首波到达时全管静止/普遍升压、阀门全关后流量恒零、分段与等价线性关闭一致、
   HTTP 层 200/400/422 与健康检查等。

---

## 7. 适用范围与已知简化

- 单管、等截面、线弹性水锤波，波速作为输入（不在服务内由管材/壁厚反算）。
- 不建模液柱分离/汽蚀：出现负压边界条件时钳零并标记，结果不再有物理意义，
  调用方应据此调整方案（提高 H_R、减小 V0 等）。
- 不含泵、调压塔、空气阀、分叉管网、非恒定摩阻（瞬变摩阻修正）等。
