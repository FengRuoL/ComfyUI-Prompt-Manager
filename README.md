# ComfyUI-Prompt-Manager
**一个用于浏览与管理画师串、各种 Prompt 预设的极简小插件**

> 📢 **参与社区共建 / 提交画师库：**  
> 本插件已接入云端公共图库模式！如果您整理了优质的画师风格或 Prompt 预设，欢迎前往数据仓库 👉 [ComfyUI-Prompt-CloudDB](https://github.com/FengRuoL/ComfyUI-Prompt-CloudDB) 提交您的图库。审核通过后将同步给全网用户！

---

## 节点 1：Prompt 浏览器 (核心主控界面)

<img width="497" height="657" alt="image" src="https://github.com/user-attachments/assets/437aa5d4-5d82-470d-ab44-77268078e225" />

- 点击节点上的 **“打开 Prompt 浏览器”** 按钮，即可进入插件的大型可视化主界面。

### 1.1 分类层级管理
<img width="1370" height="716" alt="image" src="https://github.com/user-attachments/assets/5e74c06b-7929-401e-9ebb-aae5d0612e6e" />

- **一级分类**：位于顶部标签页。操作类似浏览器标签，可随意切换。常用于区分不同的“大模型”（如 SD1.5、SDXL、Pony 等）或独立的云端/本地环境。
- **二级分类**：位于左侧边栏。用于归纳和折叠管理下方的小类。常用于定义大方向，如“作品来源”、“IP”、“艺术流派”等。
- **三级分类**：二级分类下的具体节点。常用于精细划分，如“画师”、“角色”、“场景”、“光影”等。

### 1.2 收藏管理
<img width="741" height="709" alt="image" src="https://github.com/user-attachments/assets/91c0d4a5-bb60-44c4-937d-640be020c0aa" />

- 创建个人的收藏夹分组后，点击“查看内页”，即可集中浏览并管理已收藏的 Prompt 卡片。支持跨分类抓取并整理你最常用的提示词。

### 1.3 组合预设管理
<img width="787" height="714" alt="image" src="https://github.com/user-attachments/assets/a362c210-a9d4-4bea-99d8-6299d1bde6ff" />

- 可以在此处将多个 Prompt 标签组合保存为一个整体预设（如：一套完整的起手式或背景配置）。
- 点击卡片右侧的 **“导至节点”**，即可一键将整套组合词直接发送到 Prompt 浏览器节点中，告别繁琐的手动复制粘贴。

### 1.4 新建卡片
<img width="490" height="259" alt="image" src="https://github.com/user-attachments/assets/74f03538-a3b8-4e14-9976-42555259609a" />

- **图片批量上传**：直接多选上传图片，插件会自动将图片的纯文件名作为 Prompt 标签创建卡片。
- **单文本创建**：纯手工输入，创建一个无图片的 Prompt 卡片。
- **TXT 导入**：上传 `.txt` 文本文件，插件会按逗号自动分割，批量创建多个无图的 Prompt 卡片。

### 1.5 批量操作
- 开启批量模式后，通过鼠标框选或点选多张卡片，可一键执行 **彻底删除**、**批量添加/移除标签**、**批量加入收藏夹** 等操作，大幅提升管理效率。

---

## 节点 2：Prompt 展示器

<img width="1121" height="524" alt="image" src="https://github.com/user-attachments/assets/d1b0af3f-94ca-4514-8ddd-bd3bbf725b26" />

- 将其连接至 **Prompt 浏览器** 节点。
- 当带有 Prompt 输出时，该节点会在 ComfyUI 画布上直观地展示出所用到的画师/标签的预览图与权重信息。
- *注：若图库中不存在该标签，则会显示为“无图”。*

---

## 节点 3：Prompt 一键导入

<img width="412" height="482" alt="image" src="https://github.com/user-attachments/assets/aba3c27c-d42e-4bf7-a8eb-5d3de99fb3a4" />

用于在工作流运行结束后，将生成的优质图片自动作为预览图反向存入你的图库中。

- **导入到模式 (三级分类)**：开启为 `true` 后，选择目标三级分类。运行时会自动以节点接入的 Prompt 字符串为名，将生成的图片新建或追加到该卡片下。
- **导入到组合**：开启为 `true` 后，选择目标一级分类。运行时会自动将接入的 Prompt 拆解，并在该分类下创建一个附带刚生成预览图的“组合预设”。

---

## 节点 4：Prompt 收藏夹盲盒

<img width="598" height="510" alt="image" src="https://github.com/user-attachments/assets/efd19dd0-3575-4abb-bc02-5317fca05120" />

- **灵感抽卡机**：选择你之前建立的收藏夹分组并设定数量，点击“抽取盲盒”，插件会在该收藏夹内随机抽取指定数量的 Prompt 卡片并输出。
- 支持开启 **“自动随机抽取”**，实现每次跑图自动换画师/换风格的盲盒玩法。

---

## 节点 5：Prompt 组合预设加载器

<img width="491" height="476" alt="image" src="https://github.com/user-attachments/assets/31bea7a2-fc03-4dac-baa9-f017cd992fdf" />

- 直接在下拉菜单中选择你在浏览器中建好的“组合预设”。
- 节点会将组合内包含的所有 Prompt 标签解析为长字符串并输出供大模型使用。

---

## 节点 6：Prompt 实时预览图

<img width="563" height="376" alt="image" src="https://github.com/user-attachments/assets/c1210b69-7c45-4b78-bc76-3c1045b17b07" />

- 需配合 **Prompt 组合预设加载器** 节点使用。
- 能够**实时、免运行**地加载并在画布上显示当前所选组合的预览图，方便在切换组合时直观确认画面风格。
