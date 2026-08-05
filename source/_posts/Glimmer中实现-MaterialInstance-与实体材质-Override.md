---
title: Glimmer中实现 MaterialInstance 与实体材质 Override
cover: cover.png
top_img: false
toc: true
aside: true
date: 2026-08-05 17:41:35
categories: 游戏引擎
tags:
  - 引擎开发
  - 资产管理
description: 在debug时调整场景实体上的mat参数时导致我原mat资产git diff了，十分不爽，故添加此功能。
keywords:
---
![](cover.png)

## 建设目的

此前多个实体引用同一个 `.glmat` 时，实体 Inspector 直接修改 `Material::GetProperties()` 并调用 `Material::Save()`。由于 `AssetManager` 会按 `AssetHandle` 缓存并共享同一个 `Material` 对象，对任意实体调整颜色、纹理、金属度或粗糙度都会修改原始材质资产，并同步影响所有引用它的实体。

本阶段将材质数据拆成两层：

```text
Material Asset（.glmat，共享基础值）
    -> MaterialComponent::MaterialHandle
    -> MaterialOverrides（实体局部值）
    -> MaterialInstance（运行时合并结果）
    -> Renderer2D / Renderer3D
```

这样既保留 `.glmat` 的复用能力，也允许实体拥有局部外观差异。`MaterialInstance` 不复制 Shader、Texture 或 GPU 对象，只在提交渲染时解析最终参数。

## 核心数据结构

`MaterialOverride` 使用位掩码标记单个属性是否覆盖基础材质：

```cpp
enum class MaterialOverride : uint32_t
{
    None             = 0,
    BaseColor        = 1 << 0,
    BaseColorTexture = 1 << 1,
    TilingFactor     = 1 << 2,
    Metallic         = 1 << 3,
    Roughness        = 1 << 4
};

struct MaterialOverrides
{
    uint32_t Mask = 0;
    MaterialProperties Values;

    bool IsEnabled(MaterialOverride property) const;
    void SetEnabled(MaterialOverride property, bool enabled);
    void Clear();
    bool Empty() const;
};
```

当前允许实体覆盖：

| 属性 | 用途 |
| --- | --- |
| `BaseColor` | 实体局部基础颜色或 Tint |
| `BaseColorTexture` | 实体局部基础颜色纹理 |
| `TilingFactor` | 实体局部 UV 平铺倍率 |
| `Metallic` | 实体局部金属度 |
| `Roughness` | 实体局部粗糙度 |

Shader 仍由基础 `.glmat` 决定，不允许实体覆盖。Shader 会影响管线、顶点布局和参数布局，把它作为普通实例参数会导致渲染状态难以归类，也不利于后续排序与合批。

`MaterialComponent` 现在同时保存共享材质引用和局部覆盖数据：

```cpp
struct MaterialComponent
{
    AssetHandle MaterialHandle{ 0 };
    MaterialOverrides Overrides;
};
```

如图，勾选mat前对应属性才可以进行基于当前实体的单独修改

![](IMG-20260805175859788.png "加入MaterialInstance")

而对于原始mat资产，修改则会同步修改所有的引用

![](IMG-20260805180240071.png "修改原始mat")

分别调整单独实体的mat参数

![](IMG-20260805180417082.png "进行单独调参")

## MaterialInstance 合并流程

`MaterialInstance` 位于核心库 `Renderer` 目录。构造时先复制基础 `MaterialProperties`，再只应用 `Mask` 中启用的字段：

```text
AssetManager::GetMaterial(MaterialHandle)
    -> 取得共享 Material
    -> 复制基础 MaterialProperties
    -> 应用启用的 MaterialOverrides
    -> 约束参数范围
    -> 得到本次绘制使用的最终属性
```

```cpp
MaterialInstance::MaterialInstance(
		const Ref<Material>& material,
		const MaterialOverrides& overrides)
		: m_Material(material)
	{
		if (!m_Material)
			return;

		m_Properties = m_Material->GetProperties();
		if (overrides.IsEnabled(MaterialOverride::BaseColor))
			m_Properties.BaseColor = overrides.Values.BaseColor;
		if (overrides.IsEnabled(MaterialOverride::BaseColorTexture))
			m_Properties.BaseColorTexture = overrides.Values.BaseColorTexture;
		if (overrides.IsEnabled(MaterialOverride::TilingFactor))
			m_Properties.TilingFactor = glm::max(overrides.Values.TilingFactor, 0.01f);
		if (overrides.IsEnabled(MaterialOverride::Metallic))
			m_Properties.Metallic = glm::clamp(overrides.Values.Metallic, 0.0f, 1.0f);
		if (overrides.IsEnabled(MaterialOverride::Roughness))
			m_Properties.Roughness = glm::clamp(overrides.Values.Roughness, 0.04f, 1.0f);
	}
```

合并后继续保持以下约束：

- `TilingFactor >= 0.01`；
- `Metallic` 位于 `[0, 1]`；
- `Roughness` 位于 `[0.04, 1]`。

未启用的字段始终继承基础材质。因此修改 `.glmat` 后，所有未覆盖字段仍会使用最新的共享值；只有明确覆盖的字段保持实体自己的值。

## Inspector 编辑边界

实体和资产采用两条不同的编辑路径：

```text
Hierarchy 选中 Entity
    -> Entity Inspector
    -> 编辑 MaterialComponent::Overrides
    -> 不调用 Material::Save()

Content Browser 选中 .glmat
    -> Asset Inspector
    -> 编辑共享 MaterialProperties
    -> Material::Save()
    -> 所有继承该字段的实体同步更新
```

实体 Material 面板为每个可覆盖属性提供启用开关。第一次启用时会复制当前基础值，避免控件突然跳到 `MaterialProperties` 的默认值。拖入纹理会自动启用 `BaseColorTexture` Override；`Reset Overrides` 会清除全部位标记，使实体重新完整继承基础材质。

更换或移除实体的基础 `.glmat` 时会清空旧 Overrides，防止原材质的局部参数意外套用到结构或语义不同的新材质上。

Asset Inspector 会提示当前操作修改的是共享资源，避免把资产编辑误认为实体局部编辑。

## Renderer2D 与 Renderer3D 接入

`Scene` 在编辑模式和运行模式的 2D、3D 绘制路径中都会把 `MaterialComponent::Overrides` 传给 Renderer。

Renderer2D 解析后的颜色、Tiling 和纹理仍通过现有 Quad 顶点数据与纹理槽提交：

- 不同 `BaseColor` 不会打断合批；
- 不同 `TilingFactor` 不会打断合批；
- 已存在于当前批次的纹理会复用纹理槽；
- 单批超过可用纹理槽或索引容量时才执行 Flush；
- Renderer2D 当前仍固定使用 `TextureShader`，`.glmat` 的 ShaderHandle 尚未参与 2D 管线选择。

![](IMG-20260805180931627.png "在Renderer2D中进行合并")

Renderer3D 使用合并后的 ShaderHandle 和 PBR 属性上传 Uniform，并解析最终基础颜色纹理。当前 Renderer3D 仍是逐模型、逐 Mesh 提交，本阶段没有新增额外拆批；后续真正建设 3D Instancing 时，应按 Shader、RenderState、Mesh、Material 和纹理组合生成 RenderKey，再把 Transform、EntityID 和可实例化材质参数写入 Instance Buffer 或 Material Buffer。

![](IMG-20260805180752507.png "在Renderer3D中进行合并")

`MaterialInstance` 本身不创建新的 GPU Material，也不会复制纹理。当前额外 CPU 成本主要是每个实体提交时进行一次属性复制和位掩码合并；实体数量显著增大后，可以增加版本号、Dirty 标记和解析结果缓存。

### 场景复制与序列化

场景 YAML 仅在存在覆盖时写出 `Overrides`：

```yaml
MaterialComponent:
  Material: 13777784352782102236
  Overrides:
    Mask: 21
    BaseColor: [0.2, 0.7, 1.0, 1.0]
    BaseColorTexture: 0
    TilingFactor: 2.0
    Metallic: 0.1
    Roughness: 0.6
```

`Mask` 是实际生效字段的唯一依据。完整写出 `Values` 可以保持格式稳定，也便于以后启用某一字段时恢复已保存的数据。

兼容策略如下：

- 旧场景没有 `Overrides`：覆盖集合保持为空，行为与原先一致；
- 新场景有 `Overrides`：读取 Mask 和所有候选值；
- `Scene::Copy()`、实体复制和 `EntitySnapshot` 按值复制 `MaterialComponent`，Override 会自然进入 Runtime Scene、Duplicate 和 Undo 恢复流程；
- `.glmat` 继续只保存共享基础值，不包含任何实体 UUID 或场景局部数据。

## 其它 Asset 组件审计

本轮同时检查了可以挂载到实体的其它 AssetHandle 组件。

判断是否需要 Asset Instance 的标准不是“组件是否保存 AssetHandle”，而是“实体是否需要修改资产内部数据且不能影响其它引用者”。Texture、Model 和 Cubemap 当前都是只读引用；如果后续为它们增加每实体采样器、子网格可见性或环境旋转等设置，应优先把这些设置放入组件局部数据，而不是修改共享资产对象。