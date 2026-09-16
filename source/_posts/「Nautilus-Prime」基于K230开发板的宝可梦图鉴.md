---
title: 「Nautilus-Prime」基于K230开发板的宝可梦图鉴
cover: cover_3e4476bf.png
top_img: false
toc: true
aside: true
abbrlink: 3e4476bf
date: 2025-09-20 12:24:32
updated: 2026-09-16 15:57:05
categories: 嵌入式开发
tags:
  - K230
  - STC-B
  - 图像分类
  - 串口通信
description: 记录 Nautilus-Prime 如何让 K230 负责宝可梦图像分类和界面渲染，让 STC-B 负责传感器、数码管与反馈，并复盘模型部署、图鉴查询和双板串口联动中的实际问题。
keywords: Nautilus-Prime, K230, CanMV, STC-B, YOLOv5, 宝可梦图鉴, UART
sticky: 10
---
{% note info %}
完整源码、使用说明及最新版本请参见：<i class="fa-brands fa-github"></i>[Nautilus-Prime](https://github.com/Ch1aki7/Nautilus-Prime)
{% endnote %}

![](cover_3e4476bf.png "最终双板连接效果")

本项目的诞生方式比较神秘，因学校小学期大作业要求需要使用自己焊的STC-B板，所以需要想一种方法使得STC-B与手边的K230有机结合。K230-CanMV：能接摄像头、跑模型、驱动 800×480 的屏幕，但单独使用又少了一些实体交互。于是有了 Nautilus-Prime，一台可以拍摄、识别、查询宝可梦，也会随着摇晃、磁铁和按键做出反应的桌面图鉴。

<div align="center" style="font-size: 2.2em; font-weight: bold; margin: 0.67em 0;">「Pokémon、GETだぜ！」</div>

{% music 28762386 %}

## 职责分析

K230 是主控和显示端：采集摄像头画面、运行 YOLOv5 分类模型、读取图鉴数据，并用 CanMV 的 `image`/`media.display` 绘制界面。STC-B 是事件与反馈端：读振动、霍尔、按键、DS1302 时钟和 ADC，驱动 LED、蜂鸣器、数码管及音乐。两端用 UART2 以 115200 baud 通信。

```text
摄像头 → K230：拍照 / 分类 / 图鉴数据 / LCD
              ↕ UART2
振动、霍尔、按键、RTC、ADC → STC-B → LED、蜂鸣器、数码管、音乐
```

这样分工有一个现实原因：分类推理和整屏刷新不适合放在 STC-B 上；反过来，K230 如果还要轮询所有传感器并负责每个声光效果，主循环会更难维护。比如“摇一摇换一只宝可梦”由 STC-B 发现振动事件，K230 收到通知后更新图鉴索引；“查看时间”则由 K230 请求，STC-B 读取 DS1302 并同时更新自己的数码管。

## K230侧

### 渲染画面

最初试过 LVGL：按钮、动画、触摸输入和字体都有现成组件。但在这次短周期开发里，LVGL 的对象与事件模型、CanMV 上的 MicroPython 接口，以及摄像头画面和绘图缓冲的配合，反而让简单的菜单迭代变慢。最后改用板载媒体库，在一张 `RGB565` 画布上直接绘制文字、矩形和图片，再整帧显示。

```python
img = image.Image(DISPLAY_WIDTH, DISPLAY_HEIGHT, image.RGB565)
Display.init(Display.ST7701, width=DISPLAY_WIDTH, height=DISPLAY_HEIGHT, to_ide=True)
MediaManager.init()

while True:
    # 根据 flag 绘制当前页面，处理触摸与按键
    Display.show_image(img)
```

![](IMG-20260915175659479.png "主界面")

项目只有几类固定页面，直接绘制能迅速确定布局和刷新顺序；代价则是控件状态、页面切换和触摸消抖都要自己写。主程序用 `flag` 标记页面：`-1` 为首页，`1` 为拍摄，`2` 为手动查询，`0` 为识别结果及图鉴详情，`10` 为“希卡之石”入口，`11`～`16` 为它的子功能。`menu_collect` 记录高亮项。五向按键通过“当前值为 0、上次值为 1”的下降沿判定一次按压，触摸则借助定时器标志避免同一次触碰反复触发。

这种 `flag` 式状态机对课程项目够直接，但页面越来越多后，条件分支已经很长。后续如果继续扩展，应把页面的进入、更新、退出和资源释放拆成独立模块，而不是继续叠加 `if flag == ...`。因为我在写文章时都把flag对应忘光了，如果时间充裕最好对变量进行优雅的命名或记录。

### 图鉴查询

其实相比于直接进行模型的训练，我下一步做的是图鉴查询入口。手动查询页有虚拟 QWERTY 键盘，输入拼音后先做前缀匹配；结果不够十条时再补包含匹配，最终显示前十条候选。这让没有可拍摄目标时也能浏览图鉴。源码中查询索引和模型索引最终都落到同一组编号、英文目录名上，因此详情页可以复用。

```python
pinyin_results = [i for i, pinyin in enumerate(pinyin_list)
                  if pinyin.startswith(input_text)]
if len(pinyin_results) < 10:
    pinyin_results += [i for i, pinyin in enumerate(pinyin_list)
                       if not pinyin.startswith(input_text)
                       and input_text in pinyin]
pinyin_results = pinyin_results[:10]
```

![](IMG-20260915175958384.png "查询界面")

详情页再按编号推算世代，读取 `/data/gen{gen}/{四位编号}{英文名}/inform.txt`，绘制名称、属性、身高、体重、种族值和动态立绘。

图鉴怎么能没有对照呢，由于硬件设备的局限，而爬虫爬的图又全是jpg，板子说压缩文件不能调用draw_image我真呵呵了。结果采用ffmpeg的强大转换功能实现转为bmp，采用循环播放图片来显示gif。播放时逐帧读取并循环索引：

```python
frame = image.Image(frame_path)  # 实际路径指向 gif-jpg/{current_frame+1}.bmp
img.draw_image(frame, 10, 250, 3, 3, alpha=256)
current_frame = (current_frame + 1) % gif_count
del frame
gc.collect()
```

![](IMG-20260915180138257.png "接入训练模型后的图鉴播放")

且这里的 `current_frame` 必须在随机选择、查询选择和左右切换宝可梦时归零，否则新目录可能没有旧索引对应的帧。这是开发末期花了不少时间才找出的错误。逐帧读 BMP 虽然简单，但也造成帧间隔不稳、内存占用高；详情页的其它文件读取同样偏频繁。此外，拼音表与 `inform.txt` 的若干字段是通过 `eval()` 解析的，只有在资源文件完全可信时才勉强可用，后续更适合换成结构化、可校验的数据格式。做成长期运行的设备时，预加载少量帧、缓存图鉴元数据、减少不必要的整页重绘会比继续堆 `gc.collect()` 更有效。

### yolov5分类任务

训练时我曾先试过 YOLO 的检测任务，后来选择分类：图鉴的目标是判断画面中主要是哪一只宝可梦，不需要框出多只目标。

![](IMG-20260916153756847.png "windows下CUDA+PyTorch配置成功")

![](IMG-20260916153834017.png "训练过程")

用**`tensorboard`**监控进度

上课训一半下课ctrl+c了，回去发现原文件不能resume，气笑了

![](IMG-20260916153939033.png)

模型覆盖前 386 类，训练后通过 NNCase 转为 K230 可运行的 `kmodel`，主程序从 `/data/best.kmodel` 加载，输入尺寸为 224×224。训练集按分类任务的“类别目录”组织，开发日志里保留的关键命令是：

```bash
python classify/train.py --model yolov5n-cls.pt --data 1-3data_sorted \
  --epochs 100 --batch-size 8 --imgsz 224 --device '0'
python export.py --weight runs/train-cls/exp/weights/best.pt \
  --imgsz 224 --batch 1 --include onnx
python to_kmodel.py --target k230 --model best.onnx --dataset ../test \
  --input_width 224 --input_height 224 --ptq_option 0
```

最后一步需要安装与板端匹配的 NNCase/`nncase-kpu`，且这里的 `best.onnx` 和数据集路径要按实际目录调整。训练与转换过程并不在 K230 上进行；板端只加载最终产物。README 中的单图测试示例使用 `0.5` 置信度阈值，而最终主程序使用 `0`，这一差异也会影响实际展示行为。

运行时的数据路径容易被代码里那个 `/data/test/0001.jpg` 误解为“只识别固定测试图”。实际上，按下确认键时先把**当前摄像头帧**保存到这个路径，紧接着再读取刚保存的图像做推理：

```python
# 拍摄页：确认键触发
flag = 0
captured_img.save("/data/test/0001.jpg")
yolo_flag = 1

# 识别页：一次性消费推理标志
if flag == 0 and yolo_flag == 1 and read_init_flag == 0:
    yolo_flag = 0
    test_img, test_img_ori = read_image("/data/test/0001.jpg")
    rgb888p_size = [test_img.shape[2], test_img.shape[1]]
    yolo = YOLOv5(task_type="classify", mode="image",
                  kmodel_path=kmodel_path, labels=pokemon_lables,
                  rgb888p_size=rgb888p_size,
                  model_input_size=[224, 224], conf_thresh=confidence_threshold)
    yolo.config_preprocess()
    res = yolo.run(test_img)
    yolo.deinit()
    gc.collect()
```

`yolo_flag` 的作用是把一次按键变成一次推理，避免结果页的每次绘制都重新加载模型。`res[0]` 是分类索引，`res[1]` 是模型返回的分数；索引加一后，既能得到四位图鉴编号，也能找到 `pokemon_linkname` 对应的数据目录。分类完成后显式 `deinit()` 并回收内存，是为了降低频繁切页时的内存压力。

部署完成后的训练成果展示，小数为置信度：

![](IMG-20260916154036993.png)
![](IMG-20260916154435900.png)

![](IMG-20260916154037004.png)
![](IMG-20260916154421222.png)

![](IMG-20260916154037049.png)
![](IMG-20260916154410879.png)

这里还有一处需要补充：仓库代码把 `confidence_threshold` 设为 `0`，结果页会直接展示第一候选及其分数，没有“低置信度时提示重拍”的判断。设计报告中的“正拍、光照充足场景下识别成功率可达 90% 以上”和“双板延迟在 100 ms 内”是该次项目测试的结论，并非在不同环境、不同目标上都成立的保证。报告同时记录：斜拍、小目标和弱光情况下，准确率会明显下降，有些场景低于 60%。224×224 的输入缩放、类别样本不均衡以及真实拍摄条件与训练图像的差异，都是比单纯调高分数阈值更需要解决的问题。

## 串口协议

如果说 K230 负责“看见并理解”，STC-B 负责的就是“感知并回应”。两块板之间使用 UART2 通信，参数为 115200 baud、8 位数据位、无校验、1 位停止位。K230 会把当前页面和操作发给 STC-B，STC-B 则把振动、霍尔和按键等硬件事件送回 K230。

![](IMG-20260916152943592.png "希卡之石功能菜单")

两端消息都以 `0xAA 0x55` 作为识别标记，但方向不同，数据长度和字段含义也不同。当前实现中常用的消息如下：

| 方向 | 数据 | 含义 |
| --- | --- | --- |
| K230 → STC-B | `AA 55 00 xx` | 主菜单状态，`xx` 为当前选项 |
| K230 → STC-B | `AA 55 01 04` | 进入拍摄页，切换 LED 效果 |
| K230 → STC-B | `AA 55 03 01` | 识别完成，触发成功反馈 |
| K230 → STC-B | `AA 55 10 xx` | “希卡之石”菜单状态 |
| K230 → STC-B | `AA 55 11 01` | 请求 RTC 时间 |
| K230 → STC-B | `AA 55 13 01` | 请求 ADC 数据 |
| STC-B → K230 | `AA 55 01` | 检测到振动 |
| STC-B → K230 | `AA 55 02 / 03` | 磁体靠近 / 离开 |
| STC-B → K230 | `AA 55 04 / 05` | 音乐播放 / 暂停 |

K230 发送菜单状态的代码很直接：

```python
# 0x00 表示主菜单，0x01 表示当前选中 Detect
uart.write(bytes([0xAA, 0x55, 0x00, 0x01]))

# 进入识别结果页后，通知 STC-B 播放声光反馈
uart.write(bytes([0xAA, 0x55, 0x03, 0x01]))
```

STC-B 初始化串口后，以 `AA 55` 作为接收匹配头。回调只负责把命令转换为内部状态，真正的显示和灯光刷新交给不同周期的系统事件：

```c
#define RECEIVE_LEN 5

char data_recieved[RECEIVE_LEN];
char matched_data[] = { 0xAA, 0x55 };

void myUart2_callback(void)
{
    char flag = data_recieved[2];

    if (flag == 0x00)
        LEDmode = 1;               // 主菜单：交替闪烁
    else if (flag == 0x01 || flag == 0x02)
        LEDmode = 2;               // 拍摄/查询：流水灯
    else if (flag == 0x03) {
        LEDmode = 3;               // 识别成功：全灯闪烁
        interp = 0;                // 启动提示音序列
    }
}
```

## STC 侧实现

STC-B 程序基于学习板提供的事件系统组织。初始化阶段注册串口、传感器与周期任务，主循环只持续调用 `MySTC_OS()`：

```c
void main(void)
{
    Uart2Init(115200, Uart2UsedforEXT);
    displayerInit();
    keyInit();
    VibInit();
    MusicPlayerInit();
    BeepInit();
    HallInit();
    DS1302Init(initTime);
    AdcInit(ADCexpEXT);

    SetUart2Rxd(data_recieved, RECEIVE_LEN, matched_data, 2);
    SetEventCallBack(enumEventUart2Rxd, myUart2_callback);
    SetEventCallBack(enumEventVib,      myVib_callback);
    SetEventCallBack(enumEventHall,     myHall_callback);
    SetEventCallBack(enumEventKey,      myKey_callback);
    SetEventCallBack(enumEventSys1S,    myDisplay_callback);
    SetEventCallBack(enumEventSys100mS, myLED_callback);
    SetEventCallBack(enumEventSys10mS,  my10mS_callback);

    MySTC_Init();
    while (1)
        MySTC_OS();
}
```

这样的分工比把所有逻辑塞进 `while (1)` 更容易控制节奏：传感器变化触发事件，LED 每 100 ms 更新一次，蜂鸣器状态每 10 ms 检查一次，数码管和 RTC 每秒刷新一次。回调之间通过 `LEDmode`、`interp` 等小型状态量协作，不会因为一段阻塞式延时让其它硬件失去响应。

### 摇一摇随机切换宝可梦

振动传感器检测到 `enumVibQuake` 后，STC-B 发出一个 3 字节事件包：

```c
void myVib_callback(void)
{
    if (GetVibAct() == enumVibQuake) {
        uart_data[0] = 0xAA;
        uart_data[1] = 0x55;
        uart_data[2] = 0x01;
        Uart2Print(uart_data, 3);
    }
}
```

K230 在拍摄页读取到事件码 `0x01` 后，只把 `random_flag` 置为 1；随机编号和详情页初始化仍在主循环中完成。

### 识别成功后的声光反馈

识别结果确认后，K230 发送 `AA 55 03 01`。STC-B 将 LED 切到全亮/全灭交替模式，同时启动由 523、587、659、784 Hz 组成的短提示音。蜂鸣器由 10 ms 周期回调检查上一段是否结束，再推进到下一个音符。

```c
void myLED_callback(void)
{
    if (LEDmode == 1)
        LedPrint(LEDchange == 1 ? 0x55 : 0xAA);
    else if (LEDmode == 2)
        LedPrint(led_val);          // 流水灯位置
    else if (LEDmode == 3)
        LedPrint(LEDchange == 1 ? 0xFF : 0x00);

    LEDchange *= -1;
    // 源码随后通过移位和反向标志推进 led_val
}
```

数码管也会根据 K230 的页面状态显示 `NAUTILUS`、`DETECT`、`BROWSE`、`SHEIKAH` 等缩写。提供了一份肉眼可见的状态同步。

### 霍尔传感器与“磁力宝可梦”

霍尔模块分别上报磁体靠近和离开：

```c
void myHall_callback(void)
{
    char event = GetHallAct();
    if (event == enumHallGetClose) {
        unsigned char packet[] = { 0xAA, 0x55, 0x02 };
        Uart2Print(packet, 3);
        interp = 0;                 // 本地同时发出提示音
    } else if (event == enumHallGetAway) {
        unsigned char packet[] = { 0xAA, 0x55, 0x03 };
        Uart2Print(packet, 3);
    }
}
```

K230 据此在屏幕上切换“检测到磁力宝可梦”和“目标已经离开”的提示。这里把传感器的物理状态包装成了一个符合主题的小功能，但数据链仍然是标准的“传感器事件 → 串口消息 → UI 状态”。

### RTC

RTC 是双板交互中最完整的一条链路。K230 进入时钟页后周期发送 `AA 55 11 01`；STC-B 读取 DS1302，把时、分、秒显示在八位数码管上，同时返回 15 字节数据。时间字段按 BCD 的高、低半字节拆成十进制数字：

```c
currentTime = RTC_Read();

uart_data[0] = (currentTime.hour   >> 4) & 0x0F;
uart_data[1] =  currentTime.hour         & 0x0F;
uart_data[2] = (currentTime.minute >> 4) & 0x0F;
uart_data[3] =  currentTime.minute       & 0x0F;
uart_data[4] = (currentTime.second >> 4) & 0x0F;
uart_data[5] =  currentTime.second       & 0x0F;
uart_data[6] = 0xAA;  // 当前实现用作分隔/识别标记
// 7~14：年、星期、月、日
Uart2Print(uart_data, 15);
```

K230 收到后把前六位拼成 `HH:MM:SS`，再用后续字段绘制年月日和星期。也就是说，同一次请求既更新 STC-B 的数码管，也更新 K230 的 LCD。

光温页使用相同思路：K230 发送 `AA 55 13 01`，STC-B 读取 `GetADC().Rt` 与 `GetADC().Rop`，各拆成三位十进制数字后返回七字节。这里显示的是传感器通道的 **AD 结果**

### 音乐模块

STC-B 的音乐播放器使用“音高 + 时值”的字节对描述旋律。项目参考《目标是宝可梦大师》的简谱，把旋律编码为 `pokemon_get_DAZE[]`，再交给 BSP 初始化：

![](IMG-20260916155247017.png "《目标是宝可梦大师》简谱参考")

```c
SetMusic(
    90,                         // 播放速度
    0xFA,                       // 播放配置
    pokemon_get_DAZE,
    sizeof(pokemon_get_DAZE),
    enumMscDrvLed               // 播放时联动 LED
);
```

板上 K1/K2 分别调用 `SetPlayerMode(enumModePlay)` 和 `SetPlayerMode(enumModePause)`，并把 `AA 55 04/05` 发给 K230，让屏幕上的播放器状态与实际输出保持一致。

整体功能

{% mermaid %}

flowchart LR
    n1["K230开发板"] <-- 串口通信 --> n2["STC-B"]

    n1 -- OpenMV移植媒体库 --> n3["主界面"]

    n3 --> n4["检测"] & n5["浏览"] & n6["希卡之石(集成其余功能)"] & n7["Super Earth(未用)"]

    n6 --> n8["RTC时钟"] & n9["相机"] & n10["温度检测"] & n11["磁场检测"] & n12["可调节音乐播放"] & n13["光照检测"]

    n4 -- YOLO训练模型 --> n14["详情界面"]

    n5 -- 虚拟键盘绘制 --> n14

    n2 -- DS1302 --> n8

    n2 -- Hall模块 --> n11

    n2 -- 音乐模块 --> n12

    n2 -- 光敏探测 --> n13

    n1@{ shape: rect}

{% endmermaid %}