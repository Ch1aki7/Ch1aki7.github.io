---
title: Glimmer中内容浏览器的设计
cover: img/cover/Glimmer.png
top_img: false
toc: true
aside: true
categories: 游戏引擎
tags:
  - 引擎开发
  - 资产管理
  - ImGui
description: 记录 Glimmer Content Browser 从基础文件网格演进为可缩放资产工作区的过程，涵盖目录树、自绘图标、稳定排序、资产选择、右键创建及拖放工作流。
abbrlink: 468bd775
date: 2026-08-05 10:54:29
updated: 2026-09-10 15:30:00
keywords: Glimmer, Content Browser, ImGui, AssetManager, EditorAssetFactory, 资产管理, 游戏引擎
---

{% note info %}
本文按照 [Glimmer](https://github.com/Ch1aki7/Glimmer) `main` 分支更新，重点对应 2026 年 9 月 9 日的 Content Browser 改版（[`35235cf`](https://github.com/Ch1aki7/Glimmer/commit/35235cf)）。文中的早期界面截图用于说明演进过程，最新行为以仓库源码为准。
{% endnote %}

![](cover_468bd775.png "加入目录树后的早期 Content Browser")

Content Browser 最早只是编辑器里的文件入口：限定在 `assets/` 下浏览目录，根据扩展名显示图标，双击或拖拽 `.glimmer` 文件打开场景。

随着 Glimmer 增加 AssetHandle、材质资产、TerrainMaterial、Cubemap 和 Inspector，内容浏览器不再只是一个文件列表。它现在同时承担三个职责：

- 表达项目资产的目录结构和资源类型；
- 将文件选择转换为 AssetHandle，交给 SelectionContext 和 Inspector；
- 发起打开场景、创建资产、创建基础几何体和拖放应用等编辑器操作。

## 代码位置

内容浏览器仍位于编辑器工程

```text
GlimmerEditor-CyouBranch/src/
├─ Panels/
│  ├─ ContentBrowserPanel.h
│  ├─ ContentBrowserPanel.cpp
│  ├─ SelectionContext.h
│  └─ InspectorPanel.cpp
├─ Utils/
│  ├─ EditorAssetFactory.h
│  └─ EditorAssetFactory.cpp
└─ EditorLayer.cpp

Glimmer/src/Glimmer/Asset/
├─ AssetManager.h
└─ AssetManager.cpp
```

各层的分工比较清楚：

- `ContentBrowserPanel` 负责文件系统 UI、选择、双击和拖拽源；
- `EditorAssetFactory` 负责真正创建目录、资产模板与 OBJ 几何文件；
- `AssetManager` 将受支持的文件导入注册表并返回 AssetHandle；
- `SelectionContext` 统一实体与资产两类选择；
- `InspectorPanel` 根据 AssetType 显示和编辑资产；
- `EditorLayer` 处理打开场景以及文件拖到 Viewport 后的业务行为。

面板本身只保存少量运行时状态：

```cpp
std::filesystem::path m_BaseDir;
std::filesystem::path m_CurrentDir;
std::string m_SelectedFile;
float m_SplitPos = 200.0f;
float m_ItemScale = 0.25f;
```

通过回调把操作交给外层：

```cpp
std::function<void(AssetHandle)> OnAssetSelected;
std::function<void(const std::string&)> OnFileDoubleClicked;
```

## 旧版实现

### 延迟初始化

初版曾在构造函数中执行 `std::filesystem::absolute()`，紧接着遍历整个 `assets/`。这会让 `EditorLayer` 构造过程同步触发磁盘 I/O，项目资源一多，启动阶段就会出现可感知的停顿。

后来构造函数改回默认实现，路径只在第一次绘制面板时初始化：

```cpp
ContentBrowserPanel::ContentBrowserPanel() = default;

static void LazyInit(std::filesystem::path& base,
                     std::filesystem::path& current)
{
    if (!base.empty())
        return;

    base = std::filesystem::absolute("assets");
    current = base;
}
```

这个思路在新版中继续保留。它解决的是启动时机问题，并没有引入文件缓存：右侧文件区仍在绘制时通过 `directory_iterator` 读取当前目录，左侧目录树也会按展开层级访问文件系统。

### Font Awesome 图标

在[fontawesome](https://fontawesome.com/download)进行图标资源的下载，这里我使用的是otf类型，若有其它类型如图片格式的图标则需要用另一套方案。

![](IMG-20260910145441848.png)

早期文件区依赖 Font Awesome。ImGui 启动时通过 MergeMode 将图标字形合并进正文字体，文件夹、Shader、模型和图片都可以直接用 UTF-8 字符绘制：

```cpp
ImFontConfig config;
config.MergeMode = true;
config.GlyphMinAdvanceX = 16.0f;

static const ImWchar ranges[] = { 0xf000, 0xf2ff, 0 };
io.Fonts->AddFontFromFileTTF(
    "assets/fonts/FontAwesome/fa-solid-900.otf",
    16.0f,
    &config,
    ranges);
```

`MergeMode` 的好处是文字和图标可以共用一次 `ImGui::Text()`。私有区码点也可以直接写成 UTF-8 字节：

```cpp
#define ICON_FA_FOLDER "\xef\x81\xbb"
#define ICON_FA_GLOBE  "\xef\x82\xac"
```

![](IMG-20260805113835255.png "早期版本直接使用 Font Awesome Unicode")

这一方案实现简单，但图标与正文字号耦合。网格放大以后，继续放大字符会受字体清晰度、字形比例和字体资源限制。新版因此只在目录树中保留 Folder 和 Globe 两个 Font Awesome 字符，右侧文件区改为 DrawList 自绘图标。

### 固定网格与基础导航

旧版使用固定的 80 像素单元格，面板宽度决定列数：

```cpp
float cellSize = 80.0f;
int columns = std::max(1, (int)(panelWidth / cellSize));
ImGui::Columns(columns);

for (const auto& entry : std::filesystem::directory_iterator(m_CurrentDir))
{
    // 绘制固定大小的 Selectable
    ImGui::NextColumn();
}
```

导航栏通过 `m_BaseDir` 限制可见范围。回退按钮只允许从当前目录返回父目录，不能越过项目的 `assets/`：

```cpp
if (ImGui::Button(" ..") && m_CurrentDir != m_BaseDir)
    m_CurrentDir = m_CurrentDir.parent_path();

auto relative = std::filesystem::relative(m_CurrentDir, m_BaseDir);
ImGui::TextDisabled("assets/%s", relative.string().c_str());
```

后续加入的左侧目录树和可拖动分隔线也被新版保留下来。目录节点只展示文件夹，单击名称切换右侧目录，单击箭头展开层级；没有子目录的节点会增加 `Leaf` 和 `NoTreePushOnOpen` 标记。分隔线则用一个 4 像素宽的透明 Button 捕获水平拖动，将宽度限制在 120～500 像素。

### 场景拖放

第一版交互只关心 `.glimmer`。文件区创建名为 `SCENE_FILE` 的拖放载荷，Viewport 在渲染图片之后接收它：

```cpp
ImGui::SetDragDropPayload(
    "SCENE_FILE",
    absolutePath.c_str(),
    absolutePath.size() + 1);
```

Drop Target 必须放在 Viewport 的 `ImGui::Image()` 之后，因为 ImGui 会使用最后一个 Item 的矩形作为拖放目标。放在图片之前，命中区域就不会覆盖完整视口。

![](IMG-20260910150415434.gif "新版演示将 .glimmer 场景拖入 Viewport")

旧版到这里已经形成一条可用链路，但文件区更像带图标的资源管理器，还没有真正接入统一资产系统。

## 新版实现

重写了右侧内容区。新版重点解决四件事：缩放模式、图标表达、稳定排列，以及与资产编辑工作流的连接。

### 连续缩放与紧凑列表

新版用 `m_ItemScale` 表示显示密度，取值限制在 `0.0～1.0`。右下角滑块和文件区内的 `Ctrl + 鼠标滚轮` 会修改同一个值：

```cpp
if (ImGui::IsWindowHovered() && io.KeyCtrl && io.MouseWheel != 0.0f)
{
    m_ItemScale = glm::clamp(
        m_ItemScale + io.MouseWheel * 0.08f,
        0.0f,
        1.0f);
}
```

缩放最小值不是一个更小的网格，而是单行紧凑列表，类似Unity。其余区间使用 `glm::mix` 将 Item 尺寸映射到 72～160 像素：

```cpp
bool compact = m_ItemScale <= 0.0f;
float itemSize = glm::mix(72.0f, 160.0f, m_ItemScale);

int columns = compact
    ? 1
    : std::max(1, (int)((panelWidth + spacing)
        / (itemSize + spacing)));
```

![](IMG-20260910151109624.gif)

紧凑模式下，图标位于行首，文件名占用剩余宽度；网格模式下，大图标位于上方，单行文件名放在底部。这不是两套文件遍历逻辑，只是同一批 Entry 的两种布局。

为了让缩放滑块始终贴住面板底部，右栏又拆成两层 Child：

```text
FilePanel
├─ FileItems    仅这里允许纵向滚动
└─ ScaleSlider  固定在右下角
```

外层 `FilePanel` 禁止滚动，`FileItems` 的高度根据滑块顶部位置计算。这样文件数量变化时，滚动条不会把滑块一起推走。

### 文件名裁剪与完整提示

固定字符数不适合比例字体，也无法适应 72～160 像素的连续尺寸。新版使用 `ImGui::CalcTextSize()` 判断文件名是否超宽，再用 `CalcTextSizeA()` 找出当前像素宽度内能容纳的字符位置，最后追加 `...`。

```cpp
if (ImGui::CalcTextSize(name.c_str()).x > maximumWidth)
{
    const char* end = name.c_str();
    ImGui::GetFont()->CalcTextSizeA(
        ImGui::GetFontSize(),
        remainingWidth,
        0.0f,
        name.c_str(),
        nullptr,
        &end);
    label = std::string(name.c_str(), end) + "...";
}
```

视觉上只保留一行，鼠标悬停时通过 Tooltip 显示完整名称。文件名很长时不会挤乱网格，读者仍然能查看原始名称。

### 目录优先的稳定排序

`directory_iterator` 不承诺返回顺序。直接遍历会让条目随文件系统状态变化，也会把文件夹和文件混在一起。

新版先收集 Entry，再执行两级排序：

1. 文件夹排在普通文件前；
2. 同类条目按转换为小写的文件名排序。

```cpp
std::sort(entries.begin(), entries.end(),
    [](const auto& left, const auto& right)
    {
        if (left.is_directory() != right.is_directory())
            return left.is_directory();

        return Lowercase(left.path().filename().string())
             < Lowercase(right.path().filename().string());
    });
```

这一步不复杂，却直接改善了定位资产时的可预测性。重新进入目录后，相同文件仍然出现在相同位置。

### DrawList 自绘资源图标

新版右侧图标不再依赖 Font Awesome 字形，而是先根据路径得到 `ContentIconKind + Color`，再用 `ImDrawList` 绘制几何图元。

当前类型映射如下：

| 类型              | 扩展名                                 | 图形含义      |
| --------------- | ----------------------------------- | --------- |
| Folder          | 目录                                  | 黄色文件夹     |
| Shader          | `.glsl`、`.glslinc`、`.comp`          | 蓝色代码括号    |
| Model           | `.obj`、`.fbx`                       | 紫色网格轮廓    |
| Image           | `.png`、`.jpg`、`.jpeg`、`.tga`、`.bmp` | 绿色图片轮廓    |
| Scene           | `.glimmer`                          | 青色球形/场景符号 |
| Material        | `.glmat`                            | 橙色材质球     |
| TerrainMaterial | `.glterrainmat`                     | 绿色山体折线    |
| Skybox          | `.glsky`、`.hdr`                     | 蓝色球形符号    |
| File            | 其他文件                                | 灰色横线      |

扩展名会先转成小写，因此 `.FBX` 和 `.fbx` 在图标层得到相同结果。文件夹单独绘制页签和主体；普通文件先绘制带折角的纸张轮廓，再叠加不同的符号。例如材质使用圆形高光：

~~~cpp
drawList->AddConvexPolyFilled(fileShape.data(), 5, style.Color);
drawList->AddPolyline(fileShape.data(), 6, outline, 0, lineWidth);

drawList->AddCircleFilled(center, radius, detail, 20);
drawList->AddCircleFilled(highlightCenter, highlightRadius, highlight, 12);
~~~

DrawList 图标可以跟随 Item 尺寸连续缩放，不受字体字号限制，也不需要再引入一套位图缩略图资源。它目前表达的是“资产类型”，不是图片或模型的真实预览。

## 选择、双击与目录切换

新版仍使用一个覆盖整个条目的 `Selectable` 处理输入，图标和文字则通过 DrawList 画在其上。这样紧凑列表和网格模式共享完全相同的选择、双击、Tooltip 与拖拽命中区域。

单击文件后，面板先记录路径，再调用 AssetManager：

~~~cpp
m_SelectedFile = path.string();

if (!isDirectory && OnAssetSelected)
    OnAssetSelected(AssetManager::ImportAsset(path));
~~~

AssetManager 根据扩展名确定 AssetType，将新资产写入注册表；已经导入的路径直接返回现有 Handle。EditorLayer 收到 Handle 后更新 SelectionContext，并清空 Hierarchy 中的实体选择。

~~~text
ContentBrowserPanel
  -> AssetManager::ImportAsset(path)
  -> AssetHandle
  -> SelectionContext::SelectAsset(handle)
  -> InspectorPanel::DrawAssetInspector(handle)
~~~

SelectionContext 保证实体选择与资产选择互斥。单击 `.glmat` 后，Inspector 会进入共享 Material Asset 编辑；单击 TerrainMaterial 或 Cubemap，则进入各自的资产检查器。

双击行为与单击选择分开：

- 双击目录只切换 `m_CurrentDir`；
- 双击普通文件触发 `OnFileDoubleClicked(path)`；
- EditorLayer 当前只对 `.glimmer` 调用 `OpenScene()`。

旧版在目录双击后直接从渲染函数返回。新版改为先保存 `requestedDirectory`，等当前 Entry 循环结束后再更新目录：

~~~cpp
if (doubleClicked && isDirectory)
    requestedDirectory = path;

if (!requestedDirectory.empty())
    m_CurrentDir = requestedDirectory;
~~~

延迟提交避免了遍历旧目录时修改当前目录状态，也不需要提前处理多层 `PopID`、`EndChild` 和 `End`。

## 右键创建资产

![](IMG-20260910151244981.gif)

新版在文件区空白位置提供右键菜单。调用 `BeginPopupContextWindow` 时增加 `NoOpenOverItems`，因此右击已有条目不会误触创建菜单。

菜单目前包含：

~~~text
New Folder

Create Asset
├─ Material (.glmat)
├─ Terrain Material (.glterrainmat)
├─ Skybox (.glsky)
├─ Scene (.glimmer)
└─ Shader (.glsl)

Create Geometry
├─ Cube
├─ UV Sphere
└─ Plane
~~~

ContentBrowserPanel 只负责菜单和调用分发，文件内容由 `EditorAssetFactory` 生成。工厂为不同资产写入可解析的初始模板：

- Material 包含 BaseColor、纹理 Handle、Metallic、Roughness 和 AlphaMode 等默认字段；
- TerrainMaterial 创建 Grass、Soil、Rock、Snow 四层配置；
- Skybox 写入六面路径、分辨率和颜色空间；
- Scene 使用当前 Version 6 格式创建空实体列表；
- Shader 生成最小 Vertex/Fragment 模板；
- Cube、UV Sphere 和 Plane 直接生成带位置、UV、法线与三角面的 OBJ。

创建前会调用 `GetUniquePath()`。如果 `New Material.glmat` 已存在，新文件会依次命名为 `New Material (1).glmat`、`New Material (2).glmat`，不会覆盖已有资产。

创建成功后，文件立即成为当前选中项。除目录和 `.glimmer` 外，其他新文件还会立即执行 `AssetManager::ImportAsset()`。Scene 没有对应 AssetType，它由 EditorLayer 和 SceneSerializer 管理，因此不会进入普通资产注册表。

## 拖放已经不只用于场景

Payload 名称仍然叫 `SCENE_FILE`，但其中保存的是任意文件的绝对路径。它现在是内容浏览器与 Viewport、Inspector 之间的通用文件载荷。

Viewport 根据扩展名执行不同操作：

| 拖入文件 | 当前行为 |
| --- | --- |
| `.glimmer` | 调用统一的 `OpenScene()` |
| `.glterrainmat` | 应用到选中的 Terrain；没有合适实体时创建 Terrain |
| `.glsky`、`.hdr` | 应用到选中实体的 SkyLight；必要时创建 Sky Light |
| `.png`、`.jpg`、`.jpeg`、`.tga`、`.bmp` | 作为 HeightMap 创建一个非程序化 Terrain |

Inspector 也接收同一种 Payload。例如普通 Material 的 Shader 槽只接受 Shader Asset，纹理槽会根据用途写入 sRGB/Linear 与 Color/Normal/Data 语义；TerrainMaterial 的四层贴图槽采用相同流程。

拖放源只传路径，目标才决定“这个文件在当前区域代表什么”。这让 ContentBrowserPanel 保持通用，也把实体创建、组件赋值和场景切换留在 EditorLayer 或 Inspector 内。

## 当前实现的边界

新版已经足够用于当前 Glimmer 编辑流程，但代码里仍有一些明确边界：

- 文件列表每帧重新构造并排序，目录树还会额外扫描子目录；大型项目需要缓存、文件系统监听或显式刷新机制；
- `std::filesystem::directory_iterator` 没有统一的 `error_code` 保护，权限或损坏路径可能抛出异常；
- `assets/` 由当前 Working Directory 解析，启动目录错误会同时影响资产和字体；
- Payload 名为 `SCENE_FILE`，实际已承载多种资产，名称与职责不再一致；
- Content Browser 的图标匹配会将扩展名转为小写，EditorLayer 的部分扩展名判断仍直接比较字符串，大小写行为尚未完全统一；
- `.glslinc` 会显示 Shader 图标，但 AssetManager 目前只将 `.glsl` 和 `.comp` 注册为 Shader；
- 当前只有类型图标，没有纹理、材质和模型缩略图；
- 搜索、重命名、删除、复制、移动、刷新和文件变更通知仍未接入。

这些问题不妨碍当前功能，但会决定下一阶段应该优化 UI，还是先建立独立的 Asset Database。对资源量较小的自研引擎而言，即时扫描简单直接；当目录扩展到数万文件以后，再继续把扫描、导入和 UI 绘制绑在同一帧里就不合适了。
