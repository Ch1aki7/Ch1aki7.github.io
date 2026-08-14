---
title: Glimmer中实现 3D GPU Instancing 与材质实例缓存
cover: cover_1eddf29f.png
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
updated: 2026-08-07 15:43:45
keywords:
---

## 为什么需要GPU Instancing

在 Glimmer 的早期实现中，即使场景中存在多个完全相同的模型，`Renderer3D` 仍然会为每个实体分别提交一次 Draw Call。

例如，在场景中放置三个使用相同 Mesh、Shader、纹理和材质参数的 Cube，传统绘制方式需要执行三次Draw Call。

虽然三次绘制使用的是同一份网格数据，但 CPU 仍然需要重复完成状态检查、参数设置和绘制命令提交。随着树木、岩石、草地或建筑等重复对象不断增加，这部分 CPU 开销会迅速累积。

GPU Instancing 的目标是将兼容对象合并到同一次绘制调用中：三次绘制使用1 次 DrawIndexedInstanced

根据 [Unity GPU Instancing 文档](https://docs.unity3d.com/2022.2/Documentation/Manual/GPUInstancing.html)，GPU Instancing 可以通过少量 Draw Call 绘制同一 Mesh 的多个副本，同时允许每个实例拥有不同的 Transform、颜色或其他实例参数。

在 Glimmer 中，`Renderer3D` 会比较每个对象的：

- Mesh；
- Shader；
- BaseColor 纹理；
- 最终材质参数；
- Shader 是否支持实例输入。

只有完全兼容的对象才会进入同一个实例批次。

三个相同 Cube 因此可以从三次普通绘制下降为一次实例化绘制：

![](IMG-20260807162505580.png)

![](cover_1eddf29f.png "1000个cube测试")

![](IMG-20260809151251232.png "最终的2500实体压力测试，可见拆分成了三批")

## GPU Instancing的基本原理

普通顶点缓冲中的数据按照“每个顶点”更新：

```
Position
Normal
Tangent
TexCoord
```

而实例缓冲中的数据按照“每个实例”更新：

```
Transform
EntityID
```

两组数据共同挂载到同一个 VertexArray：

```
Mesh VertexBuffer
├─ Position
├─ Normal
├─ Tangent
└─ TexCoord

Instance VertexBuffer
├─ Transform
└─ EntityID
```

OpenGL 使用以下接口区分顶点属性和实例属性：

```
glVertexAttribDivisor(attribute, 1);
glDrawElementsInstanced(...);
```

`glVertexAttribDivisor(attribute, 1)` 表示该属性不是每处理一个顶点更新一次，而是每绘制一个实例更新一次。[Khronos OpenGL Vertex Specification](https://wikis.khronos.org/opengl/Vertex_Specification#Instanced_arrays)

因此，同一份 Cube 顶点数据可以被重复使用，而每个实例从 Instance Buffer 中读取不同的 Transform 和 EntityID。

## 与其他批处理方式的区别

GPU Instancing 和此前 Renderer2D 使用的批处理有相同目标：减少 Draw Call。但两者采用的方式不同。

Renderer2D 会在 CPU 端把多个 Quad 的顶点数据写入同一个动态缓冲，然后一次性绘制；GPU Instancing 则保留原始 Mesh，只额外上传每个实例的差异数据。

常见的 3D 批处理方式包括：

1. **动态合批**
    
    CPU 每帧将多个小型 Mesh 的顶点临时拼接到一起，适合数量不多且顶点较少的动态物体。
    
2. **静态合批**
    
    提前将不会移动的 Mesh 合并，适合建筑、地面和其他静态场景。
    
3. **GPU Instancing**
    
    重复使用同一个 Mesh，只上传每个实例独立的 Transform、EntityID 或材质参数，适合树木、岩石、植被和重复建筑。
    

Glimmer 本次实现采用的是第三种方式。

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

## Glimmer中的完整Instancing链路

完整数据流可以概括为：

```
Scene 遍历模型实体
    ↓
Renderer3D::SubmitModel
    ↓
解析 Model、Material 和 MaterialOverrides
    ↓
通过 MaterialInstance 得到最终材质状态
    ↓
为每个 Mesh 生成 RenderItem
    ↓
放入 Opaque/Mask RenderQueue
    ↓
根据 RenderKey 排序
    ↓
CanBatch 判断相邻项目是否兼容
    ↓
构造 InstanceData 数组
    ↓
上传动态 Instance VertexBuffer
    ↓
RenderCommand::DrawIndexedInstanced
    ↓
OpenGLRendererAPI::DrawIndexedInstanced
    ↓
glDrawElementsInstanced
    ↓
Shader 按实例读取 Transform 和 EntityID
```

这里最重要的变化是：`SubmitModel()` 只负责收集渲染数据，不立即调用 OpenGL。

真正的排序、合批和绘制发生在 RenderQueue 的 Flush 阶段。

### 实例数据结构

每个实例保存一个变换矩阵和实体编号：

```cpp
struct InstanceData
{
    glm::mat4 Transform{ 1.0f };
    glm::ivec4 EntityData{ -1, 0, 0, 0 };
};
```

其中：

```
Transform    → 模型的世界变换
EntityData.x → 当前实例的 EntityID
```

之所以使用 `glm::ivec4` 保存 EntityID，是为了满足 GPU 顶点属性的对齐要求，并为后续扩展其他实例数据保留空间。

### 实例输入频率

为了让渲染抽象层理解哪些属性属于顶点、哪些属性属于实例，`BufferElement` 增加了输入频率：

```cpp
enum class BufferInputRate
{
    PerVertex = 0,
    PerInstance
};
```

普通 Mesh 顶点使用 `PerVertex`：

```cpp
{
    { ShaderDataType::Float3, "a_Position" },
    { ShaderDataType::Float3, "a_Normal" },
    { ShaderDataType::Float3, "a_Tangent" },
    { ShaderDataType::Float2, "a_TexCoord" }
}
```

实例缓冲使用 `PerInstance`：

```cpp
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

### 初始化Instance Buffer

`Renderer3D` 初始化时创建一个动态 Instance Buffer：

```cpp
constexpr uint32_t MaxInstancesPerDraw = 1024;

s_Data.InstanceVertexBuffer = VertexBuffer::Create(
    MaxInstancesPerDraw
    * static_cast<uint32_t>(sizeof(InstanceData))
);
```

单次实例化绘制最多容纳 1024 个实例。超过这个数量时，Renderer3D 会自动拆分为多个批次。

例如：

```
2500 个兼容实例
    ↓
第 1 批：1024
第 2 批：1024
第 3 批：452
    ↓
总计 3 次 Instanced Draw Call
```

### Scene收集模型实体

编辑模式和运行模式共用同一套 Renderer3D 提交流程：

```cpp
Renderer3D::BeginScene(
    viewProjection,
    cameraPosition
);

auto modelView =
    m_Registry.view<
        TransformComponent,
        ModelRendererComponent
    >();

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
        material
            ? material->MaterialHandle
            : AssetHandle(0),
        static_cast<int>(
            static_cast<uint32_t>(entity)
        ),
        material
            ? &material->Overrides
            : nullptr
    );
}
```

这一阶段只负责把实体转换成渲染器可以处理的数据，不立即执行 Draw Call。

这样可以先收集完整场景，再根据材质和资源状态重新排序。

### MaterialInstance缓存

一个实体最终使用的材质参数来自两部分：

```
共享 MaterialProperties
        +
实体 MaterialOverrides
        ↓
最终 MaterialProperties
```

如果每帧都重新构造 `MaterialInstance` 并合并全部 Override，会产生不必要的重复计算。

因此 Renderer3D 使用以下组合建立缓存键：

```cpp
struct MaterialCacheKey
{
    int EntityID = -1;
    uint64_t MaterialHandle = 0;
};
```

提交模型时，Renderer3D 会比较共享材质状态和实体 Override：

```cpp
const MaterialCacheKey cacheKey{
    entityID,
    static_cast<uint64_t>(materialHandle)
};

auto [iterator, inserted] =
    s_Data.MaterialCache.try_emplace(cacheKey);

MaterialCacheEntry& cached = iterator->second;

const MaterialState baseState =
    material->GetState();

if (inserted
    || cached.BaseState != baseState
    || cached.Overrides != resolvedOverrides)
{
    const MaterialInstance instance(
        material,
        resolvedOverrides
    );

    cached.ShaderHandle =
        instance.GetShaderHandle();

    cached.Properties =
        instance.GetProperties();

    cached.BaseState = baseState;
    cached.Overrides = resolvedOverrides;
}
```

当共享材质和实体 Override 均未发生变化时，Renderer3D 可以直接复用缓存中的最终属性。

缓存解决的是“重复解析材质”的问题，而 GPU Instancing 解决的是“重复提交 Draw Call”的问题。两者作用在不同阶段，但共同减少了 CPU 端渲染开销。

### 为每个Mesh生成RenderItem

一个 Model 可能包含多个 Mesh，因此 `SubmitModel()` 会将模型展开成多个 `RenderItem`：

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
    item.HasBaseColorTexture =
        hasBaseColorTexture;

    s_Data.OpaqueQueue.emplace_back(
        std::move(item)
    );
}
```

每个 RenderItem 同时保存用于排序的 RenderKey：

```cpp
item.Key.Shader =
    static_cast<uint64_t>(shaderHandle);

item.Key.Material =
    static_cast<uint64_t>(materialHandle);

item.Key.Texture =
    texture->GetRendererID();

item.Key.Mesh =
    reinterpret_cast<uintptr_t>(mesh.get());

item.Key.MaterialState =
    MakeMaterialSortKey(properties);

item.Key.Entity =
    static_cast<uint32_t>(entityID);
```

因此，ECS 的实体遍历顺序不会直接决定 GPU 的绘制顺序。

### RenderQueue排序

在绘制 Opaque/Mask 队列之前，Renderer3D 会根据 RenderKey 排序：

```cpp
std::sort(
    s_Data.OpaqueQueue.begin(),
    s_Data.OpaqueQueue.end(),
    [](const RenderItem& left,
       const RenderItem& right)
    {
        return left.Key < right.Key;
    }
);
```

排序后的队列可能类似：

```
Cube   + PBR + Material A
Cube   + PBR + Material A
Cube   + PBR + Material A
Sphere + PBR + Material A
Cube   + PBR + Material B
```

前三个 Cube 在排序后相邻，并且使用相同的资源和最终材质状态，因此可以形成一个实例批次。

排序不仅服务于 GPU Instancing，也能减少 Shader 和纹理状态切换。

### CanBatch合批条件

两个 RenderItem 能否进入同一个实例批次，由 `CanBatch()` 判断：

```cpp
bool CanBatch(
    const RenderItem& left,
    const RenderItem& right)
{
    return left.ShaderResource
            == right.ShaderResource
        && left.TextureResource
            == right.TextureResource
        && left.MeshResource
            == right.MeshResource
        && left.Material
            == right.Material
        && left.HasBaseColorTexture
            == right.HasBaseColorTexture;
}
```

合批要求包括：

- Shader 相同；
- Mesh 相同；
- 实际绑定纹理相同；
- 最终材质参数完全一致；
- BaseColor 纹理启用状态一致。

即使两个实体引用同一个 Material Asset，只要其中一个实体通过 MaterialOverrides 修改了 Roughness、Metallic 或 BaseColor，它们也会被拆分到不同批次。

Renderer3D 从当前 RenderItem 向后扫描：

```cpp
size_t batchEnd = itemIndex + 1;

while (batchEnd < s_Data.OpaqueQueue.size()
    && CanBatch(
        item,
        s_Data.OpaqueQueue[batchEnd]))
{
    ++batchEnd;
}
```

最终得到半开区间：

```
[itemIndex, batchEnd)
```

### 检查Shader是否支持实例化

批次中存在多个对象，并不意味着一定能使用 GPU Instancing。Shader 还必须声明对应的实例输入。

```cpp
if (batchSize > 1
    && item.ShaderResource->SupportsInstancing())
{
    // GPU Instancing
}
else
{
    // 普通 DrawIndexed 回退
}
```

OpenGL Shader 在初次链接和热重载后检查实例化契约：

```cpp
void OpenGLShader::UpdateCapabilities()
{
    m_SupportsInstancing =
        m_RendererID != 0
        && glGetAttribLocation(
            m_RendererID,
            "a_InstanceTransform") >= 0
        && glGetAttribLocation(
            m_RendererID,
            "a_InstanceEntityData") >= 0
        && glGetUniformLocation(
            m_RendererID,
            "u_UseInstancing") >= 0;
}
```

PBRModel Shader 满足这套契约，因此可以实例化。

不包含这些输入的 Phong 等旧 Shader 不会被强制实例化，也不会导致 Shader 编译失败，而是自动回退到普通 `DrawIndexed()`。

### 将Instance Buffer挂载到Mesh VAO

实例数据需要和模型顶点数据同时提供给 Vertex Shader，因此 Instance Buffer 会被添加到当前 Mesh 的 VertexArray。

```cpp
EnsureInstanceInput(
    item.MeshResource->GetVertexArray()
);
```

添加前会检查该 Buffer 是否已经存在：

```cpp
const auto& buffers =
    vertexArray->GetVertexBuffers();

if (std::find(
        buffers.begin(),
        buffers.end(),
        s_Data.InstanceVertexBuffer)
    == buffers.end())
{
    vertexArray->AddVertexBuffer(
        s_Data.InstanceVertexBuffer
    );
}
```

Instance Buffer 只需要添加一次，之后更新 Buffer 内容即可，不需要每帧重复修改 VAO 结构。

### Vertex Attribute布局

模型本身占用以下位置：

```
location 0：Position
location 1：Normal
location 2：Tangent
location 3：TexCoord
```

实例数据占用：

```
location 4：Transform 第 1 列
location 5：Transform 第 2 列
location 6：Transform 第 3 列
location 7：Transform 第 4 列
location 8：EntityData
```

GLSL 中的一个 `mat4` 会占用四个连续的 Vertex Attribute Location，因此实例矩阵必须拆成四个 `vec4` 进行设置。

### OpenGL设置逐实例属性

对于矩阵属性，OpenGL 后端按列创建 Vertex Attribute：

```cpp
for (uint32_t column = 0;
     column < columnCount;
     ++column)
{
    glEnableVertexAttribArray(
        m_VertexBufferIndex
    );

    glVertexAttribPointer(
        m_VertexBufferIndex,
        columnCount,
        GL_FLOAT,
        GL_FALSE,
        layout.GetStride(),
        offset
    );

    glVertexAttribDivisor(
        m_VertexBufferIndex,
        1
    );

    ++m_VertexBufferIndex;
}
```

EntityID 属于整数输入，因此需要使用整数版本：

```cpp
glVertexAttribIPointer(...);
glVertexAttribDivisor(attribute, 1);
```

Divisor 的区别可以概括为：

```
divisor = 0
    → 每处理一个顶点读取下一项

divisor = 1
    → 每绘制一个实例读取下一项
```

### 构造InstanceData数组

Renderer3D 从当前批次中提取每个实体的实例数据：

```cpp
s_Data.InstanceBuffer.clear();

for (size_t index = chunkBegin;
     index < chunkEnd;
     ++index)
{
    const RenderItem& instance =
        s_Data.OpaqueQueue[index];

    s_Data.InstanceBuffer.push_back({
        instance.Transform,
        glm::ivec4(
            instance.EntityID,
            0,
            0,
            0
        )
    });
}
```

生成的数据类似：

```
Instance 0 → Transform A，EntityID 17
Instance 1 → Transform B，EntityID 23
Instance 2 → Transform C，EntityID 31
```

### 上传动态Instance Buffer

构造完成后，CPU 数组被上传到 GPU：

```cpp
s_Data.InstanceVertexBuffer->SetData(
    s_Data.InstanceBuffer.data(),
    static_cast<uint32_t>(
        s_Data.InstanceBuffer.size()
        * sizeof(InstanceData)
    )
);
```

如果批次超过 1024 个实例，则自动分块：

```cpp
const size_t chunkEnd = std::min(
    chunkBegin + MaxInstancesPerDraw,
    batchEnd
);
```

这种设计可以限制单次动态上传的大小，同时支持任意数量的实例。

### 调用渲染抽象层

实例数据上传完成后，Renderer3D 通过渲染抽象层提交绘制：

```cpp
RenderCommand::DrawIndexedInstanced(
    item.MeshResource->GetVertexArray(),
    static_cast<uint32_t>(
        s_Data.InstanceBuffer.size()
    ),
    item.MeshResource->GetIndexCount()
);
```

`RenderCommand` 将调用转交给当前 RendererAPI：

```cpp
s_RendererAPI->DrawIndexedInstanced(
    vertexArray,
    instanceCount,
    indexCount
);
```

这样 Renderer3D 不需要直接依赖 OpenGL API，也为后续接入其他图形后端保留了接口边界。

### OpenGL发起实例化绘制

最终调用进入 `OpenGLRendererAPI`：

```cpp
void OpenGLRendererAPI::DrawIndexedInstanced(
    const Ref<VertexArray>& vertexArray,
    uint32_t instanceCount,
    uint32_t indexCount)
{
    vertexArray->Bind();

    const uint32_t count = indexCount
        ? indexCount
        : vertexArray
            ->GetIndexBuffer()
            ->GetCount();

    glDrawElementsInstanced(
        GL_TRIANGLES,
        count,
        GL_UNSIGNED_INT,
        nullptr,
        instanceCount
    );
}
```

例如，绘制三个 Cube：

```cpp
glDrawElementsInstanced(
    GL_TRIANGLES,
    36,                 // Cube 的索引数量
    GL_UNSIGNED_INT,
    nullptr,
    3                   // 实例数量
);
```

一次 Draw Call 即可绘制三个位于不同位置的 Cube。

### Shader读取实例Transform

PBRModel 顶点 Shader 声明实例输入：

```glsl
layout(location = 4)
in mat4 a_InstanceTransform;

layout(location = 8)
in ivec4 a_InstanceEntityData;

uniform mat4 u_Transform;
uniform int u_EntityID;
uniform int u_UseInstancing;
```

实例化绘制前，Renderer3D 设置：

```cpp
shader->UploadUniformInt(
    "u_UseInstancing",
    1
);
```

Shader 根据绘制模式选择变换矩阵：

```glsl
mat4 transform =
    u_UseInstancing != 0
        ? a_InstanceTransform
        : u_Transform;
```

之后使用该矩阵计算世界坐标：

```glsl
vec4 worldPosition =
    transform
    * vec4(a_Position, 1.0);

gl_Position =
    u_ViewProjection
    * worldPosition;
```

同一个 Mesh 的顶点会为每个实例执行一次，但每个实例使用独立的 Transform。

### 保留实例EntityID

Instancing 不能破坏编辑器的鼠标拾取功能，因此每个实例还需要拥有独立的 EntityID。

顶点 Shader 根据绘制模式选择 EntityID：

```glsl
v_EntityID =
    u_UseInstancing != 0
        ? a_InstanceEntityData.x
        : u_EntityID;
```

使用 `flat` 插值传递到 Fragment Shader：

```glsl
layout(location = 3)
flat out int v_EntityID;
```

片元阶段将其写入整数附件：

```glsl
layout(location = 1)
out int o_EntityID;

o_EntityID = v_EntityID;
```

因此，三个 Cube 即使共享同一次 Draw Call，Framebuffer 中仍会写入三个不同的 EntityID，编辑器可以准确识别被点击的实例。

### 普通绘制回退

以下情况不会进入 GPU Instancing：

- 批次中只有一个对象；
- Shader 不支持实例输入；
- Mesh 不同；
- 纹理不同；
- 最终材质参数不同；
- 对象属于需要独立排序的 Blend 透明队列。

回退路径设置普通 Uniform：

```cpp
shader->UploadUniformInt(
    "u_UseInstancing",
    0
);

shader->UploadUniformMat4(
    "u_Transform",
    individual.Transform
);

shader->UploadUniformInt(
    "u_EntityID",
    individual.EntityID
);

RenderCommand::DrawIndexed(
    individual.MeshResource
        ->GetVertexArray(),
    individual.MeshResource
        ->GetIndexCount()
);
```

这种回退机制保证新旧 Shader 可以同时存在，不要求一次性重写全部材质。

### 与透明渲染队列的关系

加入材质 AlphaMode 后，GPU Instancing 仍主要用于 `Opaque` 和 `Mask` 队列。

```
Opaque / Mask
    → 状态排序
    → 相同资源和材质合批
    → GPU Instancing

Blend
    → 按相机距离由远到近排序
    → 独立 DrawIndexed
```

透明 Blend 对象需要保持从远到近的绘制顺序。将多个透明实体直接合并为一个实例批次，会破坏这一顺序，因此当前版本不对 Blend 队列进行实例化。

Mask 材质虽然包含透明区域，但低 Alpha 片元会直接 `discard`，其余片元仍按照不透明物体写入深度，因此可以继续参与 Instancing。

### 终极形态：GPU Driven Rendering

当前版本完成的是：

```
CPU 负责：
实体遍历、可绘制项收集、材质解析、排序和批次构建

GPU 负责：
读取实例数据并执行实例化绘制
```

它还不是完整的 GPU Driven Rendering。

当前的可见性判断、RenderQueue 排序和实例批次构建仍由 CPU 完成。进一步演进可能包括：

- GPU Frustum Culling；
- GPU Occlusion Culling；
- Compute Shader 构建可见实例列表；
- Indirect Draw；
- Multi-Draw Indirect；
- GPU Driven LOD；
- 按材质和 Mesh 在 GPU 端生成 Draw Command。

不过，GPU Instancing 已经建立了最重要的基础能力：将 Mesh 数据与实例数据分离，并让 Renderer3D 可以用一次 Draw Call 绘制大量重复对象。

这为后续的植被、岩石、地形装饰物和大规模生态实例渲染提供了必要基础。