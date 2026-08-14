---
title: HDR 线性渲染链与IBL
cover: cover_508162ef.png
top_img: false
toc: true
aside: true
abbrlink: 508162ef
date: 2026-08-14 13:20:02
update: 2026-08-14 13:20:02
categories: 游戏引擎
tags:
  - 引擎开发
  - 渲染原理
description: 在Glimmer中探讨HDR和光照IBL原理以及应用。
keywords:
katex: true
---
![](cover_508162ef.png "降低曝光后的表现")

## 什么是HDR/HDRI

HDR（High Dynamic Range，高动态范围）指的是**能够表示比普通图像更宽亮度范围的数据或技术**。

在游戏引擎和渲染中，可以简单理解为：

> **HDR 允许颜色亮度超过普通 `[0, 1]` 范围，从而保存真实世界中从暗处到强光的巨大亮度差异。**

而PBR Shader 计算的是线性辐射亮度。点光源、金属高光、太阳和 HDR 环境中的高亮区域都可能产生大于 `1.0` 的颜色：

```glsl
vec3 radiance = lightColor * intensity;
vec3 result = EvaluateBRDF(...) * radiance;
```

如果直接把结果写入普通 `RGBA8` Framebuffer，GPU 会在写入时把每个通道限制到 `[0,1]`。普通白色 `vec3(1.0)` 和极亮高光 `vec3(20.0)` 最终都会变成相同的白色。

高亮信息一旦在场景阶段被裁掉，后续便无法正确完成Tone Mapping、曝光控制、Bloom 高亮提取、HDR Skybox、基于真实环境亮度的 IBL、高光与普通白色之间的层次恢复等工作。

HDRI（High Dynamic Range Image，高动态范围图像）是**保存高动态范围亮度信息的图像**。

在游戏引擎里，HDRI 通常特指一张 **360° 全景 HDR 环境图**，保存了真实的**亮度信息**。

### 曝光与 Tone Mapping

HDR 颜色不能直接显示在普通屏幕上。Glimmer 在固定的 Tone Mapping Pass 中先应用摄影式曝光：

$$
ExposureMultiplier=2^{EV}
$$

对应代码：

```glsl
float exposureMultiplier = exp2(u_ExposureEV);
vec3 hdrColor = max(sceneColor.rgb, vec3(0.0))
    * exposureMultiplier;
```

这意味着：

|Exposure EV|线性倍率|
|---|---|
|-2|0.25|
|-1|0.5|
|0|1|
|+1|2|
|+2|4|

灯光 Intensity 描述场景中的照明能量，Exposure 描述观察和显示映射。

曝光后进入 ACES Filmic 近似曲线：

```glsl
vec3 mappedColor =
    ACESFilm(hdrColor)
    / ACESFilm(vec3(u_ACESWhitePoint)).r;
```

最后只执行一次 Gamma Encoding：

```glsl
vec3 displayColor =
    pow(mappedColor, vec3(1.0 / 2.2));
```

“HDR”在这里包含两层含义。

第一层是 HDR Scene Buffer：渲染结果使用浮点颜色附件，允许颜色超过 `1.0`。

第二层是 HDR Environment Map：环境贴图本身保存具有较大亮度范围的线性辐射数据。

普通 JPG 天空盒虽然可以作为可见背景，却不能准确描述环境中的光照能量。太阳、天空和背光地面可能都被压缩在 `[0,1]` 内，IBL 卷积之后只能得到视觉颜色的模糊版本，而不是有意义的环境照明。

Radiance `.hdr` 文件可以保存超过 `1.0` 的环境亮度。下面是一张典型的等距柱状 HDR 环境图：

![](IMG-20260814135215650.png)

Glimmer 使用 `stbi_loadf` 读取 `.hdr`，得到线性浮点数据：

```cpp
float* pixels = stbi_loadf(
    path.string().c_str(),
    &width,
    &height,
    &channels,
    STBI_rgb_alpha);
```

HDR 像素在读取后：

- 不被压缩到 `[0,1]`；
- 不执行 sRGB 解码；
- 在 CPU 中以 RGBA Float 处理；
- 上传 GPU 时保存为线性 `RGBA16F`。

因为 HDR 数据本身已经表示线性辐射亮度，再执行一次 sRGB 解码反而会破坏原始能量关系。

### CPU 端生成六面 Cubemap

对 Cubemap 的每个面和每个像素，先根据面方向得到三维采样向量：

```cpp
glm::vec3 EnvironmentMapLoader::CubemapDirection(
    TextureCubeFace face,
    float x,
    float y)
{
    switch (face)
    {
    case TextureCubeFace::PositiveX:
        return normalize(vec3(1.0f, -y, -x));

    case TextureCubeFace::NegativeX:
        return normalize(vec3(-1.0f, -y, x));

    case TextureCubeFace::PositiveY:
        return normalize(vec3(x, 1.0f, y));

    // -Y / +Z / -Z...
    }
}
```

然后使用该方向双线性采样等距柱状 HDR：

```cpp
glm::vec4 sample = SampleEquirectangular(
    source,
    CubemapDirection(face, coordinateX, coordinateY));
```

最终得到：

```
Equirectangular HDR
    → FloatImageData
    → +X / -X / +Y / -Y / +Z / -Z
    → CubemapFloatData
    → TextureCube RGBA16F
```

这种做法没有临时 Capture FBO，也不依赖 OpenGL 渲染上下文中的六次 Capture Pass。环境转换算法位于引擎核心的 `EnvironmentMapLoader`，OpenGL 后端只负责纹理存储和上传。

代价是首次导入和派生计算发生在 CPU，但当前环境分辨率和生成频率可控，并且能够被缓存。对于 Glimmer 当前的编辑器资源链，这种确定性更有利于自动测试。

转换后的 Cubemap 可以直接作为可见天空盒：

![](IMG-20260814135402052.png "等距柱状环境转换为 Cubemap 后作为 Skybox")

### Mip Chain

Cubemap 创建完成后，Glimmer 会生成完整 Mip Chain：

$$
MipLevels=\lfloor\log_2(FaceSize)\rfloor+1
$$

例如 `512×512` 的 Cubemap 最终包含：

```
512 → 256 → 128 → 64 → 32 → 16 → 8 → 4 → 2 → 1
```

这条普通 Mip Chain 用于：

- Trilinear 天空盒采样；
- 减少远距离或低频读取时的闪烁；
- 为 TextureCube 建立完整的跨 API Mip 接口。

但普通 Mip 只是颜色下采样，它不理解 GGX 分布，也不知道材质 Roughness。真正的 IBL 镜面反射需要根据不同 Roughness 对环境进行专用卷积。

最后可以得到带完整 Mip Chain 的 TextureCube，将.hdr文件直接拖入场景中来作为天空盒。

## 用 Irradiance Cubemap 实现环境漫反射

将 HDR Cubemap 绘制为 Skybox，只解决了背景视觉的问题。

模型依然可能只接受 Directional Light 和 Point Light。关闭这些直接光后，即使周围天空非常明亮，模型也会接近黑色。

这是因为可见背景和表面照明是两条不同的数据流：

```
Skybox
    → 根据相机视线方向采样环境
    → 得到背景颜色

Diffuse IBL
    → 根据表面法线对整个半球积分
    → 得到环境漫反射
```

某个表面的颜色不是只由法线方向上的一个环境像素决定，而是由法线所在半球内所有入射方向共同决定。

### 得到漫反射

PBR 反射方程可以写成：

$$
L_o(p,\omega_o)= \int_\Omega f_r(p,\omega_i,\omega_o) L_i(p,\omega_i) (n\cdot\omega_i) d\omega_i
$$

其中：

- $L_o$ 是表面沿观察方向输出的辐射亮度；
- $L_i$ 是环境从方向 $\omega_i$ 入射的辐射；
- $f_r$ 是 BRDF；
- $n\cdot\omega_i$ 表示入射方向与表面法线的夹角权重。

把 BRDF 分成 Diffuse 和 Specular 后，漫反射部分为：

$$
L_o^{diffuse}= k_d\frac{albedo}{\pi} \int_\Omega L_i(\omega_i) \max(n\cdot\omega_i,0) d\omega_i
$$

其中环境相关的部分只有：

$$
E(n)= \int_\Omega L_i(\omega_i) \max(n\cdot\omega_i,0) d\omega_i
$$

$E(n)$ 就是 Irradiance。

它只依赖表面法线方向，因此可以提前为所有方向计算，并保存为一张新的 Cubemap。

![](IMG-20260814145851844.png "以输出方向为法线，对对应半球中的环境辐射进行卷积")

```glsl
vec3 irradiance =
    texture(u_DiffuseIrradianceMap, normal).rgb;
```

且环境漫反射是一个典型低频信号。

Lambert 漫反射会把整个法线半球中的光照混合起来。太阳这种原本非常尖锐的高亮，在半球积分后也会扩散为较平滑的亮度变化。

![](IMG-20260814150000506.png "原始环境与低频 Irradiance Map")

### 半球采样

使用确定性的 Hammersley 序列生成余弦加权样本：

```cpp
float sequenceX =
    (float(sample) + 0.5f) / float(sampleCount);

float sequenceY =
    RadicalInverse(sample);

float phi = 2.0f * Pi * sequenceX;
float sinTheta = sqrt(sequenceY);
float cosTheta = sqrt(1.0f - sequenceY);
```

得到局部半球方向后，再通过当前法线的切线坐标系转换到世界方向：

```cpp
glm::vec3 sampleDirection = glm::normalize(
    tangent   * local.x +
    bitangent * local.y +
    normal    * local.z);
```

然后查询 HDR Cubemap：

```cpp
accumulated += glm::vec3(
    SampleCubemap(source, sampleDirection));
```

余弦重要性采样会把更多样本分布在法线附近。考虑采样概率密度后，最终积分可以简化为：

```cpp
glm::vec3 irradiance =
    accumulated * (Pi / float(sampleCount));
```

### 在 PBR 中使用

Irradiance Map 保存的是环境入射光积分。运行时还要乘上 Lambert 漫反射、材质颜色和能量分配：

```glsl
vec3 F = FresnelSchlickRoughness(
    max(dot(normal, viewDirection), 0.0),
    F0,
    roughness);

vec3 diffuseWeight =
    (vec3(1.0) - F) * (1.0 - metallic);

vec3 irradiance =
    texture(u_DiffuseIrradianceMap, normal).rgb;

vec3 diffuseIBL =
    diffuseWeight
    * albedo
    * irradiance
    / PI;

diffuseIBL *= ao * u_SkyLightIntensity;
```

这里的几个因子分别表示：

- `1 - F`：没有进入镜面反射的能量；
- `1 - metallic`：金属不产生普通介质漫反射；
- `albedo / π`：Lambert BRDF；
- `ao`：环境遮蔽；
- `SkyLightIntensity`：环境光强度。

因此，非金属表面会获得柔和的环境颜色，金属表面的能量则主要交给 Specular IBL。

### 缓存与绑定

Irradiance 不会每帧重新计算。Glimmer 使用以下信息组成缓存键：

```
Cubemap AssetHandle
+ Cubemap Runtime Version
+ Diffuse Irradiance 类型
+ 输出分辨率
+ 采样数量
```

相同环境和生成参数会直接复用缓存。HDR Reload 后 Runtime Version 改变，旧结果自动失效。

生成完成后：

```
PBRModel → texture slot 8
Terrain  → texture slot 20
```

![](IMG-20260814162121897.png "材质球纹理")

![](IMG-20260814162220512.png "Terrain纹理")

Model 与 Terrain 使用同一张 Irradiance Map 和同一套环境漫反射公式。

## Specular Prefilter 与 BRDF LUT

最直接的环境镜面反射是：

```glsl
vec3 reflection =
    reflect(-viewDirection, normal);

vec3 environment =
    texture(environmentMap, reflection).rgb;
```

它适合近似理想镜面，但无法表达 Roughness。

在 Cook–Torrance BRDF 中，粗糙度控制微表面法线的分布：

- Roughness 较低时，微表面方向集中，反射清晰；
- Roughness 较高时，微表面方向分散，反射高光变宽。

![](IMG-20260814162510287.png "Roughness 增大时，镜面反射方向逐渐分散")

如果所有材质都直接采样同一张清晰环境图，那么粗糙金属仍会像镜子一样反射天空，与 BRDF 不一致。

镜面 IBL 来源于：

$$
L_o^{specular}= \int_\Omega L_i(\omega_i) f_{specular}(\omega_i,\omega_o) (n\cdot\omega_i) d\omega_i
$$

Cook–Torrance 镜面 BRDF 为：

$$
f_{specular}= \frac{DFG} {4(n\cdot\omega_o)(n\cdot\omega_i)}
$$

其中：

- $D$ 是 GGX Normal Distribution；
- $F$ 是 Fresnel；
- $G$ 是 Geometry Visibility；
- 环境 $L_i$ 随方向变化；
- BRDF 同时依赖 Normal、View、Light 和 Roughness。

直接在每个片元中执行几十或几百次环境采样显然不现实。

Glimmer 采用实时 PBR 中常用的 Split-Sum Approximation。该方法来自 Epic Games 的实时物理着色实践，将环境镜面积分近似拆成两部分预计算。[Epic Games—Real Shading in Unreal Engine 4](https://cdn2.unrealengine.com/Resources/files/2013SiggraphPresentationsNotes-26915738.pdf)

```
环境相关部分
    → Specular Prefilter Cubemap

材质/视角 BRDF 部分
    → 2D BRDF LUT
```

运行时再将二者组合。

### Specular Prefilter Cubemap

Prefilter Cubemap 根据不同 Roughness 对 HDR 环境执行 GGX 重要性采样。

Glimmer 将不同粗糙度的结果保存到 Mip Chain：

```
Mip 0 → Roughness 0.0
Mip 1 → Roughness 1/6
Mip 2 → Roughness 2/6
Mip 3 → Roughness 3/6
Mip 4 → Roughness 4/6
Mip 5 → Roughness 5/6
Mip 6 → Roughness 1.0
```

当前默认基础分辨率为 `64×64`，因此完整链为：

```
64 → 32 → 16 → 8 → 4 → 2 → 1
```

![](IMG-20260814162909794.png "Prefilter Cubemap 的不同 Mip 对应逐渐增大的 Roughness")

Mip 0 在 Glimmer 中直接读取原环境：

```cpp
if (mip == 0)
{
    value = SampleCubemap(source, normal).rgb;
}
```

其余 Mip 根据 GGX 采样半程向量 $H$，再由 $V$ 和 $H$ 恢复入射方向 $L$：

$$ L=2(V\cdot H)H-V $$

当前预过滤假设：

$$ V=N=R $$

这样生成过程不再依赖真实运行时 View Direction，可以只根据输出 Cubemap 方向和 Roughness 生成派生图。

这是 Split-Sum 中的一项近似：它牺牲一部分掠射角准确性，换取可以预计算的二维方向加 Roughness 表示。[LearnOpenGL 对该近似的说明](https://learnopengl.com/PBR/IBL/Specular-IBL)

### GGX 重要性采样

Glimmer 使用与 Diffuse Irradiance 相同的 Hammersley 低差异序列，但将二维序列映射到 GGX 分布。

```cpp
const float alpha = roughness * roughness;
const float alphaSquared = alpha * alpha;
const float phi = 2.0f * Pi * sequenceX;

const float cosTheta = sqrt(
    (1.0f - sequenceY)
    / max(
        1.0f
        + (alphaSquared - 1.0f) * sequenceY,
        0.000001f));
```

得到局部半程向量：

```cpp
glm::vec3 halfwayLocal(
    cos(phi) * sinTheta,
    sin(phi) * sinTheta,
    cosTheta);
```

再转换到当前 Normal 的切线空间：

```cpp
glm::vec3 halfway =
    normalize(
        tangent   * halfwayLocal.x +
        bitangent * halfwayLocal.y +
        normal    * halfwayLocal.z);
```

最终计算入射方向：

```cpp
glm::vec3 light =
    normalize(
        2.0f * dot(view, halfway)
        * halfway - view);
```

只累积上半球中的有效方向：

```cpp
float normalDotLight =
    max(dot(normal, light), 0.0f);

if (normalDotLight > 0.0f)
{
    value += SampleCubemap(source, light).rgb
        * normalDotLight;

    totalWeight += normalDotLight;
}
```

默认每个输出 Texel 使用 64 个样本。

普通 Mip 的下采样只会将相邻像素平均，而Prefilter包含反射方向、GGX 波瓣、Roughness、半球边界、$N\cdot L$ 权重等详细信息。

Prefilter Mip 则表示：

> 以该方向作为反射中心，在指定 Roughness 的 GGX 分布下，环境能够贡献多少镜面辐射。

因此它虽然也表现为逐层模糊，却不是普通图像模糊。

运行时根据 Roughness 选择 LOD：

```glsl
vec3 reflection =
    reflect(-viewDirection, normal);

float lod =
    roughness * u_SpecularPrefilterMaxLod;

vec3 prefiltered =
    textureLod(
        u_SpecularPrefilterMap,
        reflection,
        lod).rgb;
```

Roughness 可以是连续值，Trilinear Sampling 会在相邻 Mip 之间插值。

### BRDF LUT

Prefilter Cubemap 只解决环境分布和 GGX 采样问题。它尚未完整包含 Fresnel 与 Geometry Visibility。

这些项仍然依赖：

- $N\cdot V$；
- Roughness；
- 材质的 $F_0$。

如果为每一种 $F_0$、Roughness 和观察角度生成独立 Cubemap，资源维度将不可接受。

Split-Sum 使用 Schlick Fresnel：

$$ F=F_0+(1-F_0)(1-V\cdot H)^5 $$

把最终积分整理成：

$$ F_0A(N\cdot V,roughness) + B(N\cdot V,roughness) $$

其中 $A$ 和 $B$ 只依赖两个变量：

```
横轴：N·V
纵轴：Roughness
输出：Scale A、Bias B
```

因此可以保存为一张双通道二维纹理，也就是 BRDF LUT。

![](IMG-20260814163344575.png "BRDF LUT 的两个通道保存 Fresnel Scale 与 Bias")

## 运行时组合

Glimmer 最终使用：

```glsl
float normalDotView =
    max(dot(normal, viewDirection), 0.0);

vec3 F =
    FresnelSchlickRoughness(
        normalDotView,
        F0,
        roughness);

vec3 reflection =
    reflect(-viewDirection, normal);

vec3 prefiltered =
    textureLod(
        u_SpecularPrefilterMap,
        reflection,
        roughness * u_SpecularPrefilterMaxLod).rgb;

vec2 brdf =
    texture(
        u_BrdfLut,
        vec2(normalDotView, roughness)).rg;

vec3 specularIBL =
    prefiltered
    * (F * brdf.x + brdf.y);
```

完整环境光为：

$$ IBL= \left[ (1-F)(1-metallic) \frac{albedo}{\pi} Irradiance(N) + Prefilter(R,roughness) (F\cdot A+B) \right] AO \cdot SkyLightIntensity $$

对应结构：

```glsl
vec3 diffuseWeight =
    (vec3(1.0) - F)
    * (1.0 - metallic);

vec3 diffuseIBL =
    diffuseWeight
    * albedo
    * irradiance
    / PI;

vec3 ambient =
    (diffuseIBL + specularIBL)
    * ao
    * u_SkyLightIntensity;
```

PBRModel 使用：

```
Diffuse Irradiance → slot 8
Specular Prefilter → slot 9
BRDF LUT           → slot 10
```

Terrain 因为前面已经占用了 Height Map、派生图和四层 Triplanar Material，使用：

```
Diffuse Irradiance → slot 20
Specular Prefilter → slot 21
BRDF LUT           → slot 22
```

![](IMG-20260814181928615.png "最终IBL效果")