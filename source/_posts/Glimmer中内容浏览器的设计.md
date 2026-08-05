---
title: Glimmer中内容浏览器的设计
cover: img/cover/Glimmer.png
top_img: false
toc: true
aside: true
date: 2026-08-05 10:54:29
updated: 2026-08-05 10:54:29
categories: 游戏引擎
tags:
  - 引擎开发
  - 资产管理
description: 在编辑器内提供文件系统浏览能力，支持导航 assets 目录、按类型区分文件图标、双击加载场景、拖拽 `.glimmer` 到视口即打开。
keywords:
---

![](cover.png)

## 架构设计

和 `SceneHierarchyPanel` 一样放在 `Panels/` 目录下——属于编辑器上层建筑而非引擎核心。

## 延迟初始化处理

初版设计中，在构造函数中调用 `std::filesystem::absolute()` + `directory_iterator` 遍历整个 assets 目录并缓存。这导致 EditorLayer 构造时同步触发磁盘 I/O，出现可感知的启动卡顿。
而之后采用了懒加载方案，明显改善加载卡顿。

```cpp
// 之前：构造函数中同步 I/O
ContentBrowserPanel() {
    m_BaseDir = std::filesystem::absolute("assets");  // 磁盘 I/O
    RefreshFiles();  // directory_iterator 遍历
}

// 之后：延迟到首个 OnImGuiRender
ContentBrowserPanel() = default;

void OnImGuiRender() {
    LazyInit(m_BaseDir, m_CurrentDir);  // 仅首次执行路径解析
    // 文件遍历改为每帧即时 directory_iterator（无预缓存）
}
```

```cpp
static void LazyInit(std::filesystem::path& base, std::filesystem::path& cur)
	{
		if (base.empty())
		{
			base = std::filesystem::absolute("assets");
			cur  = base;
		}
	}
```

## Font Awesome 图标集成

在[fontawesome](https://fontawesome.com/download)进行图标资源的下载，这里我使用的是otf类型，若有其它类型如图片格式的图标则需要用另一套方案。
![](IMG-20260805111743543.png)

```cpp
// 合并模式：在已有字体上附加图标 glyph
ImFontConfig faConfig;
faConfig.MergeMode = true;
faConfig.GlyphMinAdvanceX = 16.0f;
static const ImWchar faRanges[] = { 0xf000, 0xf2ff, 0 };
io.Fonts->AddFontFromFileTTF("assets/fonts/FontAwesome/fa-solid-900.otf", 16.0f, &faConfig, faRanges);
```

`MergeMode = true` 可以不替换已有字体，而是在同一个字体 atlas 中追加图标 glyph。渲染时可以用同一个 `ImGui::Text()` 同时显示文字和图标。

**图标码点**

在官网查找想要图标的Unicode，再转换为UTF-8，例如：
![](IMG-20260805112512362.png “右上Unicode为f07b”)

```
F07B = 1111 0000 0111 1011
```

即：

```
1111000001111011
```

因为：

```
U+F07B = 61563
```

它属于：

```
U+0800 ~ U+FFFF
```

所以 UTF-8 规定：

> 必须使用 **3 个字节** 编码。

UTF-8 对于 3 字节字符固定格式：

```
1110xxxx 10xxxxxx 10xxxxxx
```

然后将U+F07B拆成16位，填进上方的x中，得到：

```
1110 1111
10 000001
10 111011
```

再转换为16进制，也就是

```
11101111 = EF

10000001 = 81

10111011 = BB
```

同理可得：

```cpp
#define ICON_FA_FOLDER  "\xef\x81\xbb"
#define ICON_FA_CODE    "\xef\x87\x89"
#define ICON_FA_CUBE    "\xef\x86\xb2"
#define ICON_FA_IMAGE   "\xef\x80\xbe"
#define ICON_FA_GLOBE   "\xef\x82\xac"
#define ICON_FA_FILE    "\xef\x85\x9b"
```

但实际上，也可以直接写unicode，同样可以正常加载，我也是才知道，嘻嘻

![](IMG-20260805113835255.png "直接用unicode的写法")

## 设置布局

**网格布局**

```cpp
float cellSize = 80.0f;
int columns = max(1, (int)(panelWidth / cellSize));
ImGui::Columns(columns);

for (auto& entry : directory_iterator(m_CurrentDir)) {
    ImGui::Selectable(icon + " " + name, &selected, AllowDoubleClick, {80, 80});
    ImGui::NextColumn();
}
ImGui::Columns(1);
```

`ImGui::Columns` 实现自适应列数网格——面板宽时列数多，窄时列数少。

**导航栏回退按钮**

```cpp
// --- 导航栏 ---
if (ImGui::Button(" " ICON_FA_FOLDER " ..") && m_CurrentDir != m_BaseDir)
	m_CurrentDir = m_CurrentDir.parent_path();

ImGui::SameLine();
auto rel = std::filesystem::relative(m_CurrentDir, m_BaseDir);
ImGui::TextDisabled("assets/%s", rel.string().c_str());

ImGui::Separator();
```

`m_BaseDir` 作为不可逾越的根，回退到 `assets/` 之后按钮不再有作用，防止浏览到项目外。

**目录切换时的迭代器保护**

双击文件夹进入时，`m_CurrentDir` 被更新，但当前帧的 `for (auto& entry : directory_iterator(...))` 循环仍在运行。虽然后续迭代不会引发 UB（`directory_iterator` 不依赖外部容器），但提前退出可以避免一帧内既渲染旧目录又准备新目录的状态不一致：

```cpp
if (isDir) {
    m_CurrentDir = path;
    ImGui::PopID();
    ImGui::Columns(1);
    ImGui::End();
    return;  // 提前结束当前帧，下帧渲染新目录
}
```

## 拖拽打开场景

**拖拽源（ContentBrowserPanel）**

```cpp
if (!isDir && ImGui::BeginDragDropSource()) {
    ImGui::SetDragDropPayload("SCENE_FILE", path, size);
    ImGui::Text("Open %s", name);  // 光标跟随提示
    ImGui::EndDragDropSource();
}
```

**拖拽目标（EditorLayer Viewport）**

```cpp
if (ImGui::BeginDragDropTarget()) {
    if (auto* payload = ImGui::AcceptDragDropPayload("SCENE_FILE")) {
        SceneSerializer serializer(newScene);
        serializer.Deserialize(payload->Data);
    }
    ImGui::EndDragDropTarget();
}
```

Drop Target 必须放在 `ImGui::Image()` 之后——ImGui 的拖拽目标区域基于当前 item 位置决定。放在 Image 之前只覆盖标题栏区域，放在之后覆盖整个渲染画面。

![](IMG-20260805115239746.png "拖动.glimmer场景文件")

![](IMG-20260805115244270.png "成功加载场景")

## 补充：目录树实现

这一功能是之后添加的，用于更方便的参考目录层级。

```cpp
void DrawDirectoryTree(const std::filesystem::path& dir)
{
    for (auto& entry : directory_iterator(dir))
    {
        if (!entry.is_directory()) continue;

        ImGuiTreeNodeFlags flags = ImGuiTreeNodeFlags_OpenOnArrow
                                  | ImGuiTreeNodeFlags_SpanAvailWidth;
        if (!hasSubDirs)
            flags |= ImGuiTreeNodeFlags_Leaf;  // 无子目录 → 无箭头

        bool opened = ImGui::TreeNodeEx(name, flags);

        // 单击目录名（非箭头）切换右侧视图
        if (ImGui::IsItemClicked() && !ImGui::IsItemToggledOpen())
            m_CurrentDir = path;

        if (hasSubDirs && opened)
        {
            DrawDirectoryTree(path);  // 递归
            ImGui::TreePop();
        }
    }
}
```

- `IsItemToggledOpen()` 判断点击的是箭头还是名称：点击箭头 → 展开/折叠，点击名称 → 切换右侧视图
- 递归 `DrawDirectoryTree` 实现任意深度目录树

**可拖动分隔线**

```cpp
// 分隔线按钮（4px 宽）
ImGui::Button("##Splitter", ImVec2(4.0f, -1.0f));

if (ImGui::IsItemHovered())
    ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeEW);  // ↔ 光标

if (ImGui::IsItemActive())
    m_SplitPos += ImGui::GetIO().MouseDelta.x;          // 拖拽调整

m_SplitPos = clamp(m_SplitPos, 120.0f, 500.0f);        // 范围限制
```

分隔线本身是一个 `ImGui::Button`。`IsItemActive()` 在按住拖拽时为 true，`MouseDelta.x` 提供每帧水平位移。累加到 `m_SplitPos` 后 clamp 在 120~500px 区间。

**子目录检测优化**

```cpp
// 检查是否有子目录（决定是否显示箭头）
bool hasSubDirs = false;
for (auto& sub : directory_iterator(path))
    if (sub.is_directory()) { hasSubDirs = true; break; }
```

相比直接设置 Leaf 或 DefaultOpen，每级做一次轻量扫描来决定 TreeNode 形态，无子目录的节点不显示展开箭头。