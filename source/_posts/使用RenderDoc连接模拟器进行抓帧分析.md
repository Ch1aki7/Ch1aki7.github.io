---
title: 使用RenderDoc连接模拟器进行抓帧分析
cover: cover_79433343.png
top_img: false
toc: true
aside: true
categories: 工作记录
tags:
  - RenderDoc
  - 性能分析
  - Debug
description: 用RenderDoc在模拟器上对某手游中的人物特效进行抓帧分析。
abbrlink: '79433343'
date: 2026-07-30 14:09:47
updated: 2026-07-31 13:37:28
keywords:
---

使用的模拟器为MuMu模拟器12。

## 连接模拟器

打开设置，勾选`Allow global process hooking`

![](IMG-20260806141745625.png)

打开模拟器，在任务管理器确定进程的位置

![](IMG-20260806141958832.png)

再根据位置完善RenderDoc的设置

![](IMG-20260806142030826.png)

重启模拟器后左上角出现帧数则连接成功

![](IMG-20260806142233499.png)

## RenderDoc 功能介绍

这里借用公司前辈的性能优化文档中的截图做具体说明。

1. **Timeline**：能直观显示不同阶段（不透明，透明，天空盒，early-z，阴影通道等）所花费的时间。它同时会显示渲染目标的读/写，可以快速查看生成帧的方式是否会产生成本昂贵的解析成本。
	![](IMG-20260806143940984.png)
2. **Event Browser**：列出帧的所有API调用，主要用来查看DrawCall调用，选中单一的DrawCall，其他窗口也会有对应的改变显示，点击时钟可以查看调用的消耗时间。
	![](IMG-20260806144117442.png)
3. **Texture Viewer**：显示所选绘制的输入纹理和输出纹理（RT），单击单个纹理可以查看其格式/分辨率/可用的MIPS/MSAA级别等。可以用来查看Event Browser选中的Draw Call或者Pass的输入和输出纹理，右键点击右侧纹理还可以看到哪些DrawCall使用了这个纹理，点击可以跳转到Event Browser中的对应DrawCall。
	![](IMG-20260806144136038.png)
4. **Pipeline State**：选择任何管道状态以查看绑定资源的所有属性和材质属性（透明度/混合状态和纹理/采样器等），主要用来查看渲染管线的过程、使用的纹理、采样器、Constant Buffer变量等。
	![](IMG-20260806144155475.png)
5. **Mesh Viewer**：用于查看输入网络，同时查看顶点数量（可用于验证LOD系统是否有效）、屏幕控件中的后投影视图和顶点属性等。
	![](IMG-20260806144229950.png)
6. **API Inspector**：用于查看一些切换渲染状态的API调用，可以看到设置的Constant Buffer，展开可以看到具体的资源，点击可以跳转到Resource Inspector查看。
	![](IMG-20260806144336345.png)
7. **Resource Inspector**：显示渲染目标、临时缓冲区、纹理、着色器和网格等所有GPU相关资源的列表。Relate Resources中可以查看到所有引用到这一个资源的的EID（在Usage in Frame里），点击EID可以跳转到Event Brower中选中。
	![](IMG-20260806144353146.png)

## 进行抓帧分析

在特效发生附近时间点F12截图，成功后可以在RenderDoc打开快照进行分析。

比如说我要分析某一个特效，比如猴子的“定”，那么就翻到特效刚出现的附近时间点，查找相关的纹理

![](cover_79433343.png)

**定特效**：

![](IMG-20260806152658722.png)

**裂地特效**：

APP版本下存在11次DrawCall，应该是由11个ParticleSystem组成，在微信小游戏下做了删减，多个ParticleSystem合并成一个VAT+序列帧

![](IMG-20260806152747758.png)

![](IMG-20260806152759992.png)

![](IMG-20260806152812952.png)

![](IMG-20260806152845192.png)

![](IMG-20260806152854535.png)

![](IMG-20260806152905514.png)

**棍花特效**：

APP版本下存在10次DrawCall，应该是由10个ParticleSystem组成，在微信小游戏下多个ParticleSystem合并成一个VAT+序列帧

![](IMG-20260806152928608.png)

![](IMG-20260806152935598.png)

![](IMG-20260806153006127.png)

![](IMG-20260806153016235.png)

![](IMG-20260806153029071.png)

![](IMG-20260806153040134.png)

**大招特效**：

![](IMG-20260806153054641.png)

![](IMG-20260806153106635.png)