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

# === 路径配置 ===
NODE_ROOT = os.path.dirname(os.path.abspath(__file__))
WEB_DIRECTORY = os.path.join(NODE_ROOT, "web", "comfyui")
DATA_DIR = os.path.join(NODE_ROOT, "data")
os.makedirs(DATA_DIR, exist_ok=True)

# 核心：新型分包存储路径
DB_FILE = os.path.join(DATA_DIR, "prompt_database.json") # 旧版遗留文件(仅用于数据迁移)
SYS_FILE = os.path.join(DATA_DIR, "system.json")         # 存放模型、分类、设置
CTX_DIR = os.path.join(DATA_DIR, "contexts_db")          # 按模式独立存放提示词数据
os.makedirs(CTX_DIR, exist_ok=True)

BACKUP_DIR = os.path.join(NODE_ROOT, "backup")
os.makedirs(BACKUP_DIR, exist_ok=True)

# ==========================================
# 核心存储路由器：读取全库与保存分包
# ==========================================
def load_full_db():
    # 1. 自动迁移旧版单体 JSON 数据
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, 'r', encoding='utf-8') as f:
                old_db = json.load(f)
            save_full_db(old_db)
            os.rename(DB_FILE, DB_FILE + ".bak") # 备份旧库，防止误删
        except: pass

    db = {"models": {"main_models": {}}, "settings": {}, "contexts": {}, "images": {}}
    
    # 2. 读取基础架构
    if os.path.exists(SYS_FILE):
        try:
            with open(SYS_FILE, 'r', encoding='utf-8') as f:
                sys_data = json.load(f)
                db["models"] = sys_data.get("models", {"main_models": {}})
                db["settings"] = sys_data.get("settings", {})
        except: pass

    # 3. 组装碎片化的提示词上下文
    if os.path.exists(CTX_DIR):
        for f in os.listdir(CTX_DIR):
            if f.endswith('.json'):
                ctx_id = f[:-5]
                try:
                    with open(os.path.join(CTX_DIR, f), 'r', encoding='utf-8') as cf:
                        cdata = json.load(cf)
                        # 【Bug修复】：自动抹除无用的幽灵字段 imgCount
                        for item, meta in cdata.get("context", {}).get("metadata", {}).items():
                            if "imgCount" in meta: del meta["imgCount"]
                        
                        db["contexts"][ctx_id] = cdata.get("context", {})
                        db["images"].update(cdata.get("images", {}))
                except: pass
    return db

def save_full_db(db):
    os.makedirs(CTX_DIR, exist_ok=True)
    
    # 1. 保存基础架构到 system.json
    sys_data = {"models": db.get("models", {}), "settings": db.get("settings", {})}
    tmp_sys = SYS_FILE + ".tmp"
    with open(tmp_sys, 'w', encoding='utf-8') as f:
        json.dump(sys_data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_sys, SYS_FILE)

    current_ctxs = set(db.get("contexts", {}).keys())

    # 2. 分发各个模式的数据到独立的 json 文件
    for ctx, ctx_data in db.get("contexts", {}).items():
        # 【Bug修复】：保存时也抹除无用的幽灵字段 imgCount
        for item, meta in ctx_data.get("metadata", {}).items():
            if "imgCount" in meta: del meta["imgCount"]

        ctx_images = {k: v for k, v in db.get("images", {}).items() if k.startswith(ctx + "_")}
        file_data = {"context": ctx_data, "images": ctx_images}
        
        ctx_file = os.path.join(CTX_DIR, f"{ctx}.json")
        tmp_ctx = ctx_file + ".tmp"
        with open(tmp_ctx, 'w', encoding='utf-8') as f:
            json.dump(file_data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_ctx, ctx_file)

    # 3. 清理已在前端被删除的模式文件
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
            # 【修复1】：放行 fav_cloud_ 隐形收藏库，这样就能导入组合到订阅端了！
            if model_id.startswith('cloud_'): continue 
            choices.append(f"[{model_data.get('name', model_id)}]")
    except: pass
    return choices if choices else ["未建任何分类_请先创建"]

def get_target_contexts():
    choices = []
    try:
        db = load_full_db()
        models = db.get("models", {}).get("main_models", {})
        for model_id, model_data in models.items():
            # 导入三级分类时，必须屏蔽云端和隐形收藏库
            if model_id.startswith('cloud_') or model_id.startswith('fav_cloud_'): continue
            model_name = model_data.get("name", model_id)
            cats = {c.get("id"): c.get("name") for c in model_data.get("categories", [])}
            for mode_id, mode_data in model_data.get("modes", {}).items():
                mode_name = mode_data.get("name", mode_id)
                cat_name = cats.get(mode_data.get("group", "custom"), "未分类")
                choices.append(f"[{model_name}] {cat_name} = {mode_name}")
    except: pass
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
    except: pass
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
    except: pass
    return choices if choices else ["无可用分组_请先创建"]

def normalize_prompt_name(name):
    if not name: return name
    name = re.sub(r'\\\(', '(', name)      # 解除转义左括号
    name = re.sub(r'\\\)', ')', name)      # 解除转义右括号
    name = re.sub(r'[\s_]*\(', '_(', name) # 将括号前的所有空格或下划线统一标准化为 _(
    return name.strip()

# ==========================================
# 节点 1：Prompt 浏览器 
# ==========================================
class PromptBrowserNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "输入prompt": ("STRING", {"multiline": True, "default": ""}),
                "自动随机抽取": ("BOOLEAN", {"default": False}),
                "抽取数量": ("INT", {"default": 3, "min": 1, "max": 100, "step": 1}),
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt字符串",)
    FUNCTION = "process"
    CATEGORY = "Prompt Manager"

    def process(self, 输入prompt, 自动随机抽取, 抽取数量):
        return (输入prompt,)

# ==========================================
# 节点 2：Prompt 展示器 (二合一升级版)
# ==========================================
class PromptViewerNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt字符串": ("STRING", {"forceInput": True}),
            },
            "optional": {
                "组合预览图": ("IMAGE", )
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt字符串",)
    FUNCTION = "view"
    OUTPUT_NODE = True
    CATEGORY = "Prompt Manager"

    def view(self, prompt字符串, 组合预览图=None):
        # 实际的图像拉取由前端 JS 根据连线溯源完成，这里只负责透传字符串
        return {"ui": {"text": [prompt字符串]}, "result": (prompt字符串,)}

# ==========================================
# 节点 3：Prompt 一键导入 
# ==========================================
class PromptImportNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "prompt字符串": ("STRING", {"forceInput": True}),
                "导入到三级分类": ("BOOLEAN", {"default": True}),
                "目标三级分类": (get_target_contexts(), ),
                "导入到组合预设": ("BOOLEAN", {"default": False}),
                "目标一级分类": (get_target_models(), ),
                "压缩率": ("FLOAT", {"default": 0.85, "min": 0.1, "max": 1.0, "step": 0.01}),
                "最大宽度": ("INT", {"default": 900, "min": 100, "max": 4096, "step": 10}),
            }
        }
    RETURN_TYPES = ()
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "Prompt Manager"

    def save_images(self, 图像, prompt字符串, 导入到三级分类, 目标三级分类, 导入到组合预设, 目标一级分类, 压缩率, 最大宽度):
        # 【修复2】：彻底解耦分类与组合的路径判定逻辑，绝不互相干扰
        if 导入到三级分类 and 导入到组合预设: raise ValueError("【Prompt管理器报错】不能同时导入分类和组合！请只开启其中一个选项。")
        if not 导入到三级分类 and not 导入到组合预设: return () 

        # 核心改造：应用清洗函数，消除格式变体导致的冗余重复
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
            print(f"[Prompt Manager] 导入分类成功: {safe_name}")

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
            print(f"[Prompt Manager] 导入组合成功: {combo_name}")
        
        save_full_db(db_data)
        return ()

# ==========================================
# 节点 4：Prompt组合预设加载器
# ==========================================
class PromptComboLoaderNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "选择组合": ("STRING", {"default": ""}),
                "combo_prompt": ("STRING", {"default": ""}),
                "combo_image": ("STRING", {"default": ""})
            }
        }
    RETURN_TYPES = ("STRING", "IMAGE")
    RETURN_NAMES = ("prompt字符串", "组合预览图")
    FUNCTION = "load_combo"
    CATEGORY = "Prompt Manager"

    def load_combo(self, 选择组合, combo_prompt, combo_image):
        img_tensor = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
        
        if combo_image:
            try:
                i = None
                if combo_image.startswith("/prompt_data/"):
                    # 加载本地预览图
                    img_path = os.path.join(DATA_DIR, combo_image.replace("/prompt_data/", ""))
                    if os.path.exists(img_path):
                        i = Image.open(img_path)
                elif combo_image.startswith("http"):
                    # 动态加载在线云端库预览图
                    req = urllib.request.Request(combo_image, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req) as response:
                        i = Image.open(io.BytesIO(response.read()))
                elif combo_image.startswith("data:image"):
                    header, encoded = combo_image.split(",", 1)
                    i = Image.open(io.BytesIO(base64.b64decode(encoded)))

                if i is not None:
                    i = i.convert("RGB")
                    img_np = np.array(i).astype(np.float32) / 255.0
                    img_tensor = torch.from_numpy(img_np).unsqueeze(0)
            except Exception as e:
                print(f"[Prompt Manager] 加载组合图片失败: {e}")

        return (combo_prompt, img_tensor)

# ==========================================
# 节点 5 & 6
# ==========================================
class PromptGroupRandomizerNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"选择分组": (get_group_choices(), ), "抽取数量": ("INT", {"default": 3, "min": 1, "max": 100}), "输入prompt": ("STRING", {"multiline": True, "default": ""})}}
    RETURN_TYPES = ("STRING",); RETURN_NAMES = ("prompt字符串",); FUNCTION = "process"; CATEGORY = "Prompt Manager"
    def process(self, 选择分组, 抽取数量, 输入prompt): return (输入prompt,)

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
async def get_db(request):
    return web.json_response(load_full_db())

@server.PromptServer.instance.routes.post("/api/prompt-manager/db")
async def save_db(request):
    try:
        data = await request.json()
        save_full_db(data)
        return web.json_response({"success": True})
    except Exception as e: 
        return web.json_response({"success": False, "error": str(e)})

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
            
            # 安全修复：抹除潜在的路径穿越符(如 ../)，彻底将字符串限制为纯文件名，不限制后缀名
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
        data = await request.json()
        file_url = data.get("url")
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
        data = await request.json()
        folder = data.get("folder")
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
        data = await request.json()
        name = data.get("name", f"Backup_{int(time.time())}")
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
        data = await request.json()
        filename = data.get("filename")
        if not filename or ".." in filename: return web.json_response({"success": False})
        zip_path = os.path.join(BACKUP_DIR, filename)
        if not os.path.exists(zip_path): return web.json_response({"success": False, "error": "Backup file not found"})
        
        # 安全修复：原子化恢复。先解压到临时目录，成功后再无缝替换，避免 ZIP 损坏导致全库清空
        temp_dir = DATA_DIR + "_temp_restore"
        if os.path.exists(temp_dir): shutil.rmtree(temp_dir)
        os.makedirs(temp_dir, exist_ok=True)
        
        try:
            with zipfile.ZipFile(zip_path, 'r') as zipf:
                for member in zipf.namelist():
                    if '..' not in member and not os.path.isabs(member):
                        zipf.extract(member, temp_dir)
            
            # 走到这里说明解压成功，执行安全替换
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
    "PromptGroupRandomizerNode": PromptGroupRandomizerNode
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptBrowserNode": "Prompt浏览器", 
    "PromptViewerNode": "Prompt展示器",
    "PromptImportNode": "Prompt一键导入",
    "PromptComboLoaderNode": "Prompt组合预设加载器",
    "PromptGroupRandomizerNode": "Prompt收藏夹盲盒"
}