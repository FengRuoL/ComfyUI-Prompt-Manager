### ComfyUI-Prompt-Manager
__一个用于浏览画师串/各种prompt的极简小插件__

## 节点1 Prompt浏览器

**1. prompt浏览器**
<img width="497" height="657" alt="image" src="https://github.com/user-attachments/assets/437aa5d4-5d82-470d-ab44-77268078e225" />
- 点击**打开prompt浏览器**键即可进入插件主界面

**2. 创建分类**

<img width="1370" height="716" alt="image" src="https://github.com/user-attachments/assets/5e74c06b-7929-401e-9ebb-aae5d0612e6e" />

- 一级分类：顶部标签页，如浏览器一般可以随意切换标签页，常用于给"不同模型"分类
- 二级分类：左侧分类栏，用于管理三级分类，常用于给"作品""IP"等不同类别prompt分类
- 三级分类：二级分类下，可自由使用，常用于给"画师""角色""场景"等不同类别prompt分类


**3. 收藏管理**

<img width="741" height="709" alt="image" src="https://github.com/user-attachments/assets/91c0d4a5-bb60-44c4-937d-640be020c0aa" />

- 创建收藏夹后，点击查看内页即可查看已收藏的单个promot卡片

**4. 组合管理**

<img width="787" height="714" alt="image" src="https://github.com/user-attachments/assets/a362c210-a9d4-4bea-99d8-6299d1bde6ff" />

- 创建组合后，可直接点击右侧的导至节点一键导出到Prompt浏览器节点中，无需手动复制粘贴

**5. 新建卡片**

<img width="490" height="259" alt="image" src="https://github.com/user-attachments/assets/74f03538-a3b8-4e14-9976-42555259609a" />

- 图片批量上传：直接上传图片，会将图片名字作为prompt一并上传
- 单文本创建：创建一个无图片的prompt卡片
- txt导入：批量上传文本创建多个无图片的prompt卡片


**6. 批量操作**

- 字面意思，批量选择卡片后可删除、添加标签、添加进入收藏夹等等...
  
## 节点2 Prompt展示器

<img width="1121" height="524" alt="image" src="https://github.com/user-attachments/assets/d1b0af3f-94ca-4514-8ddd-bd3bbf725b26" />

- 连接**prompt浏览器**节点，可对应显示出用户输入的画师，若prompt浏览器中不存在该画师则显示为"无图"

## 节点3 Prompt一键导入

<img width="412" height="482" alt="image" src="https://github.com/user-attachments/assets/aba3c27c-d42e-4bf7-a8eb-5d3de99fb3a4" />

- 导入到模式：图像接入输出的图像，prompt字符串接入**prompt浏览器**的字符输出，开启为true后选择你要导入的三级分类，就会自动以**prompt浏览器**的字符串和输入的图片在对应一级分类下创建一个新卡片
- 导入到组合：接入如上，开启为true后选择你要导入的一级分类，就会在对应一级分类下创建一个新的组合

## 节点4 Prompt收藏夹盲盒

<img width="598" height="510" alt="image" src="https://github.com/user-attachments/assets/efd19dd0-3575-4abb-bc02-5317fca05120" />

- 选择一级分类下你所创建的收藏夹，设定好数量后在你的收藏夹中随机抽取卡片，由Prompt字符串接口导出

## 节点5 Prompt组合预设加载器

<img width="491" height="476" alt="image" src="https://github.com/user-attachments/assets/31bea7a2-fc03-4dac-baa9-f017cd992fdf" />

- 展示你创建的所有组合，可自行选择使用，由Prompt字符串接口导出
- 组合预览图：接入**Prompt实时预览图**节点使用

## 节点6 Prompt实时预览图

<img width="563" height="376" alt="image" src="https://github.com/user-attachments/assets/c1210b69-7c45-4b78-bc76-3c1045b17b07" />

- 配合**Prompt组合预设加载器**节点使用，实时加载**Prompt组合预设加载器**节点所选择组合的预览图，无需刷新或运行Comfyui后刷新才能读取



