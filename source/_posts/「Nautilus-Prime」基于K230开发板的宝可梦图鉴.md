---
title: 「Nautilus-Prime」基于K230开发板的宝可梦图鉴
cover: cover_3e4476bf.png
top_img: false
toc: true
aside: true
abbrlink: 3e4476bf
date: 2025-09-20 12:24:32
updated: 2026-09-15 15:57:05
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
![](cover_3e4476bf.png "最终双板连接效果")

本项目的诞生方式比较神秘，因学校小学期大作业要求需要使用自己焊的STC-B板，所以需要想一种方法使得STC-B与手边的K230有机结合。K230-CanMV：能接摄像头、跑模型、驱动 800×480 的屏幕，但单独使用又少了一些实体交互。于是有了 Nautilus-Prime，一台可以拍摄、识别、查询宝可梦，也会随着摇晃、磁铁和按键做出反应的桌面图鉴。

<div align="center">

# 「Pokémon、GETだぜ！」

</div>

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

详情页再按编号推算世代，读取 `/data/gen{gen}/{四位编号}{英文名}/inform.txt`，绘制名称、属性、身高、体重、种族值和动态立绘。图片资源之所以是 BMP 序列，而不是直接播 GIF，是因为当时板端的图片解码和 `draw_image` 使用受限；开发日志里记录了用 FFmpeg 转帧的过程。播放时逐帧读取并循环索引：

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

训练时我曾先试过 YOLO 的检测任务，后来选择分类：图鉴的目标是判断画面中主要是哪一只宝可梦，不需要框出多只目标。模型覆盖前 386 类，训练后通过 NNCase 转为 K230 可运行的 `kmodel`，主程序从 `/data/best.kmodel` 加载，输入尺寸为 224×224。训练集按分类任务的“类别目录”组织，开发日志里保留的关键命令是：

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

这里还有一处需要补充：仓库代码把 `confidence_threshold` 设为 `0`，结果页会直接展示第一候选及其分数，没有“低置信度时提示重拍”的判断。设计报告中的“正拍、光照充足场景下识别成功率可达 90% 以上”和“双板延迟在 100 ms 内”是该次项目测试的结论，并非在不同环境、不同目标上都成立的保证。报告同时记录：斜拍、小目标和弱光情况下，准确率会明显下降，有些场景低于 60%。224×224 的输入缩放、类别样本不均衡以及真实拍摄条件与训练图像的差异，都是比单纯调高分数阈值更需要解决的问题。

## 串口协议连接+STC侧

K230 发给 STC-B 的常见命令以传奇包头 `0xAA 0x55` 开头，后面是页面/功能号和选中项。例如主菜单选中 Detect 时发送 `AA 55 00 01`；进入时钟页发送 `AA 55 11 01`；进入识别后的反馈阶段发送 `AA 55 03 01`。STC-B 端按头部匹配接收，再在回调里读取功能号，切换 LED 和蜂鸣器等状态：

```c
char matched_data[] = {0xaa, 0x55};
SetUart2Rxd(data_recieved, RECEIVE_LEN, matched_data, 2);

void myUart2_callback(void)
{
    char flag = data_recieved[2];
    if (flag == 0x01 || flag == 0x02) LEDmode = 2;
    else if (flag == 0x00) LEDmode = 1;
    else if (flag == 0x03) { LEDmode = 3; interp = 0; }
}
```

反方向传输的是短事件包。STC-B 的振动回调发送 `AA 55 01`，霍尔传感器靠近/远离分别发送 `AA 55 02` 和 `AA 55 03`，板上 K1/K2 控制音乐时发送 `AA 55 04/05`。K230 收到振动事件后置 `random_flag`，在主循环中换图鉴编号；收到霍尔事件则改变“磁力宝可梦探测”页的提示。STC-B 本地也可以立刻触发蜂鸣器，避免所有即时反馈都等屏幕处理。

时钟是一个更完整的双向例子。K230 请求 `AA 55 11 01`，STC-B 在周期回调中读取 DS1302，一边显示时分秒，一边返回 15 字节的时间字段；K230 读取这 15 字节绘制日期和星期。光照/温度页也由 STC-B 的 ADC 返回七字节数据，不过屏幕上展示的是 **AD 值**，不能把它直接写成经过标定的摄氏度或照度。

这套协议足够完成演示，但还谈不上健壮：页面命令和事件包长度不同，时间包靠约定位置识别；K230 代码多处直接 `uart.read(3)` 或 `uart.read(15)` 后访问固定下标，缺少完整的长度判断、校验、超时重试。设计报告确实也把接触不良或干扰导致的丢包、错显列为问题。~~但最后能跑不就行~~

