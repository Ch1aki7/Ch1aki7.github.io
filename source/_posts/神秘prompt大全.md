---
title: 神秘prompt大全
cover: cover_5eb1fd9b.png
top_img: false
toc: true
aside: true
abbrlink: 5eb1fd9b
date: 2026-08-06 10:15:17
categories: AIGC
tags:
  - AIGC
  - prompt
description: 对一些常用的prompt进行整理。
keywords:
---

## codex

虽然前些日子Tibo两三天重置一次额度，但是我基本都没吃到😅，因此有必要使用一些据说省token的方法。

其中一个就是使用luna max的子代理了，虽然好像刚出半天就被0731的梁叔叔击坠机了，但flash v4正式版出来前仍是世一模（性价比这块）。

参考以下的prompt，直接告诉你的codex就行：

```
请在 ~/.codex/agents/luna-worker.toml 创建一个全局自定义子代理。

配置要求：

- 代理名称：luna_worker
- 模型：gpt-5.6-luna
- 推理强度：max
- 定位：快速完成边界明确、可重复的小型任务
- 工作方式：严格遵守任务范围，独立执行，在可行时验证结果，并简洁汇报结果、相关文件路径和注意事项

请写入以下完整 TOML 配置：

name = "luna_worker"
description = "Fast worker for clear, narrowly scoped, and repeatable tasks."
developer_instructions = """
Handle the assigned task strictly within its stated scope.
Work independently and use appropriate tools when needed.
Verify the result when practical.
Do not make unrelated changes.
Return a concise summary containing the result, relevant file paths, verification performed, and any important caveats.
"""
model = "gpt-5.6-luna"
model_reasoning_effort = "max"

执行要求：

1. 如果 ~/.codex/agents 目录不存在，请创建它。
2. 如果目标文件已经存在，先显示现有内容，不要直接覆盖；确认内容是否需要更新。
3. 创建或更新后，读取文件并验证最终配置。
4. 确保 TOML 语法有效。
5. 最后告诉我文件位置、完整配置内容以及如何在提示词中调用 luna_worker。

------

创建后，使用方法如下：

> 请使用 luna_worker 子代理完成以下任务：[填写任务]。等待子代理完成后，检查并汇总它的结果。
```

个人体感下来，除了挺慢，确实挺省token的，适合不急的时候给他挂在一边用。但是可能会出现你sol叔叔主代理等急了强制结束luna子代理然后自己接管任务美美放生时间和token的情况，因此尽量不要把分析归纳的活交给luna，而是适合将强执行性的工作给luna处理

## image2

image2纯粹的强大，但是噪点和手部依然是老生常谈的问题，可以放进提示词求个心里安慰，不过大多数情况下，重新生成才是最有用的。

风格化通用模板：

```
画一张（）风格的海报，以（）中的角色（）为主题，重新设计角色姿势、表情和服饰，不要照搬参考图（要求画质4k，比例为适配电脑16:9的比例）（特定姿势）（特定表情）（特定服饰），符合人物性格。尽可能减少噪点
```

例如：

```
画一张赛璐璐动画风格的海报，以命运石之门中的角色牧濑红莉栖为主题，重新设计角色姿势、表情和服饰，不要照搬参考图（要求画质4k，比例为适配电脑16:9的比例） 姿势为双手自然地背后，表情带有俏皮或得意的微笑，符合人物性格。尽可能减少噪点
```

成果图：

![](IMG-20260806121847604.png "赛璐璐动画，猜猜为什么要求把手放背后")

```
画一张波普艺术主义风格的海报，以命运石之门中的角色牧濑红莉栖为主题，重新设计角色姿势、表情和服饰，不要照搬参考图（要求画质4k，比例为适配电脑16:9的比例） 动作姿势充满张力，表情带有俏皮或得意的微笑，符合人物性格。注意手部的作画正确性，尽可能减少噪点
```

成果图：

![](IMG-20260806122139459.png "波普艺术主义")
