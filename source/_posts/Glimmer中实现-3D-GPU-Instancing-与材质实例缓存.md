---
title: Glimmer中实现 3D GPU Instancing 与材质实例缓存
cover: cover.png
top_img: false
toc: true
aside: true
categories: 游戏引擎
tags:
  - 引擎开发
  - 渲染优化技术
description: 为 Glimmer 的 3D 渲染器加入了真正的 GPU Instancing，并优化了 MaterialInstance 的解析流程。
abbrlink: 1eddf29f
date: 2026-08-07 15:43:45
keywords:
---

## 什么是 GPU Instancing

Unity的官方文档解释：使用 GPU 实例化可使用少量DrawCall一次绘制（或渲染）同一网格的多个副本。这对于绘制诸如建筑物、树木、草地或其他在场景中重复出现的对象非常有用。

GPU 实例化在每次绘制调用时仅渲染相同的网格，但每个实例可以具有不同的参数（例如，颜色或比例）以增加变化并减少外观上的重复。

GPU 实例化可以降低每个场景使用的绘制调用数量。可以显著提高项目的渲染性能。

而在Glimmer历史版本中，即使场景里放置了多个完全相同的模型，Renderer3D 仍然需要为每个物体分别提交一次 DrawCall：也就是说绘制3个Cube仍然需要3次DrawCall。

那么GPU Instancing会怎么做呢？在应用GPU实例化后，Renderer3D 会先比较每个物体的 Mesh、Shader、纹理和最终材质参数。满足兼容条件的对象会被聚合成一个批次：使得3 个相同 Cube 对应 1 次 Instanced DrawCall

![](IMG-20260807162505580.png)

每个实例的 `Transform` 和 `EntityID` 被写入动态 Instance Buffer。OpenGL 使用：

```cpp
glVertexAttribDivisor(attribute, 1);
glDrawElementsInstanced(...);
```

告诉 GPU：模型的普通顶点数据按顶点读取，而变换矩阵和实体编号按实例读取。这样一次 DrawCall 就能绘制多个位于不同位置的相同模型，同时仍然可以通过独立的 `EntityID` 进行鼠标拾取。

看到这里会联想到几个月前做的Renderer2D的批处理部分，都是用于减少绘制大量物体时产生DrawCall的手段，而3D的批处理则是一个更为庞大的概念，包含多种用于减少DrawCall的技术路线，GPU Instancing就是其中的一种，另外还包括几种更为熟知的：
1. 动态合批：每帧 CPU 临时把小 Mesh 拼起来，适合少量、小型动态物体
2. 静态合批：提前把不动的 Mesh 拼起来，适合建筑、地面、静态场景

## 实例输入与渲染接口

`BufferElement` 新增 `PerVertex / PerInstance` 输入频率。OpenGL VertexArray 不再让每个 VertexBuffer 从 attribute 0 重新开始，而是持续分配位置；Mat3/Mat4 会拆成多个列属性，实例元素使用 `glVertexAttribDivisor(..., 1)`。

公共 `RendererAPI` / `RenderCommand` 增加 `DrawIndexedInstanced`，OpenGL 后端封装 `glDrawElementsInstanced`。Renderer3D 维护最多 1024 项的动态 Instance Buffer，每项包含：

```cpp
struct InstanceData
{
    glm::mat4 Transform;
    glm::ivec4 EntityData; // x = EntityID
};
```

PBRModel Shader 使用 location 4–7 接收实例矩阵，location 8 接收 EntityID。`u_UseInstancing` 在实例和普通绘制路径间切换，因此单物体、不同材质拆批和鼠标拾取仍共用同一 Shader。Shader 在初次链接及热重载后检查这三个输入；不满足契约的 Shader 不会报错或强行实例化，而是自动逐项 DrawIndexed。

![](IMG-20260807163623608.png)

## Instancing 完整链路

完整链路可概括为：

```
Scene 遍历实体
  ↓
Renderer3D::SubmitModel
  ↓
解析 Model + MaterialInstance
  ↓
生成 RenderItem，放入 OpaqueQueue
  ↓
Renderer3D::EndScene
  ↓
RenderKey 排序
  ↓
CanBatch 判断兼容性
  ↓
构造 InstanceData[]
  ↓
上传 Instance VertexBuffer
  ↓
RenderCommand::DrawIndexedInstanced
  ↓
OpenGLRendererAPI::DrawIndexedInstanced
  ↓
glDrawElementsInstanced
  ↓
PBRModel Shader 按实例读取 Transform 和 EntityID
```

### Renderer3D 初始化 Instance Buffer

引擎初始化时，Renderer3D 创建一个最多容纳 1024 个实例的动态顶点缓冲：

```cpp
s_Data.InstanceVertexBuffer = VertexBuffer::Create(
    MaxInstancesPerDraw * sizeof(InstanceData));

s_Data.InstanceVertexBuffer->SetLayout({
    {
        ShaderDataType::Mat4,
        "a_InstanceTransform",
        false,
        BufferInputRate::PerInstance
    },
    {
        ShaderDataType::Int4,
        "a_InstanceEntityData",
        false,
        BufferInputRate::PerInstance
    }
});
```

### Scene 从 ECS 收集模型实体

编辑模式和运行模式使用相同的 Renderer3D 提交流程。

```cpp
Renderer3D::BeginScene(viewProjection, cameraPosition);

auto modelView =
    m_Registry.view<TransformComponent, ModelRendererComponent>();

for (auto entity : modelView)
{
    const auto& transform =
        modelView.get<TransformComponent>(entity);

    const auto& model =
        modelView.get<ModelRendererComponent>(entity);

    const auto* material =
        m_Registry.try_get<MaterialComponent>(entity);

    Renderer3D::SubmitModel(
        transform.GetTransform(),
        model.ModelHandle,
        material ? material->MaterialHandle : AssetHandle(0),
        static_cast<int>(static_cast<uint32_t>(entity)),
        material ? &material->Overrides : nullptr);
}

Renderer3D::EndScene();
```

只进行收集，没有真正调用 OpenGL 绘制

### SubmitModel 解析资源和最终材质

首先加载 Model 和 Material：

```cpp
const Ref<Model> model =
    AssetManager::GetModel(modelHandle);

const Ref<Material> material =
    AssetManager::GetMaterial(materialHandle);
```

然后以`EntityID + MaterialHandle`作为缓存键，检查最终材质是否需要重新解析

```cpp
const MaterialCacheKey cacheKey{
    entityID,
    static_cast<uint64_t>(materialHandle)
};

if (inserted
    || cached.BaseState != baseState
    || cached.Overrides != resolvedOverrides)
{
    const MaterialInstance instance(
        material, resolvedOverrides);

    cached.ShaderHandle = instance.GetShaderHandle();
    cached.Properties = instance.GetProperties();
}
```

最终属性来自：共享 MaterialProperties + 当前实体 MaterialOverrides

如果材质与 Override 都没有变化，则直接使用缓存。

### 每个 Mesh 生成 RenderItem

一个 Model 可以包含多个 Mesh，因此 Renderer3D 会把 Model 展开成一个或多个 `RenderItem`：

```cpp
for (const Ref<Mesh>& mesh : model->GetMeshes())
{
    RenderItem item;

    item.MeshResource = mesh;
    item.ShaderResource = shader;
    item.TextureResource = texture;
    item.Material = properties;
    item.Transform = transform;
    item.EntityID = entityID;

    s_Data.OpaqueQueue.emplace_back(std::move(item));
}
```

RenderItem 同时包含排序键：

```cpp
item.Key.Shader = shaderHandle;
item.Key.Material = materialHandle;
item.Key.Texture = texture->GetRendererID();
item.Key.Mesh = reinterpret_cast<uintptr_t>(mesh.get());
item.Key.MaterialState = MakeMaterialSortKey(properties);
item.Key.Entity = entityID;
```

因此 ECS 的遍历顺序不会直接决定 GPU 绘制顺序。

### EndScene 对 RenderQueue 排序

真正的批次构建发生在：

```cpp
std::sort(
    s_Data.OpaqueQueue.begin(),
    s_Data.OpaqueQueue.end(),
    [](const RenderItem& left, const RenderItem& right)
    {
        return left.Key < right.Key;
    });
```

排序后，兼容对象会相邻排列，例如：

```
Cube + PBR + Material A
Cube + PBR + Material A
Cube + PBR + Material A
Sphere + PBR + Material A
Cube + PBR + Material B
```

前三个 Cube 就具备实例化条件。

### CanBatch 判断能否合批

合批条件位于：

```cpp
bool CanBatch(const RenderItem& left, const RenderItem& right)
		{
			return left.ShaderResource == right.ShaderResource
				&& left.TextureResource == right.TextureResource
				&& left.MeshResource == right.MeshResource
				&& left.Material == right.Material
				&& left.HasBaseColorTexture == right.HasBaseColorTexture;
		}
```

必须保证：

- Shader 相同
- Mesh 相同
- 实际纹理相同
- 最终材质参数相同
- 纹理启用状态相同

Renderer3D 从当前项向后扫描：

```cpp
size_t batchEnd = itemIndex + 1;

while (batchEnd < s_Data.OpaqueQueue.size() && CanBatch(item, s_Data.OpaqueQueue[batchEnd]))
{
    batchEnd++;
}
```

得到批次范围：

```
[itemIndex, batchEnd)
```

### 检查 Shader 是否支持实例化

批次大小大于 1 还不够，Shader 也必须声明实例输入：

```cpp
if (batchSize > 1 && item.ShaderResource->SupportsInstancing())
{
    // GPU Instancing
}
else
{
    // 普通绘制
}
```

OpenGL Shader 在编译和热重载完成后检查：

```cpp
void OpenGLShader::UpdateCapabilities()
	{
		m_SupportsInstancing = m_RendererID != 0
			&& glGetAttribLocation(m_RendererID, "a_InstanceTransform") >= 0
			&& glGetAttribLocation(m_RendererID, "a_InstanceEntityData") >= 0
			&& glGetUniformLocation(m_RendererID, "u_UseInstancing") >= 0;
	}
```

因此 PBRModel 可以实例化，而没有这些输入的 Phong 等 Shader 自动回退。

### 将 Instance Buffer 挂到 Mesh VAO

Instance Buffer 只会向相应 Mesh 的 VertexArray 添加一次：

```cpp
EnsureInstanceInput(item.MeshResource->GetVertexArray());
```

内部检查：

```cpp
const auto& buffers = vertexArray->GetVertexBuffers();

if (std::find(buffers.begin(), buffers.end(), s_Data.InstanceVertexBuffer) == buffers.end())
{
    vertexArray->AddVertexBuffer(s_Data.InstanceVertexBuffer);
}
```

模型本身的属性占用：

```
location 0：Position
location 1：Normal
location 2：Tangent
location 3：TexCoord
```

实例矩阵占用：

```
location 4：Transform 第 1 列
location 5：Transform 第 2 列
location 6：Transform 第 3 列
location 7：Transform 第 4 列
location 8：EntityData
```

### OpenGL 设置逐实例属性

VAO 添加 Instance Buffer 时，`mat4` 会被拆成四个 `vec4` 属性：

```cpp
for (uint32_t column = 0;
     column < columnCount;
     column++)
{
    glEnableVertexAttribArray(
        m_VertexBufferIndex);

    glVertexAttribPointer(
        m_VertexBufferIndex,
        columnCount,
        GL_FLOAT,
        GL_FALSE,
        layout.GetStride(),
        offset);

    glVertexAttribDivisor(
        m_VertexBufferIndex, 1);

    m_VertexBufferIndex++;
}
```

EntityID 使用整数属性：

```cpp
glVertexAttribIPointer(...);
glVertexAttribDivisor(attribute, 1);
```

`glVertexAttribDivisor(..., 1)` 的含义是：

```
普通顶点属性：每处理一个顶点读取下一项
实例属性：每绘制一个实例读取下一项
```

### CPU 构造 InstanceData 数组

Renderer3D 为当前批次提取每个实体的数据：

```cpp
s_Data.InstanceBuffer.clear();

for (size_t index = chunkBegin;
     index < chunkEnd;
     index++)
{
    const RenderItem& instance =
        s_Data.OpaqueQueue[index];

    s_Data.InstanceBuffer.push_back({
        instance.Transform,
        glm::ivec4(instance.EntityID, 0, 0, 0)
    });
}
```

得到类似：

```
Instance 0 → Transform A, EntityID 17
Instance 1 → Transform B, EntityID 23
Instance 2 → Transform C, EntityID 31
```

### 上传动态 Instance Buffer

CPU 数组通过动态 VertexBuffer 上传 GPU：

```cpp
s_Data.InstanceVertexBuffer->SetData(
    s_Data.InstanceBuffer.data(),
    static_cast<uint32_t>(
        s_Data.InstanceBuffer.size()
        * sizeof(InstanceData)));
```

如果实例超过 1024 个，会自动分块：

```cpp
chunkEnd = min(
    chunkBegin + MaxInstancesPerDraw,
    batchEnd);
```

例如：

```
2500 个实例
→ 1024
→ 1024
→ 452
→ 共 3 次实例化 DrawCall
```

### 调用渲染抽象层

上传完成后调用：

```cpp
RenderCommand::DrawIndexedInstanced(
    item.MeshResource->GetVertexArray(),
    static_cast<uint32_t>(
        s_Data.InstanceBuffer.size()),
    item.MeshResource->GetIndexCount());
```

调用链第一层：RenderCommand.h

```cpp
s_RendererAPI->DrawIndexedInstanced(
    vertexArray,
    instanceCount,
    count);
```

这保证 Renderer3D 不直接依赖 OpenGL。

### OpenGL 后端发起 GPU 绘制

最终进入：OpenGLRendererAPI.cpp

```cpp
void OpenGLRendererAPI::DrawIndexedInstanced(
    const Ref<VertexArray>& vertexArray,
    uint32_t instanceCount,
    uint32_t indexCount)
{
    vertexArray->Bind();

    uint32_t count = indexCount
        ? indexCount
        : vertexArray->GetIndexBuffer()->GetCount();

    glDrawElementsInstanced(
        GL_TRIANGLES,
        count,
        GL_UNSIGNED_INT,
        nullptr,
        instanceCount);
}
```

这是真正提交给 GPU 的实例化命令。

例如：

```cpp
glDrawElementsInstanced(
    GL_TRIANGLES,
    36,     // Cube 索引数量
    GL_UNSIGNED_INT,
    nullptr,
    3);     // 绘制 3 个实例
```

一次 DrawCall 绘制三个 Cube。

### Shader 按实例读取 Transform

PBR 顶点 Shader：

```glsl
layout(location = 4) in mat4 a_InstanceTransform;
layout(location = 8) in ivec4 a_InstanceEntityData;

uniform mat4 u_Transform;
uniform int u_EntityID;
uniform int u_UseInstancing;
```

实例化时 Renderer3D 设置：

```cpp
shader->UploadUniformInt("u_UseInstancing", 1);
```

Shader 选择实例矩阵：

```glsl
mat4 transform = u_UseInstancing != 0
    ? a_InstanceTransform
    : u_Transform;
```

然后正常计算世界坐标：

```glsl
vec4 worldPosition =
    transform * vec4(a_Position, 1.0);

gl_Position =
    u_ViewProjection * worldPosition;
```

同一个 Mesh 顶点会被重复执行多次，但每个实例使用不同矩阵。

### Shader 输出实例 EntityID

顶点 Shader 同时选择 EntityID：

```glsl
v_EntityID = u_UseInstancing != 0
    ? a_InstanceEntityData.x
    : u_EntityID;
```

使用 `flat` 传给 Fragment Shader：

```glsl
layout(location = 3) flat out int v_EntityID;
```

片元阶段写入整数附件：

```glsl
layout(location = 1) out int o_EntityID;

o_EntityID = v_EntityID;
```

因此三个实例虽然共享同一次 DrawCall，Framebuffer 中仍然得到三个不同的 EntityID，鼠标拾取可以区分具体实体。

###  普通绘制回退

以下情况不会实例化：

- 批次只有一个对象
- Shader 不支持实例输入
- Mesh 不同
- 纹理不同
- 最终材质属性不同

回退路径：

```cpp
shader->UploadUniformInt(
    "u_UseInstancing", 0);

shader->UploadUniformMat4(
    "u_Transform", individual.Transform);

shader->UploadUniformInt(
    "u_EntityID", individual.EntityID);

RenderCommand::DrawIndexed(
    individual.MeshResource->GetVertexArray(),
    individual.MeshResource->GetIndexCount());
```

完整核心关系可以概括为：

```
Mesh VertexBuffer
    └─ 每顶点：Position/Normal/Tangent/UV

Instance VertexBuffer
    └─ 每实例：Transform/EntityID

两者共同挂在 Mesh VertexArray
    ↓
glDrawElementsInstanced
    ↓
GPU 对同一 Mesh 执行 N 个实例
    ↓
每个实例使用独立 Transform 和 EntityID
```

## 终极形态：GPU Driven

这次更新完成的是“CPU 组织批次、GPU 执行实例化绘制”。它还不是完整的 GPU Driven Rendering——可见性判断、排序和批次构建仍由 CPU 完成，但已经为后续大规模植被、岩石、地形装饰物和生态实例渲染建立了必要基础。