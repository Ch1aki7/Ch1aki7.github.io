---
title: 性能监测平台Server端数据链路分析
date: 2026-08-04 10:36:14
updated: 2026-08-04 13:37:28
categories: 工作记录
tags:
  - Server
  - Debug
cover: cover.png
top_img: false
description: 根据Edog性能监测平台进行一些调试与分析。
keywords:
toc: true
aside: true
---
![](cover.png)

经初步分析，完整的数据链路如下：

```txt
手机 SDK
  ├─ Module TCP：帧率、内存、温度、网络、GPU、场景等
  └─ Profiler TCP：CPU采样器、调用栈、GC、资源等
          ↓
ModuleDataSession / ProfilerDataSession
          ↓
CircularBuffer TCP粘包、拆包
          ↓
MsgBuffer 二进制读取
          ↓
ModuleDataAnalyzer / ProfilerDataAnalyzer
          ↓
按 GUID 分发给 In_*Message.ProcessData()
          ↓
明细缓存、峰值/均值/场景统计、CPU帧统计
          ↓
ReportProfiler 生成各种PHP请求参数
          ↓
data/{reportId}/report.dat
          ↓
DirectoryScanner 检测报告结束
          ↓
HTTP POST → datastatist.php
          ↓
PHP入库 → Web端查询展示
```

## Server启动

主线程读取 `Config.ini`，启动：

- Module端口：7500
- Profiler端口：7502
- 后台报告上传线程 `DirectoryScanner`

Config.ini中需要修改的有ProjectId，改为从edog登录页获取的项目Id，并将WebUrl改为本机IP，其他配置不变。
![](IMG-20260804104030317.png)

## Module连接

手机下载apk后，输入上一步对应IP进行连接：Server/EdogServer/ModuleDataSession.cs.OnConnected()，该部是由主线程的![](IMG-20260804105628047.png)
进行tcp连接从而进入
![](IMG-20260804105259736.png)
此时Server执行：

1. 生成 `reportId`
2. 创建 `data/{reportId}` 目录
3. 创建 `recording` 标志
4. 接收开始消息
5. 解析手机型号、Unity版本等
6. 创建共享的 `ReportInfo` 和 `ReportProfiler`
7. 写入报告头 `AddStatistData`

## Module内部解析

最重要的数据解析部分。
Module数据进入Server/EdogServer/Core/DataDecode/Analyzer/ModuleDataAnalyzer.cs
![](IMG-20260804105826857.png)
Server根据GUID分发至：

- `In_KFrameInfoMessage`
- `In_KDeviceInfoMessage`
- `In_KNetInfoMessage`
- `In_KMemoryInfoMessage`
- `In_KGpuInfoMessage`
- `In_KSceneInfoMessage`
- 其他模块
每个解析器通过 `MsgBuffer`读取字段，同时保存明细和更新最大值、总和等统计结果。
对该部分进行断点调试，可核对各变量与Buffer中的对应关系
![](IMG-20260804110529116.png)
结果正确，未出现多次skip导致数据丢失。

在之前测试报告中出现电池温度恒等于0的情况，现进行排查。
可知更新逻辑Server\EdogServer\Core\DataDecode\InMsg\Module\In_KDeviceInfoMessage.cs
![](IMG-20260804110804596.png)
逐个读取msgBuffer中的内容
![](IMG-20260804110916228.png)
断点调试对照buffer中的数据，发现batteryTemperature字段始终为0
![](IMG-20260804111115931.png)![](IMG-20260804112016293.png)
继续溯源到SDK采集阶段：Demo2021/Packages/src/com.cyou.tools.edog/Runtime/Module/DeviceInfoModule.cs
![](IMG-20260804112230427.png)
可见部分数据被硬编码为0，但是battery并没有
![](IMG-20260804112402147.png)
更深一步细节无法查看，但安卓底层库确实有这个接口，大概率不是这方面问题，另外从edog登录页的之前的测试报告发现，温度其实是可以正常采集的
![](IMG-20260804112706785.png)
因此偏向可能是硬件兼容问题，但到这一步我就不好验证了。

## Profiler连接

Profiler数据由Server/EdogServer/ProfilerDataSession.cs接收
它通过客户端IP找到对应的 `reportId`，与Module连接共享同一个 `ReportInfo`。
![](IMG-20260804112943993.png)
Profiler外层包格式为：

```txt
magicNumber
guid
dataSize
body
```

随后由Server/EdogServer/Core/DataDecode/Analyzer/ProfilerDataAnalyzer.cs按GUID分发，包括：

- CPU Profiler帧
- 采样器结构
- GC
- Log
- 资源快照
- 截图等
![](IMG-20260804113942825.png)
CPU帧累计超过30帧后生成一次 `AddCpuStackData`；采样器结构生成 `AddCpuStruct`。
![](IMG-20260804114508968.png)

## 报告结束

Module断开时调用 Server/EdogServer/Core/DataDecode/Report/ReportProfiler.cs
生成：

- 场景概览
- 左侧汇总指标
- GC统计
- CPU函数统计
- 表格数据
- 资源统计
- 剩余Module明细
- 报告尾信息
![](IMG-20260804114654281.png)

## 上传PHP

当Module和Profiler都断开后，`recording`标志被删除。
Server/EdogServer/DirectoryScanner.cs发现报告完成后：

1. 逐行读取 `report.dat`
2. 每行执行一次HTTP POST
3. 创建 `reported` 标志
4. 清理内存中的 `ReportInfo`
![](IMG-20260804114807778.png)
