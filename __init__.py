# === 路径配置 ===
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

NODE_ROOT = os.path.dirname(os.path.abspath(__file__))
WEB_DIRECTORY = os.path.join(NODE_ROOT, "web", "comfyui")
DATA_DIR = os.path.join(NODE_ROOT, "data")
os.makedirs(DATA_DIR, exist_ok=True)
DB_FILE = os.path.join(DATA_DIR, "prompt_database.json")
BACKUP_DIR = os.path.join(NODE_ROOT, "backup")
os.makedirs(BACKUP_DIR, exist_ok=True)

# ==========================================
# 辅助函数：动态读取数据库中的分类 (显示为: [标签] 分类 = 模式)
# ==========================================
def get_target_contexts():
    choices = []
    try:
        if os.path.exists(DB_FILE):
            with open(DB_FILE, 'r', encoding='utf-8') as f:
                db = json.load(f)
                models = db.get("models", {}).get("main_models", {})
                for model_id, model_data in models.items():
                    model_name = model_data.get("name", model_id)
                    cats = {c.get("id"): c.get("name") for c in model_data.get("categories", [])}
                    for mode_id, mode_data in model_data.get("modes", {}).items():
                        mode_name = mode_data.get("name", mode_id)
                        cat_id = mode_data.get("group", "custom")
                        cat_name = cats.get(cat_id, "未分类")
                        choices.append(f"[{model_name}] {cat_name} = {mode_name}")
    except:
        pass
    
    if not choices:
        choices = ["未建任何模式_请先创建"]
    return choices

# ==========================================
# 节点 1：Prompt 浏览器 
# ==========================================
class PromptBrowserNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "输入prompt": ("STRING", {"multiline": True, "default": ""}),
                # === 新增：自动随机控制控件 ===
                "自动随机抽取": ("BOOLEAN", {"default": False}),
                "抽取数量": ("INT", {"default": 3, "min": 1, "max": 100, "step": 1}),
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt字符串",)
    FUNCTION = "process"
    CATEGORY = "Prompt Manager"

    def process(self, 输入prompt, 自动随机抽取, 抽取数量):
        # Python端仅做透传，抽取逻辑和自动刷新都交由前端拦截处理
        return (输入prompt,)

# ==========================================
# 节点 2：Prompt 展示器
# ==========================================
class PromptViewerNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt字符串": ("STRING", {"forceInput": True}),
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt字符串",)
    FUNCTION = "view"
    OUTPUT_NODE = True
    CATEGORY = "Prompt Manager"

    def view(self, prompt字符串):
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
                "导入到模式": ("BOOLEAN", {"default": True}),
                "目标存储模式": (get_target_contexts(), ),
                "导入到组合": ("BOOLEAN", {"default": False}),
                "压缩率": ("FLOAT", {"default": 0.85, "min": 0.1, "max": 1.0, "step": 0.01}),
                "最大宽度": ("INT", {"default": 900, "min": 100, "max": 4096, "step": 10}),
            }
        }
    RETURN_TYPES = ()
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "Prompt Manager"

    def save_images(self, 图像, prompt字符串, 导入到模式, 目标存储模式, 导入到组合, 压缩率, 最大宽度):
        if 导入到模式 and 导入到组合:
            raise ValueError("【Prompt管理器报错】'导入到模式' 和 '导入到组合' 不能同时开启！")
        if not 导入到模式 and not 导入到组合:
            return () # 两个都关闭则直接跳过导入

        safe_name = prompt字符串.strip()
        if not safe_name: return ()
        
        if 导入到模式:
            if 目标存储模式 == "未建任何模式_请先创建" or not 目标存储模式:
                raise ValueError("【Prompt管理器报错】无法导入到模式！请先打开Prompt浏览器节点，至少创建一个模型、分类和模式！")

        file_safe_name = "".join([c for c in safe_name if c.isalnum()]).rstrip()[:20]

        if os.path.exists(DB_FILE):
            with open(DB_FILE, 'r', encoding='utf-8') as f: db_data = json.load(f)
        else:
            db_data = {"contexts": {}, "images": {}}

        target_ctx = None
        models = db_data.get("models", {}).get("main_models", {})
        for model_id, model_data in models.items():
            m_name = model_data.get("name", model_id)
            cats = {c.get("id"): c.get("name") for c in model_data.get("categories", [])}
            for mode_id, mode_data in model_data.get("modes", {}).items():
                c_name = cats.get(mode_data.get("group", "custom"), "未分类")
                md_name = mode_data.get("name", mode_id)
                check_str = f"[{m_name}] {c_name} = {md_name}"
                if check_str == 目标存储模式:
                    target_ctx = f"{model_id}_{mode_id}"
                    break
            if target_ctx: break
        
        if not target_ctx:
            # 即使是单独导入到组合，我们也需要挂载在一个上下文里，兜底分配
            target_ctx = list(db_data.get("contexts", {}).keys())[0] if db_data.get("contexts") else "custom_custom"
            
        ctx = target_ctx

        if "contexts" not in db_data: db_data["contexts"] = {}
        if "images" not in db_data: db_data["images"] = {}
        if ctx not in db_data["contexts"]:
            db_data["contexts"][ctx] = {"items": [], "metadata": {}, "cart": [], "groups": [], "combos": []}
            
        ctx_data = db_data["contexts"][ctx]
        target_dir = os.path.join(DATA_DIR, ctx)
        os.makedirs(target_dir, exist_ok=True)
        
        saved_urls = []
        for i, image_tensor in enumerate(图像):
            img_np = 255. * image_tensor.cpu().numpy()
            img_pil = Image.fromarray(np.clip(img_np, 0, 255).astype(np.uint8))
            w, h = img_pil.size
            if w > 最大宽度:
                new_h = int(h * (最大宽度 / w))
                img_pil = img_pil.resize((最大宽度, new_h), Image.LANCZOS)
            
            img_name = f"gen_{file_safe_name}_{torch.randint(0, 100000, (1,)).item()}.jpg"
            img_path = os.path.join(target_dir, img_name)
            img_pil.save(img_path, format="JPEG", quality=int(压缩率 * 100))
            saved_urls.append(f"/prompt_data/{ctx}/{img_name}")

        # 逻辑一：导入到模式
        if 导入到模式:
            if safe_name not in ctx_data["items"]: ctx_data["items"].append(safe_name)
            if safe_name not in ctx_data["metadata"]: ctx_data["metadata"][safe_name] = {"tags": []}
                
            img_key = f"{ctx}_{safe_name}"
            if img_key not in db_data["images"]: db_data["images"][img_key] = []
            db_data["images"][img_key].extend(saved_urls)
            ctx_data["metadata"][safe_name]["imgCount"] = len(db_data["images"][img_key])
            print(f"[Prompt Manager] 导入模式成功: {safe_name}")

        # 逻辑二：导入到组合
        if 导入到组合:
            if "combos" not in ctx_data: ctx_data["combos"] = []
            parts = [p.strip() for p in safe_name.split(',') if p.strip()]
            elements = []
            for p in parts:
                tag = p
                weight = 1.0
                match = re.match(r'^\((.+):([\d.]+)\)$', p)
                if match:
                    tag = match.group(1)
                    weight = float(match.group(2))
                elements.append({"tag": tag, "weight": weight})
            
            combo_name = f"自动组合_{int(time.time())}"
            combo_img = saved_urls[0] if saved_urls else None
            ctx_data["combos"].insert(0, {
                "name": combo_name,
                "elements": elements,
                "image": combo_img
            })
            print(f"[Prompt Manager] 导入组合成功: {combo_name}")
        
        with open(DB_FILE, 'w', encoding='utf-8') as f:
            json.dump(db_data, f, ensure_ascii=False, indent=2)
            
        return ()

# ==========================================
# 辅助函数：动态读取数据库中的所有组合预设
# ==========================================
def get_combo_choices():
    choices = []
    try:
        if os.path.exists(DB_FILE):
            with open(DB_FILE, 'r', encoding='utf-8') as f:
                db = json.load(f)
                for ctx_id, ctx_data in db.get("contexts", {}).items():
                    for combo in ctx_data.get("combos", []):
                        combo_name = combo.get("name", "未命名组合")
                        if combo_name not in choices:
                            choices.append(combo_name)
    except:
        pass
    if not choices:
        choices = ["无可用组合_请先创建"]
    return choices

# ==========================================
# 节点 4：Prompt组合预设加载器 (含图像输出)
# ==========================================
class PromptComboLoaderNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "选择组合": (get_combo_choices(), ),
            }
        }
    RETURN_TYPES = ("STRING", "IMAGE")
    RETURN_NAMES = ("prompt字符串", "组合预览图")
    FUNCTION = "load_combo"
    CATEGORY = "Prompt Manager"

    def load_combo(self, 选择组合):
        prompt_str = ""
        # 默认返回一个空的黑色图像占位符，防止如果没图片时 ComfyUI 报错
        img_tensor = torch.zeros((1, 64, 64, 3), dtype=torch.float32)

        if 选择组合 == "无可用组合_请先创建":
            return (prompt_str, img_tensor)
        
        try:
            if os.path.exists(DB_FILE):
                with open(DB_FILE, 'r', encoding='utf-8') as f:
                    db = json.load(f)
                    for ctx_id, ctx_data in db.get("contexts", {}).items():
                        for c in ctx_data.get("combos", []):
                            if c.get("name") == 选择组合:
                                # 1. 组装 Prompt
                                elements = c.get("elements", [])
                                parts = []
                                for el in elements:
                                    tag = el.get("tag", "")
                                    weight = float(el.get("weight", 1.0))
                                    if weight != 1.0:
                                        parts.append(f"({tag}:{weight})")
                                    else:
                                        parts.append(tag)
                                prompt_str = ", ".join(parts)
                                
                                # 2. 读取并转换本地图片为 Tensor 传给工作流
                                img_url = c.get("image")
                                if img_url and img_url.startswith("/prompt_data/"):
                                    rel_path = img_url.replace("/prompt_data/", "")
                                    img_path = os.path.join(DATA_DIR, rel_path)
                                    if os.path.exists(img_path):
                                        i = Image.open(img_path).convert("RGB")
                                        img_tensor = torch.from_numpy(np.array(i).astype(np.float32) / 255.0).unsqueeze(0)
                                
                                return (prompt_str, img_tensor)
        except Exception as e:
            print(f"[Prompt Manager] 加载组合报错: {e}")
            
        return (prompt_str, img_tensor)

# ==========================================
# 节点 6：实时 Prompt 预览图
# ==========================================
class PromptPreviewNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
            }
        }
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "preview"
    CATEGORY = "Prompt Manager"

    def preview(self, 图像):
        # Python端仅做透传，无缝接入原生工作流。真正的无延迟预览交由 JS 端实时处理。
        return (图像,)

# ==========================================
# 辅助函数：动态读取数据库中的所有收藏分组
# ==========================================
def get_group_choices():
    choices = []
    try:
        if os.path.exists(DB_FILE):
            with open(DB_FILE, 'r', encoding='utf-8') as f:
                db = json.load(f)
                for ctx_id, ctx_data in db.get("contexts", {}).items():
                    for group in ctx_data.get("groups", []):
                        g_name = group.get("name", "未命名分组")
                        choices.append(f"{ctx_id} || {g_name}")
    except:
        pass
    if not choices:
        choices = ["无可用分组_请先创建"]
    return choices

# ==========================================
# 节点 5：Prompt收藏夹盲盒
# ==========================================
class PromptGroupRandomizerNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "选择分组": (get_group_choices(), ),
                "抽取数量": ("INT", {"default": 3, "min": 1, "max": 100, "step": 1}),
                "输入prompt": ("STRING", {"multiline": True, "default": ""}),
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt字符串",)
    FUNCTION = "process"
    CATEGORY = "Prompt Manager"

    def process(self, 选择分组, 抽取数量, 输入prompt):
        # Python端仅做透传，抽取逻辑和列表UI均由前端节点处理
        return (输入prompt,)

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
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, 'r', encoding='utf-8') as f: return web.json_response(json.load(f))
        except: pass
    return web.json_response({})

@server.PromptServer.instance.routes.post("/api/prompt-manager/db")
async def save_db(request):
    try:
        data = await request.json()
        with open(DB_FILE, 'w', encoding='utf-8') as f: json.dump(data, f, ensure_ascii=False, indent=2)
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
            
            filepath = os.path.join(target_dir, filename)
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
        for item in os.listdir(DATA_DIR):
            item_path = os.path.join(DATA_DIR, item)
            if os.path.isfile(item_path): os.remove(item_path)
            elif os.path.isdir(item_path): shutil.rmtree(item_path)
        with zipfile.ZipFile(zip_path, 'r') as zipf: zipf.extractall(DATA_DIR)
        return web.json_response({"success": True})
    except Exception as e: return web.json_response({"success": False, "error": str(e)})

NODE_CLASS_MAPPINGS = {
    "PromptBrowserNode": PromptBrowserNode, 
    "PromptViewerNode": PromptViewerNode,
    "PromptImportNode": PromptImportNode,
    "PromptComboLoaderNode": PromptComboLoaderNode,
    "PromptGroupRandomizerNode": PromptGroupRandomizerNode,
    "PromptPreviewNode": PromptPreviewNode
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptBrowserNode": "Prompt浏览器", 
    "PromptViewerNode": "Prompt展示器",
    "PromptImportNode": "Prompt一键导入",
    "PromptComboLoaderNode": "Prompt组合预设加载器",
    "PromptGroupRandomizerNode": "Prompt收藏夹盲盒",
    "PromptPreviewNode": "Prompt实时预览图"
}