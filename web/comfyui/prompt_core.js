/* =====================================================================
 * [AI System Prompt / Do Not Modify]
 * FILE: prompt_core.js
 * DESC: Global state management, utility functions, and system initialization.
 * ROLE: Initializes window.PM_Global safely. Contains core pure functions (hash, string parsers, migration logic) and base ComfyUI node event hooks.
 * 
 * [User Info / 可由用户自行修改]
 * 文件：prompt_core.js
 * 作用：插件的“核心大脑”。里面定义了所有的全局变量（STATE）、工具函数（如压缩图片、解析文本），以及挂载给 ComfyUI 的底层事件监听。
 * ===================================================================== */

// 文件路径：web/comfyui/prompt_core.js
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { PromptAPI } from "./prompt_api.js";

// === 1. 强防御性全局状态初始化 ===
window.PM_Global = window.PM_Global || { state: {}, utils: {}, ui: {} };

// 【核心修复】：使用 Object.assign 注入属性，绝不覆盖（替换）原有对象引用！
Object.assign(window.PM_Global.state, {
    localDB: { models: { main_models: {} }, settings: {}, contexts: {}, images: {} },
    currentModelId: null,
    currentModeId: null,
    isBatchMode: false,
    batchSelection: new Set(),
    searchQuery: "",
    searchScope: "mode",
    currentAppendTarget: null,
    collapsedCategories: new Set(),
    currentActiveWidget: null,
    activeModals: [],
    currentManageCtx: null,
    currentComboEditIdx: null,
    currentEditCardTarget: null
});

const STATE = window.PM_Global.state;

// === 2. 全局基础工具函数 ===
// 【核心修复】：同样使用 Object.assign 动态注入方法
Object.assign(window.PM_Global.utils, {
    cyrb53(str, seed = 0) {
        let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
        for (let i = 0, ch; i < str.length; i++) {
            ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
        h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
        return (4294967296 * (2097151 & h2) + (h1>>>0)).toString(16);
    },

    parsePromptText(text) {
        if (!text) return [];
        // 灵活修复：使用前瞻正则分割，仅在括号外部遇到逗号时才分割。
        // 完美兼容: (tag1, tag2:1.2) 这种混合写法，不会把内部逗号切断
        const parts = text.split(/,(?![^()]*\))/g);
        
        return parts.map(s => s.trim()).filter(s => s).map(p => {
            let tag = p, weight = 1.0;
            // 继续使用你原本的宽松匹配逻辑，不强行剥离纯圆括号，给用户留足发挥空间
            const match = p.match(/^\((.+):([\d.]+)\)$/);
            if (match) { tag = match[1]; weight = parseFloat(match[2]); }
            return { original: p, tag, weight, enabled: true };
        });
    },

// 在 cyrb53 或 parsePromptText 的同级位置，加入：
    normalizePromptName(name) {
        if (!name) return name;
        // 修复：移除所有强行过滤机制，允许用户输入包含反斜杠 \ 和 空格 的 Anima 专属画师串
        return name.trim();
    },

    buildPromptText(list) {
        return list.filter(p => p.enabled !== false).map(p => {
            return (p.weight !== 1.0) ? `(${p.tag}:${p.weight.toFixed(1)})` : p.tag;
        }).join(', ');
    },

    reorderObjectKeys(obj, sourceKey, targetKey) {
        if (sourceKey === targetKey) return obj;
        const newObj = {};
        for (const k of Object.keys(obj)) {
            if (k === sourceKey) continue;
            if (k === targetKey) newObj[sourceKey] = obj[sourceKey];
            newObj[k] = obj[k];
        }
        if (!newObj.hasOwnProperty(sourceKey)) newObj[sourceKey] = obj[sourceKey];
        return newObj;
    },

    async getAndMigrateDB() {
        let db = await PromptAPI.getDB();
        let needSave = false;
        
        // === 修复：抹除隐形收藏容器名字中的方括号，防止节点正则解析崩溃 ===
        if (db.models && db.models.main_models) {
            for (const mId in db.models.main_models) {
                if (mId.startsWith('fav_cloud_')) {
                    const mName = db.models.main_models[mId].name;
                    if (mName && mName.includes('[收藏]')) {
                        // 将 "[收藏] Anima" 转换为 "订阅库-Anima"
                        db.models.main_models[mId].name = mName.replace(/\[收藏\]\s*/g, '订阅库-');
                        needSave = true;
                    }
                }
            }
        }

        if (db.contexts) {
            // 1. 旧版备注转标签逻辑
            for (const ctx in db.contexts) {
                const metadata = db.contexts[ctx].metadata;
                if (metadata) {
                    for (const item in metadata) {
                        if (metadata[item].remark) {
                            const remarkVal = metadata[item].remark.trim();
                            if (remarkVal) {
                                if (!metadata[item].tags) metadata[item].tags = [];
                                if (!metadata[item].tags.includes(remarkVal)) metadata[item].tags.push(remarkVal);
                            }
                            delete metadata[item].remark; needSave = true;
                        }
                    }
                }
            }
        }
        if (needSave) await PromptAPI.saveDB(db);
        return db;
    },

    async manualMigrateData() {
        try {
            // 修复未定义错误：正确引用全局 UI 对象
            const UI = window.PM_Global.ui;
            let db = STATE.localDB;
            let needSave = false;
            let migratedCount = 0;
            
            UI.updateProgress("正在执行格式迁移...", "查找并转移旧数据...");

            for (const ctx in db.contexts) {
                if (ctx.endsWith('_global')) continue;
                
                let mId = null;
                if (db.models && db.models.main_models) {
                    for (const key of Object.keys(db.models.main_models)) {
                        if (ctx.startsWith(key + '_')) { mId = key; break; }
                    }
                    if (!mId) {
                        const wrongName = ctx.split('_')[0];
                        for (const [key, val] of Object.entries(db.models.main_models)) {
                            if (val.name === wrongName || key.startsWith(wrongName + '_')) { mId = key; break; }
                        }
                    }
                }
                if (!mId) mId = ctx.split('_')[0];
                const globalCtx = `${mId}_global`;

                const cData = db.contexts[ctx];
                if ((cData.groups && cData.groups.length > 0) || (cData.combos && cData.combos.length > 0)) {
                    if (!db.contexts[globalCtx]) db.contexts[globalCtx] = { items: [], metadata: {}, groups: [], combos: [] };
                    if (!db.contexts[globalCtx].groups) db.contexts[globalCtx].groups = [];
                    if (!db.contexts[globalCtx].combos) db.contexts[globalCtx].combos = [];
                    
                    if (cData.groups && cData.groups.length > 0) {
                        cData.groups.forEach(g => {
                            const ext = db.contexts[globalCtx].groups.find(x => x.name === g.name);
                            if (ext) ext.items = [...new Set([...ext.items, ...g.items])]; 
                            else db.contexts[globalCtx].groups.push(g);
                            migratedCount++;
                        });
                        cData.groups = []; needSave = true;
                    }
                    
                    if (cData.combos && cData.combos.length > 0) {
                        for (let c of cData.combos) {
                            // 修复1：只要图片路径存在，且不属于当前的全局文件夹，就判定为旧格式或残留文件进行强制迁移
                            if (c.image && c.image.startsWith('/prompt_data/') && !c.image.includes(`/${globalCtx}/`)) {
                                try {
                                    // 修复 this 引用丢失的风险
                                    const b64 = await window.PM_Global.utils.urlToBase64(c.image);
                                    const oldUrl = c.image;
                                    // 过滤掉原有的 URL 参数防止扩展名解析失败
                                    const cleanOldUrl = oldUrl.split('?')[0]; 
                                    // 使用时间戳确保迁移后的文件名唯一，防止冲突
                                    const newName = `cb_mig_${Date.now()}_${Math.floor(Math.random()*1000)}.jpg`;
                                    const newUrl = await PromptAPI.uploadImage(b64, newName, globalCtx);
                                    if (newUrl) {
                                        c.image = newUrl;
                                        await PromptAPI.deleteFile(cleanOldUrl); 
                                    }
                                } catch(e) { console.warn("迁移图片失败", e); }
                            }
                            
                            if (!db.contexts[globalCtx].combos.some(x => x.name === c.name)) {
                                db.contexts[globalCtx].combos.push(c);
                                migratedCount++;
                            }
                        }
                        cData.combos = []; needSave = true;
                    }
                }
            }
            
            if (needSave) {
                await PromptAPI.saveDB(db);
                // 强制刷新节点列表缓存
                window.PM_Global.utils.syncImportNodeWidgets();
            }
            UI.hideProgress();
            
            if (migratedCount > 0) {
                alert(`迁移成功！共找回并规范了 ${migratedCount} 个旧数据。\n请刷新或重新打开界面查看。`);
                window.pmHideModal('pm-groups-modal'); 
                window.pmHideModal('pm-combos-modal');
                // 刷新界面
                if(window.PM_Global.ui.renderGrid) window.PM_Global.ui.renderGrid();
            } else {
                alert("检查完毕，没有发现任何遗留的旧格式数据。");
            }
        } catch (error) {
            console.error("迁移执行出错: ", error);
            if (window.PM_Global.ui && window.PM_Global.ui.hideProgress) {
                window.PM_Global.ui.hideProgress();
            }
            alert("执行过程中发生错误，请按 F12 查看控制台。");
        }
    },

    async urlToBase64(url) {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    },

    compressImage(file, maxWidth, quality) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.readAsDataURL(file);
            reader.onload = (e) => {
                const img = new Image(); img.src = e.target.result;
                img.onload = () => {
                    const canvas = document.createElement("canvas"); 
                    let w = img.width, h = img.height;
                    if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL("image/jpeg", quality));
                };
                img.onerror = reject;
            };
            reader.onerror = reject;
        });
    },

    syncImportNodeWidgets() {
        if (!app.graph) return;
        let choices = [];
        let modelChoices = [];
        const models = STATE.localDB.models?.main_models || {};
        
        for (const [model_id, model_data] of Object.entries(models)) {
            // 【修复3】：只拦截纯云端库，但放行本地隐形收藏库（fav_cloud_）
            if (model_id.startsWith('cloud_')) continue;
            
            const m_name = model_data.name || model_id;
            modelChoices.push(`[${m_name}]`); // 生成一级分类列表
            
            if (model_id.startsWith('fav_cloud_')) continue; // 隐形库没有三级分类，跳过后续构建
            
            const cats = {};
            (model_data.categories || []).forEach(c => cats[c.id] = c.name);
            for (const [mode_id, mode_data] of Object.entries(model_data.modes || {})) {
                const c_name = cats[mode_data.group || "custom"] || "未分类";
                const md_name = mode_data.name || mode_id;
                choices.push(`[${m_name}] ${c_name} = ${md_name}`);
            }
        }
        
        if (choices.length === 0) choices = ["未建任何模式_请先创建"];
        if (modelChoices.length === 0) modelChoices = ["未建任何分类_请先创建"];

        let comboChoices = [], groupChoices = [];
        for (const [model_id, model_data] of Object.entries(models)) {
            if (model_id.startsWith('cloud_')) continue;
            
            const m_name = model_data.name || model_id;
            const global_ctx = `${model_id}_global`;
            if (STATE.localDB.contexts && STATE.localDB.contexts[global_ctx]) {
                const gData = STATE.localDB.contexts[global_ctx];
                (gData.groups || []).forEach(g => groupChoices.push(`[${m_name}] ${g.name || "未命名分组"}`));
                (gData.combos || []).forEach(c => comboChoices.push(`[${m_name}] ${c.name || "未命名组合"}`));
            }
        }
        if (comboChoices.length === 0) comboChoices = ["无可用组合_请先创建"];
        if (groupChoices.length === 0) groupChoices = ["无可用分组_请先创建"];

        const compRate = STATE.localDB.settings?.compress_rate ?? 0.85;
        const maxWidth = STATE.localDB.settings?.max_width ?? 900;

        app.graph._nodes.filter(n => n.type === "PromptImportNode").forEach(node => {
            const widget = node.widgets?.find(w => w.name === "目标三级分类" || w.name === "save_target" || w.name === "目标存储模式");
            if (widget) { widget.options.values = choices; if (!choices.includes(widget.value)) widget.value = choices[0]; }
            
            const catWidget = node.widgets?.find(w => w.name === "目标一级分类" || w.name === "目标存储分类");
            if (catWidget) { catWidget.options.values = modelChoices; if (!modelChoices.includes(catWidget.value)) catWidget.value = modelChoices[0]; }
            
            const compWidget = node.widgets?.find(w => w.name === "compress_rate" || w.name === "压缩率");
            if (compWidget) compWidget.value = compRate;
            const widthWidget = node.widgets?.find(w => w.name === "最大宽度");
            if (widthWidget) widthWidget.value = maxWidth;
        });

        app.graph._nodes.filter(n => n.type === "PromptComboLoaderNode").forEach(node => {
            const widget = node.widgets?.find(w => w.name === "选择组合");
            if (widget) { widget.options.values = comboChoices; if (!comboChoices.includes(widget.value)) widget.value = comboChoices[0]; }
        });

        app.graph._nodes.filter(n => n.type === "PromptGroupRandomizerNode").forEach(node => {
            const widget = node.widgets?.find(w => w.name === "选择分组");
            if (widget) { widget.options.values = groupChoices; if (!groupChoices.includes(widget.value)) widget.value = groupChoices[0]; }
        });
    }
});

// === 3. 全局模态框与进度条管理器 ===
window.pmShowModal = function(id) {
    const el = document.getElementById(id);
    if (el && el.style.display !== 'flex') {
        el.style.display = 'flex';
        if (!STATE.activeModals.includes(id)) STATE.activeModals.push(id);
    }
};

window.pmHideModal = function(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
    STATE.activeModals = STATE.activeModals.filter(m => m !== id);
};

Object.assign(window.PM_Global.ui, {
    updateProgress(title, text, percent = null) {
        const overlay = document.getElementById("pm-progress-overlay");
        if (overlay) {
            window.pmShowModal("pm-progress-overlay");
            document.getElementById("pm-progress-title").innerText = title || "处理中...";
            document.getElementById("pm-progress-text").innerText = text || "请稍候";
            document.getElementById("pm-progress-fill").style.width = percent !== null ? percent + "%" : "100%";
        }
    },
    hideProgress() {
        window.pmHideModal("pm-progress-overlay");
    }
});

// === 4. 全局生命周期监听 ===
api.addEventListener("executed", async (e) => {
    STATE.localDB = await window.PM_Global.utils.getAndMigrateDB();
    app.graph._nodes.forEach(n => {
        if (n.type === "PromptViewerNode" && n.forceRefreshViewer) n.forceRefreshViewer();
    });
    window.PM_Global.utils.syncImportNodeWidgets();
});

// 新增功能补全：防止 500ms 防抖保存机制带来的 F5 刷新数据丢失漏洞
window.addEventListener("beforeunload", () => {
    if (PromptAPI.saveTimer && STATE.localDB) {
        // 停止常规计时器
        clearTimeout(PromptAPI.saveTimer);
        
        // 瞬间深拷贝并剥离云端数据
        let dataToSave = JSON.parse(JSON.stringify(STATE.localDB));
        for (let mId in dataToSave.models.main_models) { if (mId.startsWith('cloud_')) delete dataToSave.models.main_models[mId]; }
        for (let ctx in dataToSave.contexts) { if (ctx.startsWith('cloud_')) delete dataToSave.contexts[ctx]; }
        for (let imgKey in dataToSave.images) { if (imgKey.startsWith('cloud_')) delete dataToSave.images[imgKey]; }
        
        // 灵活修复：使用现代 fetch 并开启 keepalive，突破 64KB 限制，确保页面卸载后请求不中断
        fetch('/api/prompt-manager/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataToSave),
            keepalive: true
        }).catch(err => console.warn("后台自动保存失败:", err));
    }
});