# 本地说说

在此目录中新建 Markdown 文件即可发布说说，文件名只用于生成页面锚点，建议使用 `YYYY-MM-DD-主题.md`。

也可以使用以下命令生成一份带有常用字段的初始模板：

```powershell
npm run talk:new
```

命令会同时创建 Markdown 文件及其同名资源目录，内容和字段在生成的文件中直接编辑。

图片采用与 Hexo 文章资源目录相似的组织方式：Markdown 文件和同名目录放在一起。

```text
source/_talks/
├─ 2026-09-16-page-online.md
└─ 2026-09-16-page-online/
   └─ example.png
```

正文和 Front Matter 都可以直接使用相对于同名目录的路径：

```yaml
---
date: 2026-09-16 18:00:00
pinned: false
tags:
  - 开发记录
images:
  - example.png
music:
  type: song
  id: 28762386
location: Shanghai
device: Windows
---

正文中的图片：

![图片说明](example.png)
```

- `date` 为必填项，用于排序和显示时间。
- `pinned`、`tags`、`images`、`music`、`location` 和 `device` 均为可选项。
- `music.type` 支持 `song` 和 `playlist`，`id` 填写网易云音乐 ID。
- `images` 最多展示九张，点击图片时使用 Butterfly 灯箱查看。
- 构建时同名目录中的文件会自动发布到 `/shuoshuo/assets/<文件名>/`，无需在 Markdown 中填写该路径。
- 说说按置顶状态和发布时间倒序排列，默认每页展示 20 条；可通过 `_config.yml` 中的 `shuoshuo.per_page` 调整。
