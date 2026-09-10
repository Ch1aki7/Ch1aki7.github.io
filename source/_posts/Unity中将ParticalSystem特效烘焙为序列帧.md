---
title: Unity中将ParticleSystem特效烘焙为序列帧
cover: cover_cc954f23.png
top_img: false
toc: true
aside: true
abbrlink: cc954f23
date: 2026-09-09 17:07:00
updated: 2026-09-10 13:20:00
categories: 引擎工具
tags:
  - Unity
  - ParticleSystem
description: 开发 Unity 编辑器工具，将实时粒子特效离线采样并打包成序列帧图集，运行时使用 Quad 播放，降低粒子模拟与复杂材质带来的开销。
keywords: Unity, ParticleSystem, 序列帧, 图集, 特效烘焙, VFX Baker, 性能优化
---

{% note info %}
完整源码、使用说明及最新版本请参见：[Unity-VFX-Baker](https://github.com/Ch1aki7/Unity-VFX-Baker)
{% endnote %}

## 写在前面

实时粒子特效通常由多个 `ParticleSystem`、Renderer 和材质组成。效果越复杂，运行时需要处理的粒子模拟、顶点生成、透明物体排序和 Draw Call 就越多。对移动端、小游戏等性能和包体都比较敏感的平台来说，一些只需要按固定方式播放的特效没有必要始终保留完整的实时逻辑。

我的处理思路是将特效提前录制成序列帧图集：编辑器逐帧驱动原始特效，用正交相机将每一帧渲染到纹理，再生成材质和只包含 Quad 的 Prefab。运行时只需要根据时间切换图集中的 UV 区域。

![](IMG-20260910102529458.gif "原始粒子特效")

这是一种空间换时间的方案。它省掉了粒子模拟和大部分复杂渲染逻辑，但会增加纹理资源占用，并且丢失实时粒子的部分动态能力。因此它更适合播放内容、时长和观察方向都比较固定的表现，例如技能提示、命中特效、UI 特效和远景装饰。

## 烘焙流程

整个流程可以拆成四步：采样、裁剪、打图集和生成播放资源。

### 逐帧采样

工具会创建隔离的正交相机，从 `0` 秒开始按目标帧率驱动特效，并将每个采样时刻的画面写入临时 RenderTexture。使用固定时间采样可以得到稳定的帧数，图集播放速度也能通过 `Frame Time = 1 / Frame Rate` 还原。

采样的重点是不要依赖编辑器的实际刷新速度。下面保留了核心代码，资源释放、进度条和异常恢复等编辑器逻辑没有展开：

```csharp
float frameTime = 1f / frameRate;
int frameCount = Mathf.CeilToInt(effectDuration * frameRate);

for (int frameIndex = 0; frameIndex < frameCount; frameIndex++)
{
    float sampleTime = frameIndex * frameTime;

    // restart=true：每次都从 0 秒模拟到目标时刻，避免累计误差。
    foreach (ParticleSystem particle in particles)
        particle.Simulate(sampleTime, false, true, false);

    captureCamera.targetTexture = captureRT;
    captureCamera.Render();

    RenderTexture.active = captureRT;
    var frameTexture = new Texture2D(
        captureRT.width,
        captureRT.height,
        TextureFormat.RGBA32,
        false);

    frameTexture.ReadPixels(
        new Rect(0, 0, captureRT.width, captureRT.height),
        0,
        0);
    frameTexture.Apply(false);
    capturedFrames.Add(frameTexture);
}
```

`Simulate` 的第二个参数设为 `false`，是因为示例已经遍历全部 ParticleSystem。如果只对根粒子系统调用一次，则可以传入 `withChildren: true`。两种方式不要同时使用，否则子粒子系统可能被重复推进。

特效开头可能存在一段没有任何可见像素的等待时间。工具不会简单删除这段时间，而是将其转换为播放延迟；中间出现的空白帧则继续保留。这样可以避免多组子特效合并后发生时间轴错位。

### 裁剪有效区域

直接保存相机输出会产生大量透明像素。工具会计算每帧 Alpha 通道的有效包围盒，在四周加上 `Crop Padding`，然后将结果扩展为 2 的幂尺寸。

有效区域可以通过一次像素遍历求出。Alpha 小于阈值的像素按透明处理，避免纹理压缩或后处理产生的极小 Alpha 把包围盒意外撑大：

```csharp
static bool TryGetAlphaBounds(
    Texture2D texture,
    byte alphaThreshold,
    out RectInt bounds)
{
    Color32[] pixels = texture.GetPixels32();
    int minX = texture.width;
    int minY = texture.height;
    int maxX = -1;
    int maxY = -1;

    for (int y = 0; y < texture.height; y++)
    {
        for (int x = 0; x < texture.width; x++)
        {
            if (pixels[y * texture.width + x].a <= alphaThreshold)
                continue;

            minX = Mathf.Min(minX, x);
            minY = Mathf.Min(minY, y);
            maxX = Mathf.Max(maxX, x);
            maxY = Mathf.Max(maxY, y);
        }
    }

    if (maxX < minX)
    {
        bounds = default;
        return false;
    }

    bounds = new RectInt(
        minX,
        minY,
        maxX - minX + 1,
        maxY - minY + 1);
    return true;
}
```

得到 `bounds` 后，再向四周扩展 Padding，并将坐标限制在原纹理范围内。完全透明的开头帧用于累计播放延迟；如果空白出现在动画中间，则仍要占据一个帧索引。

Padding 不能完全省略。双线性采样会读取当前帧边缘之外的像素，如果内容贴着边界裁切，播放时容易出现亮边或被截断。发光、拖尾较大的特效可以适当提高 Padding。

### 打包图集

裁剪后的帧会被缩放到统一的 `Atlas Frame Size`，再按顺序写入一张 2 的幂图集。图集承担颜色和透明度数据；工具另外生成一张 AnimTex，保存逐帧播放所需的数据。Shader 根据 AnimTex 以及材质中的帧数、帧间隔计算当前帧的采样区域。

如果每帧使用固定大小的格子，图集位置可以直接由帧索引计算：

```csharp
int columns = Mathf.CeilToInt(Mathf.Sqrt(frames.Count));
int rows = Mathf.CeilToInt(frames.Count / (float)columns);
int atlasWidth = Mathf.NextPowerOfTwo(columns * frameSize);
int atlasHeight = Mathf.NextPowerOfTwo(rows * frameSize);

var atlas = new Texture2D(
    atlasWidth,
    atlasHeight,
    TextureFormat.RGBA32,
    false);

for (int i = 0; i < frames.Count; i++)
{
    int x = i % columns * frameSize;
    int y = i / columns * frameSize;
    atlas.SetPixels32(x, y, frameSize, frameSize, frames[i].GetPixels32());
}

atlas.Apply(false);
```

实际工具还需要把每帧裁剪后的缩放和偏移写进 AnimTex。这样 Shader 不必为每个实例维护一组很长的数组，只需通过帧索引读取一个像素，就能得到当前帧在 Atlas 中的 UV 变换。

![](cover_cc954f23.png "烘焙后的序列帧图集")

### 生成运行时资源

每个烘焙组会生成对应的图集、AnimTex、材质和 Prefab 节点。原本由多个粒子系统构成的层级，最终变成若干个使用同一套序列帧播放 Shader 的 Quad。

播放 Shader 的核心只做两件事：根据本地播放时间算出帧索引，再用 AnimTex 中保存的 `scale/offset` 修正 UV。下面是省略渲染管线宏后的示意代码：

```glsl
float elapsed = _PlaybackTime - _StartDelay;
clip(elapsed); // 延迟结束前不输出像素
float localTime = max(0.0, elapsed);
uint frameIndex = min(
    (uint)floor(localTime / _FrameTime),
    (uint)_FrameCount - 1);

float dataU = (frameIndex + 0.5) / _FrameCount;
float4 frameData = SAMPLE_TEXTURE2D_LOD(
    _AnimationData,
    sampler_AnimationData,
    float2(dataU, 0.5),
    0);

// xy 保存 UV 缩放，zw 保存 UV 偏移。
float2 atlasUV = input.uv * frameData.xy + frameData.zw;
half4 color = SAMPLE_TEXTURE2D(_Atlas, sampler_Atlas, atlasUV);
```

`_PlaybackTime` 使用特效自己的本地时间，而不是直接读取 Shader 的全局 `_Time`。这样对象重新启用时将本地时间清零，动画就能从第一帧重新播放。运行时可以通过 `MaterialPropertyBlock` 更新参数，避免为了不同播放进度复制材质：

```csharp
void OnEnable()
{
    elapsed = 0f;
}

void Update()
{
    elapsed += Time.deltaTime;
    renderer.GetPropertyBlock(properties);
    properties.SetFloat("_PlaybackTime", elapsed);
    renderer.SetPropertyBlock(properties);
}
```

材质中的主要参数如下：

- `Atlas`：保存各帧颜色和透明度的图集；
- `Animation Data`：工具生成的 AnimTex；
- `Frame Count`：有效帧总数；
- `Frame Time`：相邻两帧的时间间隔；
- `Cull`、`ZWrite` 和 `Render Queue`：控制 Quad 的常规渲染状态。

![](IMG-20260909175003687.png "生成材质的参数")

## 使用方法

### 1. 整理待烘焙特效

为了缩短 Unity 导入和重载时间，我习惯先将特效及依赖导出到一个小型 Demo 工程中。导出时需要勾选依赖项，确保材质、Shader、纹理和脚本一并带出。

![](IMG-20260909172150692.png "从原始项目导出特效及依赖")

导入后先在场景中完整播放一次，检查是否存在丢材质、脚本报错或依赖资源缺失。只有原始效果正确，后续烘焙结果才有比较意义。

特效 Prefab 可以包含多个子节点。工具只列出带有 `ParticleSystem` 的叶子节点，并允许按名称为它们分组。

![](IMG-20260909174405584.png "待烘焙特效的层级结构")

### 2. 设置烘焙参数

打开 `VFX Prefab Baker` 窗口，将待处理的 Prefab 拖入 `Source Effect`。界面中的几个参数直接决定画质、资源体积和采样耗时：

| 参数 | 作用 | 选择建议 |
| --- | --- | --- |
| `Frame Rate` | 每秒采样帧数 | 动作较慢可从 15 或 20 FPS 起步；快速闪光、爆炸可提高到 30 FPS |
| `Capture Resolution` | 采样相机的原始分辨率 | 负责捕捉细节，不等于最终单帧尺寸；正式烘焙前可下调做快速预览 |
| `Atlas Frame Size` | 图集中每一帧占用的尺寸 | 根据特效在屏幕中的实际像素大小选择，尺寸翻倍会明显增加图集面积 |
| `Crop Padding` | 有效内容边缘保留的透明像素 | 默认从 2 px 开始，出现截断或采样亮边时再增加 |
| `Bake Child Groups` | 是否按子特效分组烘焙 | 需要独立分层控制、错峰播放或单独关闭某部分时开启 |

![](IMG-20260909174503456.png "VFX Prefab Baker 参数面板")

分组时，名字相同的节点会烘焙到同一组；名称留空的节点不会参与烘焙。图中的枪焰、漩涡、剑头等子效果被整理成四组，生成的 Prefab 也会保留这四个可独立开关的节点。

点击 `Bake Effect` 后，工具会显示当前采样帧和总帧数。捕获分辨率、帧率、特效时长和组数都会影响烘焙时间。

![](IMG-20260909174536151.png "逐帧捕获过程")

### 3. 检查输出资源

烘焙完成后，先检查图集中的每一帧是否完整，再检查材质参数和 Prefab 分组。输出目录包含各组的序列帧图集、AnimTex、材质以及最终 Prefab。

![](IMG-20260909174929679.png "烘焙生成的纹理、材质和 Prefab")

![](IMG-20260909175035911.png "按四个烘焙组生成的 Prefab")

将 Prefab 拖入场景即可播放。运行时关闭后重新启用节点，动画会从头开始；各组节点也可以按业务需要独立控制。

![](IMG-20260910105820666.gif "序列帧 Prefab 的运行效果")

## 参数与资源体积

序列帧方案最容易踩的坑是图集膨胀。粗略计算时，可以先忽略压缩，按下面的关系估算：

```text
单帧像素数 = FrameWidth × FrameHeight
图集像素数 ≈ 单帧像素数 × FrameCount
RGBA32 原始大小 ≈ 图集像素数 × 4 Bytes
```

例如，单帧使用 `256 × 256`，总计 64 帧，未压缩 RGBA32 数据约为 16 MiB。导入 Unity 后的实际占用取决于纹理压缩格式、是否开启 Mipmap、目标平台和图集填充率，但这个估算足以帮助判断参数是否过大。

实际调参时我会按下面的顺序处理：

1. 先降低帧率，观察运动是否还能接受；
2. 再按最终显示尺寸降低 `Atlas Frame Size`；
3. 对持续时间很长的特效，优先拆分循环段和一次性段；
4. 最后根据目标平台选择合适的纹理压缩格式，并在真机确认显存和采样质量。

`Capture Resolution` 主要决定捕获精度，`Atlas Frame Size` 才直接决定单帧写入图集的尺寸。二者不需要保持一致。先高分辨率捕获再缩小到图集帧，通常比直接低分辨率捕获更容易保留细线和发光边缘。

## 适用范围与限制

烘焙后的效果本质上是一段面向相机的二维动画，因此使用前需要确认以下限制：

- 观察角度固定。镜头大幅绕到侧面或背面时，二维 Quad 会暴露出来；
- 无法继续响应粒子碰撞、速度继承、外力、Sub Emitter 等实时逻辑；
- 原始效果中的深度关系会被压平，和场景物体交叉时可能需要额外处理遮挡；
- 透明序列帧仍可能存在 Overdraw，烘焙不会自动解决大面积透明像素问题；
- 多组 Quad 可以保留分层控制，但组数越多，Draw Call 和管理成本也会随之增加；
- 图集分辨率和帧数设置过高时，CPU/GPU 计算省下来了，显存与包体却可能更糟。

因此，不能只对比画面是否相似。正式替换前至少应在目标设备上比较 CPU、GPU、Draw Call、纹理内存和包体变化。对于会贴地、环绕角色、依赖碰撞或要求多视角观察的效果，保留 ParticleSystem 往往更合适。

## 小结

VFX Baker 将原本运行时完成的工作提前到了编辑器：先固定时间轴采样，再裁剪透明区域、打包图集，最后生成材质与 Quad Prefab。它适合把表现固定的复杂粒子效果转换为成本更可控的播放资源。但只有在真机上同时验证画面、耗时和资源占用，烘焙才算真正完成。
