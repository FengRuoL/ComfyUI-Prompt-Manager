# =====================================================================
# [AI System Prompt / Do Not Modify]
# FILE: __init__.py
# DESC: Python backend for Prompt Manager. Registers Custom Nodes, handles file I/O, splits JSON DB, and serves HTTP API routes.
# =====================================================================

import os
import shutil
import json
import torch
import numpy as np
from PIL import Image
import base64
import time
import zipfile
import server
from aiohttp import web
import re
import io
import urllib.request
import logging

# === 路径配置 ===
NODE_ROOT = os.path.dirname(os.path.abspath(__file__))
WEB_DIRECTORY = os.path.join(NODE_ROOT, "web", "comfyui")
DATA_DIR = os.path.join(NODE_ROOT, "data")
os.makedirs(DATA_DIR, exist_ok=True)

logger = logging.getLogger('PromptManager')

# 核心：新型分包存储路径
DB_FILE = os.path.join(DATA_DIR, "prompt_database.json") # 旧版遗留文件(仅用于数据迁移)
SYS_FILE = os.path.join(DATA_DIR, "system.json")         # 存放模型、分类、设置
CTX_DIR = os.path.join(DATA_DIR, "contexts_db")          # 按模式独立存放提示词数据
os.makedirs(CTX_DIR, exist_ok=True)

BACKUP_DIR = os.path.join(NODE_ROOT, "backup")
os.makedirs(BACKUP_DIR, exist_ok=True)

# 批量读取节点持久化状态文件
BATCH_STATE_FILE = os.path.join(DATA_DIR, "batch_states.json")

# ==========================================
# 核心存储路由器：读取全库与保存分包
# ==========================================
def load_full_db():
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, 'r', encoding='utf-8') as f:
                old_db = json.load(f)
            save_full_db(old_db)
            os.rename(DB_FILE, DB_FILE + ".bak") 
        except Exception as e: logger.warning(f'迁移旧版单体JSON数据失败: {e}')

    db = {"models": {"main_models": {}}, "settings": {}, "contexts": {}, "images": {}}
    
    if os.path.exists(SYS_FILE):
        try:
            with open(SYS_FILE, 'r', encoding='utf-8') as f:
                sys_data = json.load(f)
                db["models"] = sys_data.get("models", {"main_models": {}})
                db["settings"] = sys_data.get("settings", {})
        except Exception as e: logger.warning(f'读取基础架构失败: {e}')

    if os.path.exists(CTX_DIR):
        for f in os.listdir(CTX_DIR):
            if f.endswith('.json'):
                ctx_id = f[:-5]
                try:
                    with open(os.path.join(CTX_DIR, f), 'r', encoding='utf-8') as cf:
                        cdata = json.load(cf)
                        for item, meta in cdata.get("context", {}).get("metadata", {}).items():
                            if "imgCount" in meta: del meta["imgCount"]
                        
                        db["contexts"][ctx_id] = cdata.get("context", {})
                        db["images"].update(cdata.get("images", {}))
                except Exception as e: logger.warning(f'读取上下文文件 {ctx_id} 失败: {e}')
    return db

def save_full_db(db):
    os.makedirs(CTX_DIR, exist_ok=True)
    
    sys_data = {"models": db.get("models", {}), "settings": db.get("settings", {})}
    tmp_sys = SYS_FILE + ".tmp"
    with open(tmp_sys, 'w', encoding='utf-8') as f:
        json.dump(sys_data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_sys, SYS_FILE)

    current_ctxs = set(db.get("contexts", {}).keys())

    for ctx, ctx_data in db.get("contexts", {}).items():
        for item, meta in ctx_data.get("metadata", {}).items():
            if "imgCount" in meta: del meta["imgCount"]

        ctx_images = {k: v for k, v in db.get("images", {}).items() if k.startswith(ctx + "_")}
        file_data = {"context": ctx_data, "images": ctx_images}
        
        ctx_file = os.path.join(CTX_DIR, f"{ctx}.json")
        tmp_ctx = ctx_file + ".tmp"
        with open(tmp_ctx, 'w', encoding='utf-8') as f:
            json.dump(file_data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_ctx, ctx_file)

    for f in os.listdir(CTX_DIR):
        if f.endswith('.json'):
            if f[:-5] not in current_ctxs:
                os.remove(os.path.join(CTX_DIR, f))

# ==========================================
# 辅助函数 (适配新结构)
# ==========================================
def get_target_models():
    choices = []
    try:
        db = load_full_db()
        models = db.get("models", {}).get("main_models", {})
        for model_id, model_data in models.items():
            if model_id.startswith('cloud_'): continue 
            choices.append(f"[{model_data.get('name', model_id)}]")
    except Exception as e: logger.warning(f'获取目标模型列表失败: {e}')
    return choices if choices else ["未建任何分类_请先创建"]

def get_target_contexts():
    choices = []
    try:
        db = load_full_db()
        models = db.get("models", {}).get("main_models", {})
        for model_id, model_data in models.items():
            if model_id.startswith('cloud_') or model_id.startswith('fav_cloud_'): continue
            model_name = model_data.get("name", model_id)
            cats = {c.get("id"): c.get("name") for c in model_data.get("categories", [])}
            for mode_id, mode_data in model_data.get("modes", {}).items():
                mode_name = mode_data.get("name", mode_id)
                cat_name = cats.get(mode_data.get("group", "custom"), "未分类")
                choices.append(f"[{model_name}] {cat_name} = {mode_name}")
    except Exception as e: logger.warning(f'获取目标上下文列表失败: {e}')
    return choices if choices else ["未建任何三级分类_请先创建"]

def get_combo_choices():
    choices = []
    try:
        db = load_full_db()
        models = db.get("models", {}).get("main_models", {})
        for model_id, model_data in models.items():
            if model_id.startswith('cloud_'): continue
            model_name = model_data.get("name", model_id)
            for combo in db.get("contexts", {}).get(f"{model_id}_global", {}).get("combos", []):
                choice_str = f"[{model_name}] {combo.get('name', '未命名组合')}"
                if choice_str not in choices: choices.append(choice_str)
    except Exception as e: logger.warning(f'获取组合选择列表失败: {e}')
    return choices if choices else ["无可用组合_请先创建"]

def get_group_choices():
    choices = []
    try:
        db = load_full_db()
        models = db.get("models", {}).get("main_models", {})
        for model_id, model_data in models.items():
            if model_id.startswith('cloud_'): continue
            model_name = model_data.get("name", model_id)
            for group in db.get("contexts", {}).get(f"{model_id}_global", {}).get("groups", []):
                choice_str = f"[{model_name}] {group.get('name', '未命名分组')}"
                if choice_str not in choices: choices.append(choice_str)
    except Exception as e: logger.warning(f'获取分组选择列表失败: {e}')
    return choices if choices else ["无可用分组_请先创建"]

def normalize_prompt_name(name):
    if not name: return name
    return name.strip()

# ==========================================
# 节点 1-6 (原有节点保持不变)
# ==========================================
class PromptBrowserNode:
    @classmethod
    def INPUT_TYPES(cls): return {"required": {"输入prompt": ("STRING", {"multiline": True, "default": ""}), "自动随机抽取": ("BOOLEAN", {"default": False}), "抽取数量": ("INT", {"default": 3, "min": 1, "max": 100, "step": 1})}}
    RETURN_TYPES = ("STRING",); RETURN_NAMES = ("prompt字符串",); FUNCTION = "process"; CATEGORY = "Prompt Manager"
    def process(self, 输入prompt, 自动随机抽取, 抽取数量): return (输入prompt,)

class PromptViewerNode:
    @classmethod
    def INPUT_TYPES(cls): return {"required": {"prompt字符串": ("STRING", {"forceInput": True})}, "optional": {"组合预览图": ("IMAGE", )}}
    RETURN_TYPES = ("STRING",); RETURN_NAMES = ("prompt字符串",); FUNCTION = "view"; OUTPUT_NODE = True; CATEGORY = "Prompt Manager"
    def view(self, prompt字符串, 组合预览图=None): return {"ui": {"text": [prompt字符串]}, "result": (prompt字符串,)}

class PromptImportNode:
    @classmethod
    def INPUT_TYPES(cls): return {"required": {"图像": ("IMAGE",), "prompt字符串": ("STRING", {"forceInput": True}), "导入到三级分类": ("BOOLEAN", {"default": True}), "目标三级分类": (get_target_contexts(), ), "导入到组合预设": ("BOOLEAN", {"default": False}), "目标一级分类": (get_target_models(), ), "压缩率": ("FLOAT", {"default": 0.85, "min": 0.1, "max": 1.0, "step": 0.01}), "最大宽度": ("INT", {"default": 900, "min": 100, "max": 4096, "step": 10})}}
    RETURN_TYPES = (); FUNCTION = "save_images"; OUTPUT_NODE = True; CATEGORY = "Prompt Manager"

    def save_images(self, 图像, prompt字符串, 导入到三级分类, 目标三级分类, 导入到组合预设, 目标一级分类, 压缩率, 最大宽度):
        if 导入到三级分类 and 导入到组合预设: raise ValueError("【Prompt管理器报错】不能同时导入分类和组合！请只开启其中一个选项。")
        if not 导入到三级分类 and not 导入到组合预设: return () 

        safe_name = normalize_prompt_name(prompt字符串.strip())
        if not safe_name: return ()
        db_data = load_full_db()
        ctx = "custom_custom"
        
        if 导入到三级分类:
            models = db_data.get("models", {}).get("main_models", {})
            for m_id, m_data in models.items():
                m_name = m_data.get("name", m_id)
                cats = {c.get("id"): c.get("name") for c in m_data.get("categories", [])}
                for md_id, md_data in m_data.get("modes", {}).items():
                    c_name = cats.get(md_data.get("group", "custom"), "未分类")
                    if f"[{m_name}] {c_name} = {md_data.get('name', md_id)}" == 目标三级分类:
                        ctx = f"{m_id}_{md_id}"
                        break

        if 导入到组合预设:
            models = db_data.get("models", {}).get("main_models", {})
            m_id = "custom"
            for k, v in models.items():
                if f"[{v.get('name', k)}]" == 目标一级分类: 
                    m_id = k
                    break
            ctx = f"{m_id}_global"

        if ctx not in db_data["contexts"]: db_data["contexts"][ctx] = {"items": [], "metadata": {}, "groups": [], "combos": []}
            
        ctx_data = db_data["contexts"][ctx]
        target_dir = os.path.join(DATA_DIR, ctx)
        os.makedirs(target_dir, exist_ok=True)
        
        file_safe_name = "".join([c for c in safe_name if c.isalnum()]).rstrip()[:20]
        prefix = "combo" if 导入到组合预设 else "gen"
        
        saved_urls = []
        for i, image_tensor in enumerate(图像):
            img_np = 255. * image_tensor.cpu().numpy()
            img_pil = Image.fromarray(np.clip(img_np, 0, 255).astype(np.uint8))
            w, h = img_pil.size
            if w > 最大宽度:
                new_h = int(h * (最大宽度 / w))
                resample_filter = getattr(Image.Resampling, 'LANCZOS', getattr(Image, 'LANCZOS', 1)) if hasattr(Image, 'Resampling') else getattr(Image, 'LANCZOS', 1)
                img_pil = img_pil.resize((最大宽度, new_h), resample_filter)
            
            img_name = f"{prefix}_{file_safe_name}_{torch.randint(0, 100000, (1,)).item()}.jpg"
            img_path = os.path.join(target_dir, img_name)
            img_pil.save(img_path, format="JPEG", quality=int(压缩率 * 100))
            saved_urls.append(f"/prompt_data/{ctx}/{img_name}")

        if 导入到三级分类:
            if safe_name not in ctx_data["items"]: ctx_data["items"].append(safe_name)
            if safe_name not in ctx_data["metadata"]: ctx_data["metadata"][safe_name] = {"tags": []}
            
            img_key = f"{ctx}_{safe_name}"
            if img_key not in db_data["images"]: db_data["images"][img_key] = []
            db_data["images"][img_key].extend(saved_urls)

        if 导入到组合预设:
            if "combos" not in ctx_data: ctx_data["combos"] = []
            parts = [p.strip() for p in safe_name.split(',') if p.strip()]
            elements = []
            for p in parts:
                tag = p; weight = 1.0
                match = re.match(r'^\((.+):([\d.]+)\)$', p)
                if match: tag = match.group(1); weight = float(match.group(2))
                elements.append({"tag": tag, "weight": weight})
            
            combo_name = f"自动组合_{int(time.time())}"
            combo_img = saved_urls[0] if saved_urls else None
            ctx_data["combos"].insert(0, {"name": combo_name, "elements": elements, "image": combo_img})
        
        save_full_db(db_data)
        return ()

class PromptComboLoaderNode:
    @classmethod
    def INPUT_TYPES(cls): return {"required": {"选择组合": ("STRING", {"default": ""}), "combo_prompt": ("STRING", {"default": ""}), "combo_image": ("STRING", {"default": ""})}}
    RETURN_TYPES = ("STRING", "IMAGE"); RETURN_NAMES = ("prompt字符串", "组合预览图"); FUNCTION = "load_combo"; CATEGORY = "Prompt Manager"

    def load_combo(self, 选择组合, combo_prompt, combo_image):
        img_tensor = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
        if combo_image:
            try:
                i = None
                if combo_image.startswith("/prompt_data/"):
                    img_path = os.path.join(DATA_DIR, combo_image.replace("/prompt_data/", ""))
                    if os.path.exists(img_path): i = Image.open(img_path)
                elif combo_image.startswith("http"):
                    req = urllib.request.Request(combo_image, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req) as response: i = Image.open(io.BytesIO(response.read()))
                elif combo_image.startswith("data:image"):
                    header, encoded = combo_image.split(",", 1)
                    i = Image.open(io.BytesIO(base64.b64decode(encoded)))

                if i is not None:
                    i = i.convert("RGB")
                    img_np = np.array(i).astype(np.float32) / 255.0
                    img_tensor = torch.from_numpy(img_np).unsqueeze(0)
            except Exception as e: print(f"[Prompt Manager] 加载组合图片失败: {e}")
        return (combo_prompt, img_tensor)

class PromptGroupRandomizerNode:
    @classmethod
    def INPUT_TYPES(cls): return {"required": {"选择分组": (get_group_choices(), ), "抽取数量": ("INT", {"default": 3, "min": 1, "max": 100}), "输入prompt": ("STRING", {"multiline": True, "default": ""})}}
    RETURN_TYPES = ("STRING",); RETURN_NAMES = ("prompt字符串",); FUNCTION = "process"; CATEGORY = "Prompt Manager"
    def process(self, 选择分组, 抽取数量, 输入prompt): return (输入prompt,)

class PromptBatchReaderNode:
    _states = None
    @classmethod
    def _load_states(cls):
        if os.path.exists(BATCH_STATE_FILE):
            try:
                with open(BATCH_STATE_FILE, 'r', encoding='utf-8') as f: return json.load(f)
            except Exception: pass
        return {}
    @classmethod
    def _save_states(cls):
        tmp_file = BATCH_STATE_FILE + ".tmp"
        try:
            with open(tmp_file, 'w', encoding='utf-8') as f: json.dump(cls._states, f, ensure_ascii=False, indent=2)
            os.replace(tmp_file, BATCH_STATE_FILE)
        except Exception: pass

    @classmethod
    def INPUT_TYPES(cls): return {"required": {"批量列表_每行一个": ("STRING", {"multiline": True, "default": "@satou_kibi\n@wagashi"}), "固定前缀": ("STRING", {"multiline": True, "default": "masterpiece, best quality, "}), "固定后缀": ("STRING", {"multiline": True, "default": ", cowboy shot"}), "reset_timestamp": ("STRING", {"default": ""})}}
    RETURN_TYPES = ("STRING", "STRING"); RETURN_NAMES = ("发送给采样器的Prompt", "原始名称"); FUNCTION = "process"; CATEGORY = "Prompt Manager"

    @classmethod
    def IS_CHANGED(cls, **kwargs): return float("NaN") 

    def process(self, 批量列表_每行一个, 固定前缀, 固定后缀, reset_timestamp):
        if PromptBatchReaderNode._states is None: PromptBatchReaderNode._states = PromptBatchReaderNode._load_states()
        state_key = reset_timestamp if reset_timestamp else "default_state"
        if state_key not in PromptBatchReaderNode._states: PromptBatchReaderNode._states[state_key] = 0
            
        lines = [line.strip() for line in 批量列表_每行一个.strip().split('\n') if line.strip()]
        if not lines: return {"ui": {"progress": [0, "空数据"]}, "result": (f"{固定前缀}{固定后缀}", "空数据")}
        
        current_idx = PromptBatchReaderNode._states[state_key] % len(lines)
        raw_name = lines[current_idx]
        PromptBatchReaderNode._states[state_key] += 1
        PromptBatchReaderNode._save_states()
        
        return {"ui": {"progress": [current_idx + 1, raw_name]}, "result": (f"{固定前缀}{raw_name}{固定后缀}", raw_name)}

# ==========================================
# 节点 7：新增的“本地数据集一键导入”节点
# ==========================================
class PromptDatasetImporterNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "txt文件绝对路径": ("STRING", {"default": "D:\\artists.txt"}),
                "图片根目录绝对路径": ("STRING", {"default": "D:\\images"}),
                "目标一级分类": (get_target_models(), ),
                "新建三级分类名称": ("STRING", {"default": "1000画师合集"}),
                "最大图片尺寸": ("INT", {"default": 512, "min": 128, "max": 2048, "step": 64}),
                "压缩率": ("FLOAT", {"default": 0.85, "min": 0.1, "max": 1.0, "step": 0.01}),
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("执行结果",)
    FUNCTION = "import_dataset"
    OUTPUT_NODE = True
    CATEGORY = "Prompt Manager"

    def import_dataset(self, txt文件绝对路径, 图片根目录绝对路径, 目标一级分类, 新建三级分类名称, 最大图片尺寸, 压缩率):
        txt文件绝对路径 = txt文件绝对路径.strip('\"').strip('\'')
        图片根目录绝对路径 = 图片根目录绝对路径.strip('\"').strip('\'')

        if not os.path.exists(txt文件绝对路径):
            return (f"【失败】找不到 txt 文件: {txt文件绝对路径}，请检查路径是否正确。",)
        if not os.path.exists(图片根目录绝对路径):
            return (f"【失败】找不到图片目录: {图片根目录绝对路径}，请检查路径是否正确。",)

        try:
            with open(txt文件绝对路径, 'r', encoding='utf-8') as f:
                lines = [line.strip() for line in f.readlines() if line.strip()]
        except Exception as e:
            return (f"【失败】读取 txt 文件出错: {str(e)}",)

        if not lines:
            return ("【失败】txt 文件是空的！",)

        db_data = load_full_db()
        models = db_data.get("models", {}).get("main_models", {})
        
        m_id = None
        for k, v in models.items():
            if f"[{v.get('name', k)}]" == 目标一级分类:
                m_id = k
                break
        
        if not m_id:
            return ("【失败】未找到目标一级分类，请确保已在界面左侧新建至少一个分类。",)

        # 1. 自动注册新的三级分类
        md_id = f"import_{int(time.time())}"
        if "modes" not in models[m_id]: models[m_id]["modes"] = {}
        models[m_id]["modes"][md_id] = {"name": 新建三级分类名称, "group": "custom"}
        
        # 2. 准备上下文环境
        ctx = f"{m_id}_{md_id}"
        db_data["contexts"][ctx] = {"items": [], "metadata": {}, "groups": [], "combos": []}
        ctx_data = db_data["contexts"][ctx]
        
        # 3. 创建物理文件夹
        target_dir = os.path.join(DATA_DIR, ctx)
        os.makedirs(target_dir, exist_ok=True)

        successful_imgs_count = 0
        
        print(f"\n[Prompt Manager] 开始处理大数据集导入，共 {len(lines)} 行...")

        for i, artist_prompt in enumerate(lines):
            safe_name = normalize_prompt_name(artist_prompt)
            if not safe_name: continue
            
            # 找到对应的文件夹：1, 2, 3...
            folder_num = str(i + 1)
            folder_path = os.path.join(图片根目录绝对路径, folder_num)
            
            saved_urls = []
            if os.path.exists(folder_path) and os.path.isdir(folder_path):
                valid_exts = {".jpg", ".jpeg", ".png", ".webp"}
                for filename in os.listdir(folder_path):
                    if os.path.splitext(filename)[1].lower() in valid_exts:
                        img_path = os.path.join(folder_path, filename)
                        try:
                            with Image.open(img_path) as img:
                                if img.mode in ("RGBA", "P"): img = img.convert("RGB")
                                w, h = img.size
                                # 等比缩放
                                if w > 最大图片尺寸 or h > 最大图片尺寸:
                                    resample_filter = getattr(Image.Resampling, 'LANCZOS', getattr(Image, 'LANCZOS', 1)) if hasattr(Image, 'Resampling') else getattr(Image, 'LANCZOS', 1)
                                    img.thumbnail((最大图片尺寸, 最大图片尺寸), resample_filter)
                                
                                # 生成防碰撞安全文件名
                                file_safe_name = "".join([c for c in safe_name if c.isalnum()]).rstrip()[:10]
                                img_name = f"ds_{file_safe_name}_{i}_{torch.randint(0, 10000, (1,)).item()}.jpg"
                                save_path = os.path.join(target_dir, img_name)
                                
                                img.save(save_path, format="JPEG", quality=int(压缩率 * 100))
                                saved_urls.append(f"/prompt_data/{ctx}/{img_name}")
                        except Exception as e:
                            logger.warning(f"图片处理跳过 {img_path}: {e}")

            # 写入数据库映射
            if safe_name not in ctx_data["items"]:
                ctx_data["items"].append(safe_name)
                ctx_data["metadata"][safe_name] = {"tags": ["批量导入数据集"]}
            
            if saved_urls:
                img_key = f"{ctx}_{safe_name}"
                if img_key not in db_data["images"]: db_data["images"][img_key] = []
                db_data["images"][img_key].extend(saved_urls)
                successful_imgs_count += len(saved_urls)
                
        # 整体保存一次
        save_full_db(db_data)
        
        result_msg = f"【成功】已将 {len(lines)} 个画师串全部导入！\n存入分类：{新建三级分类名称}\n共成功提取并压缩了 {successful_imgs_count} 张预览图。"
        print(f"[Prompt Manager] {result_msg}")
        return (result_msg,)

# ==========================================
# 路由映射
# ==========================================
@server.PromptServer.instance.routes.get("/prompt_data/{path:.*}")
async def serve_data_dir(request):
    path = request.match_info["path"]
    file_path = os.path.abspath(os.path.join(DATA_DIR, path))
    if os.path.exists(file_path) and file_path.startswith(DATA_DIR): return web.FileResponse(file_path)
    return web.Response(status=404)

@server.PromptServer.instance.routes.get("/api/prompt-manager/db")
async def get_db(request): return web.json_response(load_full_db())

@server.PromptServer.instance.routes.post("/api/prompt-manager/db")
async def save_db(request):
    try:
        save_full_db(await request.json())
        return web.json_response({"success": True})
    except Exception as e: return web.json_response({"success": False, "error": str(e)})

@server.PromptServer.instance.routes.post("/api/prompt-manager/upload")
async def upload_image(request):
    try:
        data = await request.json()
        image_base64 = data.get("image")
        filename = data.get("filename")
        subfolder = data.get("subfolder", "")

        if image_base64 and filename:
            if "," in image_base64: image_base64 = image_base64.split(",")[1]
            img_data = base64.b64decode(image_base64)
            target_dir = DATA_DIR
            if subfolder:
                safe_subfolder = "".join([c for c in subfolder if c.isalnum() or '\u4e00' <= c <= '\u9fff' or c in ('_', '-')])
                target_dir = os.path.join(DATA_DIR, safe_subfolder)
                os.makedirs(target_dir, exist_ok=True)
            
            safe_filename = os.path.basename(filename)
            filepath = os.path.join(target_dir, safe_filename)
            with open(filepath, "wb") as f: f.write(img_data)
            
            url_path = f"{safe_subfolder}/{filename}" if subfolder else filename
            return web.json_response({"success": True, "url": f"/prompt_data/{url_path}"})
        return web.json_response({"success": False, "error": "Missing data"})
    except Exception as e: return web.json_response({"success": False, "error": str(e)})

@server.PromptServer.instance.routes.post("/api/prompt-manager/delete_file")
async def delete_file(request):
    try:
        file_url = (await request.json()).get("url")
        if file_url and file_url.startswith("/prompt_data/"):
            relative_path = file_url.replace("/prompt_data/", "")
            if ".." in relative_path: return web.json_response({"success": False})
            filepath = os.path.join(DATA_DIR, relative_path)
            if os.path.exists(filepath): os.remove(filepath)
            return web.json_response({"success": True})
        return web.json_response({"success": False, "error": "Invalid file"})
    except Exception as e: return web.json_response({"success": False, "error": str(e)})

@server.PromptServer.instance.routes.post("/api/prompt-manager/delete_folder")
async def delete_folder(request):
    try:
        folder = (await request.json()).get("folder")
        if folder:
            safe_folder = "".join([c for c in folder if c.isalnum() or '\u4e00' <= c <= '\u9fff' or c in ('_', '-')])
            folder_path = os.path.join(DATA_DIR, safe_folder)
            if os.path.exists(folder_path) and os.path.isdir(folder_path):
                shutil.rmtree(folder_path)
                return web.json_response({"success": True})
        return web.json_response({"success": False})
    except Exception as e: return web.json_response({"success": False, "error": str(e)})

@server.PromptServer.instance.routes.post("/api/prompt-manager/format")
async def format_plugin(request):
    try:
        for item in os.listdir(DATA_DIR):
            item_path = os.path.join(DATA_DIR, item)
            if os.path.isfile(item_path): os.remove(item_path)
            elif os.path.isdir(item_path): shutil.rmtree(item_path)
        return web.json_response({"success": True})
    except Exception as e: return web.json_response({"success": False, "error": str(e)})

@server.PromptServer.instance.routes.post("/api/prompt-manager/backup/create")
async def create_backup(request):
    try:
        name = (await request.json()).get("name", f"Backup_{int(time.time())}")
        safe_name = "".join([c for c in name if c.isalnum() or '\u4e00' <= c <= '\u9fff' or c in ('_', '-')])
        zip_filename = f"{safe_name}.zip"
        zip_path = os.path.join(BACKUP_DIR, zip_filename)
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(DATA_DIR):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, DATA_DIR)
                    zipf.write(file_path, arcname)
        return web.json_response({"success": True, "filename": zip_filename})
    except Exception as e: return web.json_response({"success": False, "error": str(e)})

@server.PromptServer.instance.routes.get("/api/prompt-manager/backup/list")
async def list_backups(request):
    try:
        backups = []
        if os.path.exists(BACKUP_DIR):
            for f in os.listdir(BACKUP_DIR):
                if f.endswith(".zip"):
                    file_path = os.path.join(BACKUP_DIR, f)
                    size_mb = round(os.path.getsize(file_path) / (1024 * 1024), 2)
                    mtime = os.path.getmtime(file_path)
                    backups.append({"name": f, "size": size_mb, "time": mtime})
        backups.sort(key=lambda x: x["time"], reverse=True)
        return web.json_response({"success": True, "backups": backups})
    except Exception as e: return web.json_response({"success": False, "error": str(e)})

@server.PromptServer.instance.routes.post("/api/prompt-manager/backup/restore")
async def restore_backup(request):
    try:
        filename = (await request.json()).get("filename")
        if not filename or ".." in filename: return web.json_response({"success": False})
        zip_path = os.path.join(BACKUP_DIR, filename)
        if not os.path.exists(zip_path): return web.json_response({"success": False, "error": "Backup file not found"})
        
        temp_dir = DATA_DIR + "_temp_restore"
        if os.path.exists(temp_dir): shutil.rmtree(temp_dir)
        os.makedirs(temp_dir, exist_ok=True)
        
        try:
            with zipfile.ZipFile(zip_path, 'r') as zipf:
                for member in zipf.namelist():
                    if '..' not in member and not os.path.isabs(member):
                        zipf.extract(member, temp_dir)
            
            for item in os.listdir(DATA_DIR):
                item_path = os.path.join(DATA_DIR, item)
                if os.path.isfile(item_path): os.remove(item_path)
                elif os.path.isdir(item_path): shutil.rmtree(item_path)
                
            for item in os.listdir(temp_dir):
                shutil.move(os.path.join(temp_dir, item), DATA_DIR)
                
        except Exception as e:
            return web.json_response({"success": False, "error": f"解压异常，原数据已拦截保护: {str(e)}"})
        finally:
            if os.path.exists(temp_dir): shutil.rmtree(temp_dir)
            
        return web.json_response({"success": True})
    except Exception as e: return web.json_response({"success": False, "error": str(e)})

NODE_CLASS_MAPPINGS = {
    "PromptBrowserNode": PromptBrowserNode, 
    "PromptViewerNode": PromptViewerNode,
    "PromptImportNode": PromptImportNode,
    "PromptComboLoaderNode": PromptComboLoaderNode,
    "PromptGroupRandomizerNode": PromptGroupRandomizerNode,
    "PromptBatchReaderNode": PromptBatchReaderNode,
    "PromptDatasetImporterNode": PromptDatasetImporterNode # <--- 注册新节点
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptBrowserNode": "Prompt浏览器", 
    "PromptViewerNode": "Prompt展示器",
    "PromptImportNode": "Prompt一键导入",
    "PromptComboLoaderNode": "Prompt组合预设加载器",
    "PromptGroupRandomizerNode": "Prompt收藏夹盲盒",
    "PromptBatchReaderNode": "Prompt批量读取",
    "PromptDatasetImporterNode": "Prompt本地数据集导入" # <--- 注册中文名
}