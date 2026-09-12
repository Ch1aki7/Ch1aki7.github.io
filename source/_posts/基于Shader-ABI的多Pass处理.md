---
title: 基于Shader-ABI的多Pass处理
cover: cover_c218b63.gif
top_img: false
toc: true
aside: true
categories: 游戏引擎
tags:
  - 引擎开发
  - 渲染原理
description: 为 Glimmer 建立稳定的 Shader ABI，将材质扩展为可排序、可合批的多 Pass 描述，并在同一契约上实现可热重载的自定义后处理栈。
keywords: Glimmer, Shader ABI, Multi Pass, Material Pass, 渲染队列, 后处理, Ping-Pong, OpenGL
abbrlink: c218b63
date: 2026-09-12 20:47:49
updated: 2026-09-12 20:47:49
---

![](cover_c218b63.gif "简便实现后处理效果")

Glimmer 的 PBR、CSM、IBL、实体拾取和 GPU Instancing 逐步接入以后，`PBRModel.glsl` 也越来越像一个不能轻易触碰的总入口。新增一种表面表现时，要么继续往同一份 Shader 中叠分支，要么复制整份 PBR Shader，再手动维护顶点属性、光照 Uniform、阴影资源、材质纹理和 EntityID 输出。

后一种方式短期很快，长期却会产生两个问题。

第一，Shader 与引擎之间存在大量隐式约定。`a_InstanceTransform` 放在哪个 Location、EntityID 写到哪个颜色附件、相机与光照使用什么名字，只要有一项不一致，Shader 可能仍能通过编译，却无法正确参与实例化、阴影或编辑器拾取。

第二，“一个材质只对应一个 Shader、一次 Draw”已经不够表达轮廓、描边、壳层等效果。以法线外扩描边为例，同一个 Mesh 至少要先绘制外扩后的背面壳层，再绘制原表面。两个阶段使用不同 Shader 和 Cull 状态，也必须拥有确定的执行顺序。

主流引擎已经把这两部分拆开。

Unity 的 ShaderLab `Pass` 可以分别声明 Shader 程序与 Cull、ZWrite 等渲染状态，URP 再通过 `LightMode` 决定 Pass 参与 Forward、GBuffer、ShadowCaster 或 DepthOnly 等管线阶段。具体可见 [Unity ShaderLab Pass](https://docs.unity3d.com/cn/current/Manual/SL-SubShader-pass.html)、[URP ShaderLab Pass Tags](https://docs.unity3d.com/cn/Packages/com.unity.render-pipelines.universal%4012.1/manual/urp-shaders/urp-shaderlab-pass-tags.html) 

Unreal Engine 则由 `FMeshPassProcessor` 完成 Draw 过滤、Shader 选择、Pipeline State 与 Binding 收集，最终生成可缓存、可排序的 Mesh Draw Command。[Unreal Engine Mesh Drawing Pipeline](https://dev.epicgames.com/documentation/en-us/unreal-engine/mesh-drawing-pipeline-in-unreal-engine)

两者的实现方式不同，但边界很相似：

> 材质负责描述“想画什么”，渲染器负责决定“何时画、用什么状态画，以及能否和相邻 Draw 合并”。

## Shader ABI 是什么

这里的 ABI 借用了 Application Binary Interface 的说法，但它并不是 GPU 驱动层面的二进制 ABI。更准确地说，它是一份由 GLSL Include 固化的 **Shader 接口契约**：引擎保证上传这些顶点属性、Uniform 和纹理，Shader 保证从约定的位置读取输入，并向约定的附件写出结果。

当前模型 Shader 被拆成四组公共 Include：

| Include | 负责内容 |
| --- | --- |
| `ModelVertexABI.glslinc` | 模型顶点属性、实例 Transform、EntityID、ViewProjection 与标准顶点输出 |
| `ForwardFragmentABI.glslinc` | HDR Color、EntityID、材质纹理、灯光 UBO、阴影与 IBL 资源声明 |
| `Surface.glslinc` | BaseColor、Normal、AO、Emissive、AlphaMode 的统一解析与输出 |
| `ShadowCSM.glslinc` | CSM 级联选择、PCF、级联过渡和调试色 |

### 顶点阶段契约

`ModelVertexABI.glslinc` 固定了普通 Draw 与 Instanced Draw 共用的输入布局：

```glsl
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec3 a_Tangent;
layout(location = 3) in vec2 a_TexCoord;
layout(location = 4) in mat4 a_InstanceTransform;
layout(location = 8) in ivec4 a_InstanceEntityData;

uniform mat4 u_ViewProjection;
uniform mat4 u_Transform;
uniform int u_EntityID;
uniform int u_UseInstancing;
```

自定义 Shader 不需要自己判断当前是否走实例化，只需调用 ABI 提供的函数：

```glsl
void main()
{
    GlimmerWriteModelVertex(
        a_Position,
        a_Normal,
        a_Tangent,
        a_TexCoord);
}
```

`GlimmerModelTransform()` 会在 `u_UseInstancing` 开启时读取实例矩阵，否则使用普通 `u_Transform`；`GlimmerModelEntityID()` 同样在实例数据和普通 Uniform 之间切换。这样，PBR、Toon 和之后的模型 Shader 不再各自复制这段分支。

片元 ABI 则固定两个输出：线性 HDR Color 写入 Location 0，EntityID 写入整数附件 Location 1。自定义 Shader 只要沿用这个出口，编辑器拾取便不会因为换了一种表面着色方式而失效。

### Include 与热重载

为了让 ABI 真正可用，OpenGL Shader Loader 增加了递归 `#include` 解析：

- `#include "..."` 相对当前文件解析，适合 Shader 自己的局部模块；
- `#include <Glimmer/...>` 相对主 Shader 所在的 Shader Root 解析，适合引擎公共 ABI；
- 递归 Include 会检测循环依赖，并记录全部依赖文件；
- 主文件或任一 Include 变化后都会触发热重载。

热重载采用先构建、后替换的方式。新的 Program 只有在所有 Stage 编译并完成 Link 后才替换旧 Program；编译失败时保留上一个可用版本。调试 ABI 时即使写错一个公共 Include，Viewport 也不会立刻变成完全不可用的黑屏。

ABI 带来的直接收益是：公共输入只维护一次，自定义 Shader 只描述差异。它同时也是一条能力边界，如果 Shader 不包含模型 ABI，或者修改了约定的 Location 与输出，就不能默认享受实例化、EntityID、阴影和统一材质绑定。

## 材质从单 Shader 扩展为 Pass 列表

只有 Shader 接口还不够。多 Pass 的 Shader、顺序与 GPU 状态需要进入材质资产，因此 `MaterialState` 增加了 `std::vector<MaterialPass>`：

```cpp
struct MaterialPass
{
    std::string Name = "Forward";
    AssetHandle ShaderHandle{ 0 };
    int32_t Order = 100;
    CullMode Cull = CullMode::None;
    bool DepthWrite = true;
    MaterialPassQueue Queue = MaterialPassQueue::Material;
    std::map<std::string, float> FloatParameters;
    std::map<std::string, std::array<float, 4>> Float4Parameters;
};
```

各字段的职责保持得比较克制：

| 字段 | 作用 |
| --- | --- |
| `Name` | 调试和编辑器展示使用的 Pass 名称 |
| `ShaderHandle` | 当前 Pass 使用的 Shader 资产 |
| `Order` | 不透明队列中的阶段顺序，数值越小越先执行 |
| `Cull` | `None`、`Back` 或 `Front` |
| `DepthWrite` | 不透明 Pass 是否写入深度 |
| `Queue` | 跟随材质 AlphaMode，或强制进入 Opaque 队列 |
| `Parameters` | 当前支持 Float 与 Float4，作为 Pass 私有 Uniform |

一个 Toon 材质可以直接在 `.glmat` 中声明两个 Pass：

```yaml
Passes:
  - Name: Outline
    Shader: 17101010101010101001
    Order: 0
    Cull: Front
    DepthWrite: true
    Queue: Opaque
    Parameters:
      u_OutlineWidth: 0.025
      u_OutlineColor: [0.025, 0.02, 0.04, 1]

  - Name: Forward
    Shader: 17101010101010101002
    Order: 100
    Cull: Back
    DepthWrite: true
    Queue: Material
    Parameters:
      u_ToonShadowThreshold: 0.2
      u_ToonLightThreshold: 0.72
      u_ToonRimStrength: 0.18
```

读取资产时，Pass 会按 `Order` 稳定排序；保存、Reload、材质 Undo 和版本比较都包含完整 Pass 列表。没有声明 `Passes` 的旧材质不会失效，Renderer 会根据原来的 `ShaderHandle` 合成一个默认 Legacy Forward Pass，继续走单 Pass 路径。

实体上的 `MaterialOverrides` 仍只覆盖 BaseColor、Metallic、Roughness 等表面参数，不覆盖共享材质的 Pass 拓扑。这样同一材质的实体可以拥有不同表面数值，但不会因为某个实体临时修改了 Pass 顺序而打破资产语义和批处理条件。

## 从 Pass 描述到渲染队列

材质变成 Pass 列表后，`SubmitModel` 不再为每个 Mesh 只生成一个 `RenderItem`，而是将 Mesh 与有效 Pass 做笛卡尔展开：

```text
Model
  -> Mesh 0 × Pass 0
  -> Mesh 0 × Pass 1
  -> Mesh 1 × Pass 0
  -> Mesh 1 × Pass 1
  -> ...
```

如果一个模型含有 `M` 个 Mesh，材质含有 `P` 个有效 Pass，那么理论上会提交 `M × P` 个 RenderItem。多 Pass 的成本因此非常直接：每增加一个 Pass，就意味着额外的几何处理和 Draw 候选，它不是免费的 Shader 组织方式。

### Queue 的判定

`Queue: Material` 表示跟随基础材质的 `AlphaMode`：Opaque 与 Mask 进入不透明队列，Blend 进入透明队列。`Queue: Opaque` 则强制当前 Pass 留在不透明阶段。

这个覆盖对外扩轮廓很重要。即使表面材质以后使用 Blend，Outline 壳层仍可以先在不透明阶段写入稳定的颜色与深度，而不是被透明物体的远近排序拆散。

透明队列仍遵循原有规则：按实体 Transform 原点到相机的距离从远到近稳定排序，启用 Alpha Blend，保留深度测试并强制关闭深度写入。`MaterialPass::DepthWrite` 只对不透明 Pass 生效。

### 排序、合批与状态恢复

不透明队列的排序键现在以 Pass 为第一层：

```text
Pass Order
  -> Pass Sequence
  -> Shader
  -> Material
  -> Textures
  -> Mesh
  -> Final Material State
  -> EntityID
```

先按 `Order` 排序保证 Outline 之类的阶段语义，再在同一阶段内按 Shader、Material、Texture 和 Mesh 聚合，尽量减少状态切换。相邻 RenderItem 只有在 Shader、Mesh、全部纹理、最终材质属性、纹理存在标记以及完整 `MaterialPass` 都一致时才能形成兼容 Batch。

兼容 Batch 大于一个实例且 Shader 满足实例化 ABI 时，Renderer 继续上传最多 1024 项的 Instance Buffer，并调用 `DrawIndexedInstanced`。Pass 参数或 GPU 状态不同会自然拆批；这比只比较 Shader Handle 更保守，但不会错误地把不同轮廓宽度或 Cull 状态合并到一次 Draw 中。

每个 Draw 前显式应用当前 Pass 的 Cull 与 DepthWrite，Opaque、Transparent 队列结束后再恢复默认 Cull、DepthWrite、Blend 和 DepthFunc。状态恢复是多 Pass 中容易被忽略的一步：如果依赖 OpenGL 上一次 Draw 留下的全局状态，一个 Outline Pass 的 Front Cull 很可能污染后续 PBR、Terrain 或 Skybox。

## 用法线外扩验证模型多 Pass

法线外扩很适合验证这套链路，因为它同时覆盖了顶点变形、两次几何绘制、不同 Cull 状态、Pass 顺序、参数上传和 EntityID 输出。

Outline Pass 先把顶点沿世界空间法线推出一段距离：

```glsl
mat4 transform = GlimmerModelTransform();
vec4 worldPosition = transform * vec4(a_Position, 1.0);
vec3 worldNormal = normalize(
    transpose(inverse(mat3(transform))) * a_Normal);

worldPosition.xyz += worldNormal * max(u_OutlineWidth, 0.0);
gl_Position = u_ViewProjection * worldPosition;
```

该 Pass 使用 `Cull: Front`，因此只留下外扩模型的背面壳层；随后 Forward Pass 使用 `Cull: Back` 绘制原表面。壳层从模型边缘露出的部分就成为轮廓。

![](IMG-20260912205721209.png "法线外扩 Outline Pass 与 Toon Surface Pass 的组合效果")

两个 Pass 都通过 Forward Fragment ABI 写出同一个 EntityID，所以点击轮廓仍然会选中原实体。Shadow Renderer 则没有展开材质的颜色 Pass，而是继续按基础材质的 Opaque、Mask、Blend 规则提交原始模型一次。这样 Outline 不会被重复写入四张级联阴影图，调整轮廓宽度也不会改变物体的阴影体积。

这也是“材质 Pass”与“完整渲染图”之间的边界：当前 Pass 列表只控制模型颜色阶段，不会自动复制到 Shadow、Depth Prepass 或其他管线阶段。若将来需要让自定义 Pass 参与这些阶段，应增加明确的 Pass Type 或 Pipeline Tag，而不是默认在所有阶段重复执行。

## 将相同思路延伸到后处理

模型 Shader 的 ABI 解决了几何阶段的接入问题，但自定义后处理仍然需要复制整份 `ToneMapping.glsl`。这样不仅会重复 Exposure、ACES 与 Gamma 逻辑，还容易把效果放到错误的颜色空间中。

Glimmer 因此为全屏 Shader 建立了独立的 `PostProcessABI.glslinc`。新建后处理 Shader 时只需实现一个函数：

```glsl
#type vertex
#version 450 core
#include <Glimmer/PostProcessVertexABI.glslinc>

#type fragment
#version 450 core
#include <Glimmer/PostProcessABI.glslinc>

vec4 GlimmerPostProcess(GlimmerPostProcessInput inputData)
{
    return inputData.SceneColor;
}
```

公共 ABI 负责构造 `GlimmerPostProcessInput`：

| 字段 | 含义 |
| --- | --- |
| `UV` | 当前屏幕 UV |
| `Resolution` | 实际 Viewport 后处理尺寸 |
| `TexelSize` | 单像素 UV 尺寸，即 `1 / Resolution` |
| `Time` | 引擎运行时间 |
| `SceneColor` | 当前 Pass 输入的线性 HDR 颜色 |
| `SceneDepth` | 原始 Scene Depth |
| `HasCamera` | 当前是否有有效相机 |
| `CameraPosition` | 相机世界位置 |
| `InverseViewProjection` | 用于从深度重建世界坐标 |

同时提供三个辅助函数：

```glsl
vec4 GlimmerSampleScene(vec2 uv);
float GlimmerSampleDepth(vec2 uv);
vec3 GlimmerReconstructWorldPosition(vec2 uv, float depth);
```

`SceneColor` 是上一个自定义 Pass 的结果，`SceneDepth` 则始终来自原始 Scene Framebuffer。也就是说，颜色会在链中逐级传递，深度不会被前一个效果改写。这对 Depth Outline、距离雾或屏幕空间遮罩十分重要。

### Ping-Pong Pass 栈

在 Content Browser 中创建 `Post Process Shader (.glsl)` 后，可以将文件拖入 `Settings -> Custom Post Process`。列表支持启用、关闭、上移、下移与移除；移除只改变当前运行栈，不会删除磁盘 Shader 文件。

执行顺序固定为：

```text
Scene RGBA16F Color + Scene Depth
  -> Custom Pass 0
  -> Custom Pass 1
  -> ...
  -> Bloom Extract / Blur
  -> Fog
  -> Exposure EV
  -> ACES Filmic
  -> Gamma Encoding
  -> RGBA8 Display Texture
```

每个启用的自定义 Pass 从上一张颜色纹理采样，并写入另一张全分辨率 `RGBA16F` Framebuffer。两个目标按已执行 Pass 数量交替使用，形成 Ping-Pong：

```cpp
uint32_t resolvedSceneColor = input.SceneColorTexture;
uint32_t executedCustomPasses = 0;

for (size_t index = 0; index < customPasses.size(); ++index)
{
    if (!customPasses[index].Enabled)
        continue;

    uint32_t targetIndex = executedCustomPasses % 2u;
    DrawFullscreen(resolvedSceneColor, customFBO[targetIndex]);
    resolvedSceneColor = customFBO[targetIndex]->GetColorTexture();
    ++executedCustomPasses;
}
```

这里按“实际执行数”而不是列表索引选择目标，禁用中间 Pass 后仍能正确交替。两张 Custom FBO 只在加入首个自定义 Pass 时创建，最后一个 Pass 被移除后释放，并始终跟随 Viewport 使用完整分辨率。

自定义链放在 Tone Mapping 之前，因此读取和写出的都是线性 HDR 颜色。它可以修改大于 `1.0` 的高光，结果也会自然参与后续 Bloom 提取。相反，如果 Pixelate 放在 Tone Mapping 之后，虽然资源成本可能更低，却无法以相同方式影响 Bloom，而且必须明确处理显示空间 Gamma。当前阶段选择固定的 HDR 注入点，先保证颜色链语义唯一。

Unity URP 的 Full Screen Pass Renderer Feature 和 Unreal Post Process Material 都允许在指定阶段插入全屏效果；前者还可以声明 Depth、Normal、Color、Motion 等输入需求，后者提供 Before Tonemapping 等 Blendable Location。Glimmer 当前的实现相当于一个固定在 Tone Mapping 前、仅提供 Color 与 Depth 的轻量版本。可参考 [Unity Full Screen Pass Renderer Feature](https://docs.unity3d.com/cn/6000.0/Manual/urp/renderer-features/renderer-feature-full-screen-pass.html) 与 [Unreal Engine Post Process Materials](https://dev.epicgames.com/documentation/unreal-engine/post-process-materials-in-unreal-engine)。

## 六个后处理示例

示例 Shader 都只实现效果本身，用于确认 Resolution、TexelSize、Time、SceneColor 与 SceneDepth 能够在任意组合顺序下工作。

### Pixelate

Pixelate 先用真实 Viewport 尺寸计算像素网格，再把 UV 对齐到每个格子的中心：

```glsl
const float pixelSize = 6.0;
vec2 pixelGrid = max(inputData.Resolution / pixelSize, vec2(1.0));
vec2 pixelUV =
    (floor(inputData.UV * pixelGrid) + 0.5) / pixelGrid;
return GlimmerSampleScene(pixelUV);
```

使用 `Resolution` 而不是写死宽高后，Viewport 缩放时像素块仍保持稳定的屏幕尺寸。

![](IMG-20260912210010300.png "Pixelate：按屏幕像素网格量化 UV")

### Vignette

Vignette 将 UV 移到屏幕中心，并用宽高比修正 X 方向，再根据中心距离平滑压暗边缘。如果忽略 Aspect Ratio，非正方形 Viewport 中的暗角会被拉成椭圆。

![](IMG-20260912210033515.png "Vignette：按宽高比修正后的径向暗角")

### Chromatic Aberration

色差效果沿屏幕中心到当前像素的方向偏移红、蓝通道，绿色保留中心采样。偏移量以 `TexelSize` 表示，因此参数含义是接近固定像素距离，而不是随分辨率变化的固定 UV 距离。

![](IMG-20260912210100641.png "Chromatic Aberration：红蓝通道沿径向错位")

### Wave Distortion

Wave Distortion 使用 `Time` 驱动横纵两个正弦波，再将位移换算为 Texel。它同时验证了动态 Uniform、邻域采样与连续热重载。

![](cover_c218b63.gif "Wave Distortion：由 Time 驱动的二维波纹扭曲")

### Depth Outline

Depth Outline 与前面的法线外扩不是同一种描边。它不再次绘制 Mesh，而是在全屏阶段比较中心深度与上下左右四个邻居的深度差：

```glsl
float centerDepth = inputData.SceneDepth;
float depthDifference = 0.0;

depthDifference = max(depthDifference, abs(
    centerDepth - GlimmerSampleDepth(
        inputData.UV + vec2(inputData.TexelSize.x, 0.0))));
// 继续采样左、上、下三个方向

float outline = smoothstep(0.0004, 0.0025, depthDifference);
```

它能覆盖场景中所有产生深度的物体，成本与屏幕分辨率相关，不需要额外绘制几何；但它只能看到深度不连续的边界，无法像法线外扩那样稳定控制单个材质的轮廓宽度，也看不到深度连续但法线突变的内部边缘。

![](IMG-20260912210149835.png "Depth Outline：基于 Scene Depth 四邻域差分的屏幕空间描边")

### Film Grain

Film Grain 以屏幕像素坐标和离散到 24 FPS 的时间作为噪声种子，再根据当前亮度调整颗粒强度。暗部颗粒稍强、亮部稍弱，并且不依赖额外噪声纹理。

![](IMG-20260912210231550.png "Film Grain：随时间变化并按亮度调制的颗粒")

## 小结

这次实现建立的是一套可以继续扩展的框架，还不是完整的 ShaderLab 或 Render Graph。

```text
Shader ABI
  -> 规定引擎与 Shader 如何交换输入、资源与输出

Material Pass
  -> 描述 Shader、顺序、队列、GPU 状态与局部参数

Renderer Queue
  -> 展开 RenderItem，完成排序、合批、绘制与状态恢复
```

模型侧用这套结构完成了法线外扩 Outline 与 Toon Surface 的组合，后处理侧则通过独立 ABI 和两张 HDR Ping-Pong Framebuffer 得到了可排序、可热重载的实时 Pass 栈。之后新增 Shader 时，重点可以回到效果本身，而不再反复复制整套引擎绑定代码。

Pixelate、Vignette、色差、颗粒和简单深度描边已经适合放入这条链路；TAA、运动模糊和 SSR 则不能只靠再写一个片元函数解决，它们还需要 Motion Vector、历史缓冲、法线或更完整的资源生命周期。


