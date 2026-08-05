---
title: 使用Unity Profiler进行GC定位
cover: img/cover/unity.png
top_img: false
toc: true
aside: true
date: 2026-06-10 16:03:45
categories: 工作记录
tags:
  - UnityProfiler
  - 性能优化
  - GC
description: 关于使用Unity内置的性能分析工具Unity Profiler进行的一次具体项目GC定位与修复。
keywords:
---

## 关于Unity Profiler

Unity Profiler是Unity自带的性能分析工具，功能强大，支持扩展可自定义统计数据，以下是官方文档中的说明：

![](IMG-20260805163351716.png "官方说明")

### Profiler 窗口

在 Unity Editor 中通过工具栏 **Window** > **Analysis** > **Profiler** 访问 Profiler 窗口。
我习惯直接ctrl+7然后把窗口拖到下方project同一层级面板中

![](IMG-20260805163601413.png)

### 深度性能分析 (Deep Profiling)

打开 **Deep Profile** 后，将分析所有的脚本代码，也就是说会记录所有函数调用。这有助于了解游戏代码中的确切时间使用情况。

请注意，深度性能分析会产生**非常大的开销**并占用大量内存，因此在性能分析时游戏的运行速度会明显变慢。如果脚本代码很复杂，可能根本无法进行深度性能分析。对于使用简单脚本编写的小游戏，深度性能分析应该足够快。如果发现整个游戏的深度性能分析导致帧率下降太多以至于游戏几乎无法运行，应考虑不使用此方法，而是使用下面描述的方法。在设计游戏并决定如何以最佳方式实现关键功能时，可能适合使用深度性能分析。请注意，对于大型游戏，深度性能分析可能会导致 Unity 耗尽内存，因此可能无法进行深度性能分析。

手动分析脚本代码块的开销比使用深度性能分析要小。使用 [Profiler.BeginSample](https://docs.unity.cn/cn/2019.1/ScriptReference/Profiling.Profiler.BeginSample.html) 和 [Profiler.EndSample](https://docs.unity.cn/cn/2019.1/ScriptReference/Profiling.Profiler.EndSample.html) 脚本函数可启用和禁用关于代码段的性能分析。

而此次的应用也将着重在deep profile进行。

## 进行实际应用

### 初步定位

此次在unity profiler中进行分析时发现了一处update中出现了大量GC的情况

![](IMG-20260805161238235.png)

上图是未开启Deep Profile的情况，可以看到函数后方有一个\[Invoke]，其下方包含GC.Alloc调用次数为2677次，这个占用还是比较大的。这里就需要开启Deep Profile进行具体的GC定位。

观察RoomLoop源码，这里主要对FixedUpdate()进行观察。

```cs
using UnityEngine;

namespace XGamePlay.Loop.Pipeline
{
    public class RoomLoop : MonoBehaviour, IRoomLoop
    {
        public IRoom Room { get; set; }
        
        private double m_LastLateUpdateTime;

        private void FixedUpdate()
        {
            Room.Update((int)(Time.fixedDeltaTime * 1000));
        }

        private void LateUpdate()
        {
            Room.LateUpdate(Time.unscaledDeltaTime);
        }
    }
}
```

可知Room是一个接口，应寻找具体实现类，继承自IRoom的

```cs
public interface IRoom : IRecyclable, IUpdatable
```

猜测寻找IUpdatable和具体的IRoom
Room更新逻辑：

```cs
public void Update(int delta)
{
	World?.Update(delta);
	
	// Convert milliseconds to seconds for the FSM update.
	Fsm.Update(delta / 1000f);

	if (Data is { IsPaused: true })
		return;
	ElapsedTime += delta;
}
```

包含world、fsm更新
观察具体代码，对比发现world更新逻辑

```cs
public void Update(int delta)
{
	Process();
	
	if (!IsProceed) return;
	delta = (int)(Timer.Step * Timer.Scale);
	m_Elapsed += delta;

	Profiler.BeginSample("GameWorld.Update");

	UpdateEntities();
	UpdateResult();

	if (!IsProceed) return;

	++Frame;
	Bullet.Update(delta);
	Buff.Update(delta);
	Skill.Update(delta);
	Loop.Update(delta);
	Attribute.Update(delta);

	Profiler.EndSample();
}
```

这些物件更新很有可能导致大量GC

`protected readonly List<Entity> m_Entities = new(128);`

这里重新运行，截取一个峰值帧

![](IMG-20260805164843318.png)

进入战斗时，RoomLoop.FixedUpdate()瞬间占用增加，耗时占主循环近50%，其中的GameWorld.Update()中，技能和子弹更新占大部分，时间占用相当，技能的内存空间占用大头。
技能系统的主要占用来自`m_World.ForEach(m_InvokeUpdate);`
World.ForEach()的占用下又主要是技能系统的UpdateEntity()，也就是`action(entity, ref component);`所导致

```cs
private void UpdateEntity(in Entity entity, ref StateComponent state)
{
	if (state.HasState(ActionState.Move)) return;
	var context = new Context(null, m_World.Elapsed);
	var behavior = m_World.GetComponent<BehaviorComponent>(entity);
	ProcessActiveSkills(behavior, context);
}

```

这里就初步定位到了技能系统和子弹系统的开销大头。

### 进一步定位

关于本次的GC定位，主要从以下几个方面来查找：临时List、字符串拼接、装箱拆箱、闭包和匿名函数等隐式堆分配源头，优化代码逻辑。

从上一节的初步定位已经可以一层一层的往下查找到最终的冗余GC，分为以下几类：

#### 字符串拼接

避免循环中使用 `+` 反复拼接字符串，因为字符串不可变，每次拼接都会创建新对象；改用 `StringBuilder` 或预分配缓冲区，减少临时字符串分配。

NormalArchetype.cs--ToString()

![](IMG-20260805165615672.png)

![](IMG-20260805165625847.png)

Buildin.GuidToAssetPath()，函数内的SubString()，获取资产路径。

![](IMG-20260805165705701.png)

![](IMG-20260805165712615.png)

修改后：

![](IMG-20260805165720604.png)

NodeCreator.cs--CreateBullet()--ToString()

![](IMG-20260805165952998.png)

![](IMG-20260805165956179.png)

修改后：

![](IMG-20260805170008408.png)

Skill.cs--`public override string Indexer`内部有一个Int32的ToString()

![](IMG-20260805170029903.png)

ResManagerEditor.cs--GetRealAssetPath()，return一个string.Format

![](IMG-20260805170043474.png)

#### 闭包

避免 Lambda 表达式或匿名函数捕获外部变量，因为编译器会生成闭包对象并分配到堆上；对于高频调用场景，可改为静态方法、缓存委托或避免变量捕获，从而减少隐式 GC。

BulletSystem.cs--CreateBullet()--闭包

![](IMG-20260805165814008.png)

![](IMG-20260805165819483.png)

EntityManager.cs--ShowEntityByCreation()--闭包

![](IMG-20260805165838000.png)

![](IMG-20260805165830809.png)

修改后：

![](IMG-20260805165853041.png)

DefaultGameAssetManager.cs--InstantiateGameObjectAsyncFromBundle()--闭包

![](IMG-20260805165908441.png)

![](IMG-20260805165912704.png)

#### List扩容

避免在高频逻辑中频繁 `new List<T>()`，通过复用对象、调用 `Clear()` 或使用对象池，减少临时堆对象的创建，从源头降低 GC 回收压力。

BehaviorComponent.cs--AddBullet()--List扩容

![](IMG-20260805165935377.png)

![](IMG-20260805165940026.png)

#### 装箱

避免值类型转换为 `object` 或非泛型接口时发生装箱，因为装箱会在堆上创建新的对象；优先使用泛型和强类型接口，减少堆分配和 GC。

NodeExtensions.cs--SetVariable<\T>() setvalue内部的obj参数

![](IMG-20260805170512016.png)

![](IMG-20260805170516562.png)

修改后：

![](IMG-20260805170524593.png)

#### 补充：对象池优化

对于频繁创建和销毁的对象（如子弹、特效、网络消息等），采用对象池重复利用实例，避免反复分配和回收对象，降低 GC 触发频率。
这一步源代码做的一般比较好，这里不再深究。