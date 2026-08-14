---
title: Glimmer中实现方向光 Shadow Map 与 CSM
cover: cover_745aefd8.png
top_img: false
toc: true
aside: true
abbrlink: 745aefd8
date: 2026-08-12 16:44:16
updated: 2026-08-13 17:23:41
categories: 游戏引擎
tags:
  - 引擎开发
  - 渲染原理
description: 记录在Glimmer中实现Shadow Map和级联阴影CSM的过程。
keywords:
katex: true
---
![](cover_745aefd8.png)

在实时渲染中，阴影的重要性是不言而喻的。

没有阴影时，物体虽然拥有正确的颜色、法线和高光，却很难与周围环境建立可靠的空间关系：模型究竟落在地面上，还是悬浮在半空？山体之间是否相互遮挡？方向光来自哪个方向？这些问题仅靠 PBR 参数无法回答。

对 Glimmer 这样的场景编辑器而言，方向光阴影还要面对另一类问题：它不能只在某个演示场景中“看起来能用”，而必须同时适配模型、程序化地形、材质透明模式、编辑器相机和运行时相机，并提供足够稳定的调试与性能反馈。

因此，Glimmer 最终实现的并不是一张简单的方向光深度图，而是一套完整的 1～4 级 Cascaded Shadow Maps，简称 CSM：

- 使用 Practical Split 分配近远级联；
- 每级构造稳定的方向光正交投影；
- 使用 Texel Snap 抑制相机移动时的阴影抖动；
- 在级联边界建立重叠区并平滑混合；
- 使用 Slope Bias 与 `3×3 PCF` 处理阴影条纹和锯齿；
- Model 与 Terrain 共用同一套阴影接收协议；
- 按级联执行 Bounds 剔除；
- 对模型 Shadow Queue 进行排序和实例化合批；
- 正确处理 Opaque、Mask 与 Blend 三类材质；
- 用非阻塞 GPU Timer 和独立视觉场景完成验证。

这篇文章将从 Shadow Map 的基本原理开始，逐步说明为什么一张阴影图不够，以及 Glimmer 如何把 CSM 接入现有渲染架构。

## Shadow Map 是什么

Shadow Mapping 的核心思想可以概括为一句话：

> 先从光源视角记录场景中最靠近光源的深度，再从相机视角判断当前片元是否位于这个深度之后。

它本质上是一种可见性测试。

![](IMG-20260812170905926.png "从光源方向观察场景，深度图只保存光源首先看到的表面")

Shadow Mapping 一般分为两个阶段。

第一阶段从光源视角绘制场景，只输出深度：

```
World Position
    → Light View
    → Light Projection
    → Depth Texture
```

第二阶段正常渲染场景。对于任意世界空间位置 \(P\)，将其重新变换到光源裁剪空间：

$$
P_{light}=P_{lightProjection}P_{lightView}P
$$

透视除法并映射到 `[0,1]` 后，得到：

- `projected.xy`：Shadow Map 采样坐标；
- `projected.z`：当前片元相对于光源的深度。

然后比较：

```glsl
float closestDepth = texture(shadowMap, projected.xy).r;
float currentDepth = projected.z;

bool occluded = currentDepth > closestDepth;
```

如果当前深度比 Shadow Map 中记录的最近深度更远，就说明光线在到达当前片元之前已经被别的表面挡住，该片元位于阴影中。

这种方法不需要在屏幕空间寻找遮挡物，也不需要为每个像素执行真实的几何求交。它把复杂的可见性问题转化为一次深度纹理查询，因此非常适合光栅化渲染管线。

## 为什么方向光适合正交投影

点光源和聚光灯拥有明确的位置，光线从一个点向外发散，通常使用透视投影描述光源视锥。

方向光不同。

太阳光通常被近似为无限远光源，场景内所有光线方向平行。因此方向光没有真正意义上的投影中心，使用正交投影更符合它的几何特征：

```glsl
lightView = glm::lookAt(lightPosition, cascadeCenter, up);
lightProjection = glm::ortho(
    -radius, radius,
    -radius, radius,
    nearPlane, farPlane);
```

这里的 `lightPosition` 只是为了构造 View Matrix，通常沿光照方向从目标区域退后一定距离。它不表示真实的太阳位置。

在 Glimmer 中，每个方向光级联都使用一个正交投影，将对应的相机子视锥包围起来，然后生成一张纯深度图。

## CSM

但如果只用一张Shadow Map的话，又会有哪些问题呢，设想：

假设使用一张 `2048×2048` 的 Shadow Map 覆盖相机前方 100 米。

当相机靠近地面时，这张纹理既要表现脚边的石块阴影，也要覆盖远处的山体。固定数量的 Texel 被摊到一个很大的世界空间区域上，近景像素可能大量共享同一个 Shadow Texel，于是出现明显的方块和锯齿。

即使把纹理提高到 `4096×4096`，问题也没有从根本上消失。因为真正的矛盾不是纹理“绝对不够大”，而是纹理精度在相机深度方向上的分配不合理：

- 近处物体投影到屏幕上很大，需要更高阴影采样密度；
- 远处物体占据的屏幕像素较少，可以接受更低密度；
- 单张正交 Shadow Map 却对整个覆盖范围采用同一世界空间 Texel 尺寸。

这就是典型的 Perspective Shadow Aliasing。微软的 CSM 文档也指出，近景有时即使使用 `4096×4096` 的单张阴影图仍然不足；CSM 的基本思路正是把相机视锥切成多个子视锥，让每张同分辨率 Shadow Map 只负责一个更小的深度范围。

Cascaded Shadow Maps 将相机视锥沿观察方向分成多个区间，每个区间生成一张独立的方向光 Shadow Map

![](IMG-20260812180820243.png)

每张 Shadow Map 的像素数量可以相同，但覆盖的世界空间范围不同。第一级只覆盖相机附近，因此一个 Texel 对应的世界空间尺寸很小；越远的级联覆盖越大，精度逐渐下降。

这是一种离散的精度重分配：它没有创造更多纹理采样点，而是把已有预算优先分给屏幕上更敏感的近景。

Glimmer 当前支持：

|参数|范围或默认值|作用|
|---|---|---|
|Cascade Count|1～4，默认 4|控制级联数量|
|Shadow Resolution|512～4096，默认 2048|每级深度纹理分辨率|
|Shadow Distance|默认 80|方向光阴影的最远覆盖距离|
|Split Lambda|默认 0.65|均匀分割与对数分割之间的权重|
|Cascade Blend|默认 0.10|相邻级联重叠区比例|
|Shadow Bias|默认 0.0015|深度比较偏移|

这些参数保存在 `DirectionalLightComponent` 中并随 Scene YAML 持久化。Shadow Framebuffer、深度纹理、级联矩阵和运行时队列则完全由渲染器重建，不进入场景文件。

## 整体渲染流程

Glimmer 将 CSM 放在正常 HDR 颜色渲染之前：

```
Scene
  → 找到第一个 Enabled 且 CastShadows 的 Directional Light
  → 准备 Terrain Runtime
  → 计算 Camera Frustum 和 Cascade Split
  → 构造各级 Light View-Projection
  → 逐级生成 Depth32F Shadow Map
      → Model Bounds 剔除
      → Terrain Chunk Bounds 剔除
      → Opaque / Mask Shadow Queue
      → Model Shadow Instancing
  → 恢复 Scene Framebuffer 和 Viewport
  → 正常颜色渲染
      → Opaque Model
      → Terrain
      → Skybox
      → Sprite
      → Transparent
  → PBRModel / Terrain 选择级联
  → 3×3 PCF
  → 级联边界混合
```

Scene 负责从 ECS 中选择主方向光，并枚举 Model 与 Terrain；`ShadowRenderer` 负责阴影资源、级联矩阵、队列、剔除、合批和 Shader 参数绑定。

如果让 `Scene` 自己管理 OpenGL 深度纹理，场景层会逐渐了解 Framebuffer、纹理槽、实例缓冲和 PCF 参数；如果让 `ShadowRenderer` 直接遍历 ECS，它又会与场景存储方式耦合。Glimmer 选择的边界是：

- Scene 知道“哪些实体要提交”；
- ShadowRenderer 知道“怎样形成有效的阴影 Pass”；
- PBRModel 与 Terrain Shader 知道“怎样接收阴影”。

### 创建纯深度 Shadow Framebuffer

Glimmer 为每个级联维护一个 `Depth32F` Framebuffer：

```cpp
FramebufferSpecification specification;
specification.Width = resolution;
specification.Height = resolution;
specification.Attachments = {
    { FramebufferTextureFormat::Depth32F }
};

framebuffer = Framebuffer::Create(specification);
```

这是一个没有颜色附件的 FBO。OpenGL 后端将 Draw Buffer 和 Read Buffer 设为 `GL_NONE`，Shadow Pass 中只执行深度写入。

### 使用 Practical Split 划分视锥

CSM 有几种常见的分割方式，最简单的 CSM 分割方式是均匀切分：

$$
C_i^{uniform}=n+(f-n)\frac{i}{m}
$$

其中：

- $n$ 是 Shadow Near；
- $f$ 是 Shadow Distance；
- $m$ 是级联数量；
- $i$ 是当前分割面序号。

问题在于，相机透视投影的精度需求不是线性的。均匀分割通常会给远处留下过多范围，而近处分辨率仍然不足。

另一种方式是对数分割：

$$
C_i^{log}=n\left(\frac{f}{n}\right)^{i/m}
$$

它会将更多分割面压到相机附近，但在一些场景中近级范围可能过小，难以覆盖足够的投影物。

Practical Split 将两者混合：

$$
C_i=\lambda C_i^{log}+(1-\lambda)C_i^{uniform}
$$

对应到 Glimmer 的核心计算：

```cpp
float ratio = float(index + 1) / float(cascadeCount);

float logarithmic =
    cameraNear * pow(shadowFar / cameraNear, ratio);

float uniform =
    cameraNear + shadowRange * ratio;

float splitDepth =
    mix(uniform, logarithmic, splitLambda);
```

`Split Lambda = 0` 时退化为均匀分割，`Split Lambda = 1` 时变成完全对数分割。Glimmer 默认使用 `0.65`，稍微偏向近景精度，但不会把第一级压得过窄。

NVIDIA 的 PSSM 论文式实现同样采用了 Practical Split，原因正是单独使用均匀或对数切分都难以兼顾近远区域。[NVIDIA GPU Gems 3—The Practical Split Scheme](https://developer.nvidia.com/gpugems/gpugems3/part-ii-light-and-shadows/chapter-10-parallel-split-shadow-maps-programmable-gpus)

![](IMG-20260813174442725.png)

### 从相机子视锥构造方向光矩阵

首先对 Camera View-Projection 求逆，将 NDC 的八个角点还原到世界空间：

```cpp
const glm::mat4 inverseViewProjection =
    glm::inverse(cameraProjection * cameraView);

for each clipCorner in { -1, +1 }³:
    world = inverseViewProjection * clipCorner;
    corner = world.xyz / world.w;
```

然后根据当前级联的 Near/Far Ratio，在完整视锥的四条近远角点连线上插值得到该级的八个角点：

```cpp
range = fullFarCorner - fullNearCorner;

cascadeNearCorner =
    fullNearCorner + range * nearRatio;

cascadeFarCorner =
    fullNearCorner + range * farRatio;
```

接下来计算八个角点的平均中心，并找出能够包围它们的球半径：

```cpp
glm::vec3 center = Average(cascadeCorners);

float radius = 0.0f;
for (const glm::vec3& corner : cascadeCorners)
    radius = max(radius, length(corner - center));
```

Glimmer 将半径向上量化到 `1/16` 世界单位：

```cpp
radius = ceil(radius * 16.0f) / 16.0f;
```

然后用这个半径建立对称正交投影：

```cpp
glm::mat4 lightView = glm::lookAt(
    center - lightDirection * radius * 2.0f,
    center,
    up);

glm::mat4 lightProjection = glm::ortho(
    -radius, radius,
    -radius, radius,
    0.1f, radius * 4.0f);
```

这里没有直接使用紧贴八个角点的 Light-Space AABB，而是使用包围球形成相对稳定的正交范围。

原因是：相机轻微旋转时，紧贴 AABB 的宽高可能持续变化，引起 Shadow Texel 在世界空间中的覆盖尺寸变化。包围球会浪费一部分纹理空间，却让投影范围对相机朝向更加稳定。

## 其它优化

### Shadow Swimming

即使级联范围固定，相机进行亚 Texel 移动时，世界坐标仍会落到不同的 Shadow Texel 上。最终表现就是：场景几何明明没有变化，阴影边缘却随着相机移动产生细碎抖动，也常被称为 Shimmering 或 Shadow Swimming。

在光源裁剪空间中计算投影原点，然后将它对齐到实际阴影纹素网格：

```cpp
glm::vec4 shadowOrigin =
    lightProjection * lightView * vec4(0, 0, 0, 1);

shadowOrigin *= float(resolution) * 0.5f;

glm::vec4 roundedOrigin = round(shadowOrigin);
glm::vec4 roundOffset = roundedOrigin - shadowOrigin;

roundOffset *= 2.0f / float(resolution);

lightProjection[3][0] += roundOffset.x;
lightProjection[3][1] += roundOffset.y;
```

它相当于限制阴影投影只能以一个 Shadow Texel 对应的世界空间步长移动。

经过 Snap 后，相机的小幅运动不会立刻改变 Shadow Map 的采样格点；只有移动跨过一个完整纹素时，投影才会跳到下一格。配合稳定的包围球范围，可以显著降低连续移动中的闪烁。

### 级联边界

如果片元只根据视空间深度选择一张 Shadow Map，那么跨越 Split 时会发生一次瞬间切换。

两级 Shadow Map 的正交范围、Texel 对齐和采样结果不可能完全一致，因此边界位置容易出现一条清晰的明暗断层。

Glimmer 为相邻级联建立重叠区。某个边界的宽度由相邻两个级联中较短的区间决定：

```cpp
blendWidth =
    min(currentCascadeRange, nextCascadeRange)
    * cascadeBlend;
```

构建级联投影时，近级向远处扩展，远级也向近处扩展，从而保证边界附近的世界位置能够被两张 Shadow Map 同时覆盖。

接收阶段，如果片元位于：

$$
[split-width,\ split+width]
$$

就同时采样相邻两个级联：

```glsl
float nearVisibility =
    SampleCascadeVisibility(boundary, worldPosition, normal, lightDirection);

float farVisibility =
    SampleCascadeVisibility(boundary + 1, worldPosition, normal, lightDirection);

float blend =
    smoothstep(split - width, split + width, viewDepth);

return mix(nearVisibility, farVisibility, blend);
```

重叠区外只采样当前级联，因此双倍 PCF 成本仅出现在边界附近。

默认 `Cascade Blend = 0.10`。用于隐藏两套不同采样网格之间的切换。

### Shadow Acne

Shadow Map 的深度是离散的。

当一个倾斜表面的多个屏幕片元投影到同一个 Shadow Texel 时，它们会与相同的最近深度进行比较。一部分片元可能因为浮点误差或深度量化被错误判断为遮挡，形成密集的条纹，即 Shadow Acne。

![](IMG-20260813175816362.png "倾斜表面上的多个片元共享离散深度样本")

固定 Bias 虽然简单，但很难适配所有表面：

- Bias 太小，斜面仍然出现 Acne；
- Bias 太大，阴影与物体底部脱离，产生 Peter Panning。

一种常见的方法是使用Slope Bias，根据表面法线与光照方向的夹角动态调整 Bias：

```glsl
float slopeBias = max(
    u_ShadowBias
        * (1.0 - max(dot(normal, lightDirection), 0.0)),
    u_ShadowBias * 0.25);
```

正对光线的表面使用较小偏移，掠射角表面使用更大偏移。最终比较变为：

```glsl
shadowed =
    projected.z - slopeBias > closestDepth;
```

这并不意味着 Bias 可以无需调试。它仍与场景尺度、法线质量、Shadow Projection 范围和纹理分辨率相关，所以 Glimmer 将 Bias 暴露在 Directional Light Inspector 中，并提供近景视觉验证场景。

### 用 `3×3 PCF` 减轻阴影锯齿

单次深度比较只能得到严格的 0 或 1：

```
Lit 或 Shadowed
```

在有限分辨率下，这会把 Shadow Texel 的网格轮廓直接暴露到最终画面中。

Percentage-Closer Filtering 不直接过滤深度，而是在邻域内执行多次深度比较，再对比较结果求平均。

Glimmer 使用固定的 `3×3 PCF`：

```glsl
float shadow = 0.0;

for (int y = -1; y <= 1; ++y)
{
    for (int x = -1; x <= 1; ++x)
    {
        float closest = SampleCascadeDepth(
            cascadeIndex,
            projected.xy + vec2(x, y) * u_ShadowTexelSize);

        shadow +=
            projected.z - slopeBias > closest ? 1.0 : 0.0;
    }
}

return 1.0 - shadow / 9.0;
```

其中：

$$
ShadowTexelSize=\frac{1}{ShadowResolution}
$$

最终返回的是可见度，而不是阴影值：

- `1.0` 表示完全接受方向光；
- `0.0` 表示完全遮挡；
- 中间值表示 PCF 邻域中只有部分样本通过。

`3×3` PCF 并不模拟真实的半影宽度，但它成本稳定，只需九次深度采样，足以减弱最明显的方块边缘。有关 PCF 的基本原理和邻域比较方式，可参考 [LearnOpenGL 的 PCF 章节](https://learnopengl.com/Advanced-Lighting/Shadows/Shadow-Mapping)。

### 阴影职责分析

目前认为，阴影只应该调制方向光直接照明。
Glimmer 的 PBR Shader 没有把最终颜色整体乘上阴影可见度，而是只调制方向光的直接光贡献：

```glsl
vec3 direction =
    normalize(-u_DirectionalDirectionIntensity.xyz);

vec3 radiance =
    u_DirectionalColor.rgb
    * u_DirectionalDirectionIntensity.w;

float visibility = DirectionalShadowVisibility(
    worldPosition, normal, direction);

result += EvaluateBRDF(
    normal,
    viewDirection,
    direction,
    radiance,
    albedo,
    metallic,
    roughness) * visibility;
```

方向光 Shadow Map 回答的是：“这个位置能否直接看到主方向光？”它不能说明：

- 天空环境光是否被遮挡；
- 点光源是否被遮挡；
- Emissive 是否应该消失；
- IBL 是否应该整体变黑。

因此 Glimmer 中：

- Directional Direct Lighting 乘以 CSM Visibility；
- Point Light 不受这张方向光阴影影响；
- Emissive 不受影响；
- Ambient/IBL 不会被错误清零。

如果未来需要更准确的环境遮蔽，应由 AO、Bent Normal、局部反射探针或其他全局光照技术承担，而不是复用方向光 Shadow Map。

### 透明物体处理

仅仅把模型三角形绘制进深度图，对实体模型通常没有问题，但对树叶、铁丝网和镂空贴图会产生明显错误。

这些模型的透明轮廓往往来自 Base Color Texture 的 Alpha，而几何本身仍然是一张完整矩形。如果 Shadow Pass 不执行 Alpha Test，接收面上就会出现实心矩形阴影。

Glimmer 按材质模式采用三种策略。

#### Opaque

Opaque 材质直接写入 Shadow Map，不需要读取 Base Color Alpha。

#### Mask

Mask 材质进入 Shadow Pass，但使用最终 `MaterialInstance` 的状态执行与颜色 Pass 一致的裁剪：

```glsl
float textureAlpha =
    u_HasBaseColorTexture != 0
    ? texture(
        u_BaseColorTexture,
        v_TexCoord * u_TilingFactor).a
    : 1.0;

float finalAlpha =
    clamp(u_BaseColorAlpha * textureAlpha, 0.0, 1.0);

if (finalAlpha < u_AlphaCutoff)
    discard;
```

因此透明区域不会写入深度图，树叶和网格能够投出正确的镂空阴影。

Scene 提交的不只是 Model Handle，还包括实体的 Material Handle 与 Overrides。ShadowRenderer 通过 `MaterialInstance` 合成最终材质状态，避免阴影 Pass 与颜色 Pass 使用不同的 Alpha、贴图、Tiling 或 Cutoff。

#### Blend

Blend 材质默认不参与方向光 Shadow Pass。

原因不是实现遗漏，而是明确的渲染策略：半透明表面没有唯一正确的二值深度。让普通 Depth-only Shadow Map 接收它，只会得到与透明度无关的实心阴影。

若未来需要玻璃透射、彩色阴影或树叶的随机抖动投影，应设计单独的 Transparent Shadow 方案，例如：

- Stochastic Alpha Test；
- Colored Transmittance Map；
- 多层透射率累积；
- Deep Shadow Map。

这些能力不应悄悄混入当前的二值 CSM 深度协议。

### 投影物剔除

四级 CSM 意味着场景几何最坏可能被重复提交四次。

如果每一级都无条件遍历并绘制所有 Model 和 Terrain，Shadow Pass 的 CPU 提交与 GPU 顶点成本会迅速放大。

Glimmer 为 Mesh 缓存局部 AABB。提交时，将 Bounds 的八个角点通过实体 Transform 和当前 Light VP 变换到裁剪空间：

```
Local AABB
    → Model Transform
    → Light View-Projection
    → Clip Space
```

只有八个角点全部落在同一个裁剪平面外，才判定为完全不可见。

这是保守剔除：它可能保留少量实际上不相交的包围盒，但不会错误删除潜在投影物。对于阴影系统而言，漏剔除只会损失性能；错误剔除则会造成突然消失的阴影，后者更加不可接受。

### Shadow Queue 与实例化合批

通过级联剔除的 Model 子网格不会立即 Draw，而是先进入当前级联的 Shadow Queue。

Queue 按 Mesh 和最终 Alpha Mask 状态排序：

- Opaque：Mesh 相同即可合批；
- Mask：除 Mesh 外，Base Color Texture、Base Alpha、Alpha Cutoff 和 Tiling Factor 也必须一致。

兼容项的 Transform 被写入 ShadowRenderer 自己的动态 Instance Buffer：

```cpp
RenderCommand::DrawIndexedInstanced(
    shadowVertexArray,
    static_cast<uint32_t>(instanceTransforms.size()),
    mesh->GetIndexCount());
```

单次批次最多上传 1024 个实例，超过后分块提交。只有一个实例的批次会回退为普通 Draw。

## Debug 选项

### 运行时级联可视化

CSM 最麻烦的问题之一，是错误常常只在某些相机深度、光照角度或级联边界出现。仅观察最终阴影，很难判断问题究竟来自什么地方。

因此才Debug面板实现`Visualize Cascades`：

```
Cascade 0 → 红
Cascade 1 → 绿
Cascade 2 → 蓝
Cascade 3 → 黄
```

重叠区会按真实的 `smoothstep` 权重渐变，而不是显示一个伪造的调试边界。

![](cover_745aefd8.png)

该开关是纯运行时状态，不写入 Scene YAML，也不会改变深度图、透明度或 Entity ID。

### 非阻塞 GPU 计时

CSM 的成本不能只靠 Draw Call 数量估算。

分辨率增加会显著提高 Raster 和 Depth 带宽；级联增加会重复执行剔除、顶点处理和深度写入；同样的 Draw Call 数，在 `1024²` 与 `4096²` 下可能拥有完全不同的耗时。

Glimmer 使用四槽轮转的 OpenGL `GL_TIME_ELAPSED` Query：

```
BeginDirectional
    → Begin GPU Timer
    → Cascade 0
    → Cascade 1
    → Cascade 2
    → Cascade 3
    → End GPU Timer
EndDirectional
```

查询结果只有在 `GL_QUERY_RESULT_AVAILABLE` 为真时才读取。调试 UI 不会为了显示最新毫秒数强制等待 GPU。

同时，每个有效结果带有单调递增的 Sample ID。Benchmark 只在 Sample ID 变化时收集一次数据，从而避免把面板中缓存的上一帧结果重复计入平均值。