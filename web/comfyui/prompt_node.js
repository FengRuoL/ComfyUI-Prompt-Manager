// 文件路径：web/comfyui/prompt_node.js
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { PromptAPI } from "./prompt_api.js";

let currentActiveWidget = null;
let localDB = { models: { main_models: {} }, settings: {}, contexts: {}, images: {} };

let currentModelId = null;
let currentModeId = null;

let isBatchMode = false;
let batchSelection = new Set();
let searchQuery = "";
let searchScope = "mode"; 
let currentAppendTarget = null; 

// === 新增：侧边栏大分类的折叠状态记录 ===
let collapsedCategories = new Set();

// ==========================================
// 全局模态框(弹窗)层级栈管理器 
// ==========================================
window.pmActiveModals = [];

window.pmShowModal = function(id) {
    const el = document.getElementById(id);
    if (el && el.style.display !== 'flex') {
        el.style.display = 'flex';
        if (!window.pmActiveModals.includes(id)) {
            window.pmActiveModals.push(id);
        }
    }
};

window.pmHideModal = function(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
    window.pmActiveModals = window.pmActiveModals.filter(m => m !== id);
};

// ==========================================
// 全局节点状态同步器
// ==========================================
function syncImportNodeWidgets() {
    if (!app.graph) return;
    let choices = [];
    const models = localDB.models?.main_models || {};
    for (const [model_id, model_data] of Object.entries(models)) {
        const m_name = model_data.name || model_id;
        const cats = {};
        (model_data.categories || []).forEach(c => cats[c.id] = c.name);
        for (const [mode_id, mode_data] of Object.entries(model_data.modes || {})) {
            const c_name = cats[mode_data.group || "custom"] || "未分类";
            const md_name = mode_data.name || mode_id;
            choices.push(`[${m_name}] ${c_name} = ${md_name}`);
        }
    }
    if (choices.length === 0) choices = ["未建任何模式_请先创建"];

    // 组合下拉菜单的数据构建
    let comboChoices = [];
    let groupChoices = []; // 分组下拉菜单数据构建
    for (const [ctx_id, ctx_data] of Object.entries(localDB.contexts || {})) {
        (ctx_data.combos || []).forEach(c => {
            const combo_name = c.name || "未命名组合";
            if (!comboChoices.includes(combo_name)) comboChoices.push(combo_name);
        });
        (ctx_data.groups || []).forEach(g => {
            const g_name = g.name || "未命名分组";
            groupChoices.push(`${ctx_id} || ${g_name}`); // 盲盒节点仍需 ctx_id 以防跨模式同名冲突
        });
    }
    if (comboChoices.length === 0) comboChoices = ["无可用组合_请先创建"];
    if (groupChoices.length === 0) groupChoices = ["无可用分组_请先创建"];

    const compRate = localDB.settings?.compress_rate ?? 0.85;
    const maxWidth = localDB.settings?.max_width ?? 900;

    // 1. 刷新导入节点
    const importNodes = app.graph._nodes.filter(n => n.type === "PromptImportNode");
    importNodes.forEach(node => {
        const widget = node.widgets?.find(w => w.name === "save_target" || w.name === "目标存储模式");
        if (widget) {
            widget.options.values = choices;
            if (!choices.includes(widget.value)) widget.value = choices[0];
        }
        const compWidget = node.widgets?.find(w => w.name === "compress_rate" || w.name === "压缩率");
        if (compWidget) compWidget.value = compRate;
        
        const widthWidget = node.widgets?.find(w => w.name === "最大宽度");
        if (widthWidget) widthWidget.value = maxWidth;
    });

    // 2. 刷新组合加载器节点
    const comboNodes = app.graph._nodes.filter(n => n.type === "PromptComboLoaderNode");
    comboNodes.forEach(node => {
        const widget = node.widgets?.find(w => w.name === "选择组合");
        if (widget) {
            widget.options.values = comboChoices;
            if (!comboChoices.includes(widget.value)) widget.value = comboChoices[0];
        }
    });

    // 3. 刷新收藏夹盲盒节点
    const blindBoxNodes = app.graph._nodes.filter(n => n.type === "PromptGroupRandomizerNode");
    blindBoxNodes.forEach(node => {
        const widget = node.widgets?.find(w => w.name === "选择分组");
        if (widget) {
            widget.options.values = groupChoices;
            if (!groupChoices.includes(widget.value)) widget.value = groupChoices[0];
        }
    });
}

api.addEventListener("executed", async (e) => {
    localDB = await getAndMigrateDB();
    app.graph._nodes.forEach(n => {
        if (n.type === "PromptViewerNode" && n.forceRefreshViewer) {
            n.forceRefreshViewer();
        }
    });
    syncImportNodeWidgets();
});


// ==========================================
// 辅助函数
// ==========================================
function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
    h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1>>>0)).toString(16);
}

function parsePromptText(text) {
    if (!text) return [];
    const parts = text.split(',').map(s => s.trim()).filter(s => s);
    return parts.map(p => {
        let tag = p;
        let weight = 1.0;
        const match = p.match(/^\((.+):([\d.]+)\)$/);
        if (match) {
            tag = match[1];
            weight = parseFloat(match[2]);
        }
        return { original: p, tag, weight, enabled: true };
    });
}

function buildPromptText(list) {
    return list.filter(p => p.enabled !== false).map(p => {
        if (p.weight !== 1.0) return `(${p.tag}:${p.weight.toFixed(1)})`;
        return p.tag;
    }).join(', ');
}

// === 新增：用于拖拽排序字典对象的辅助方法 ===
function reorderObjectKeys(obj, sourceKey, targetKey) {
    if (sourceKey === targetKey) return obj;
    const newObj = {};
    for (const k of Object.keys(obj)) {
        if (k === sourceKey) continue;
        if (k === targetKey) {
            newObj[sourceKey] = obj[sourceKey];
        }
        newObj[k] = obj[k];
    }
    if (!newObj.hasOwnProperty(sourceKey)) {
        newObj[sourceKey] = obj[sourceKey];
    }
    return newObj;
}

async function getAndMigrateDB() {
    let db = await PromptAPI.getDB();
    let needSave = false;
    if (db.contexts) {
        for (const ctx in db.contexts) {
            const metadata = db.contexts[ctx].metadata;
            if (metadata) {
                for (const item in metadata) {
                    if (metadata[item].remark) {
                        const remarkVal = metadata[item].remark.trim();
                        if (remarkVal) {
                            if (!metadata[item].tags) metadata[item].tags = [];
                            if (!metadata[item].tags.includes(remarkVal)) {
                                metadata[item].tags.push(remarkVal);
                            }
                        }
                        delete metadata[item].remark;
                        needSave = true;
                    }
                }
            }
        }
    }
    if (needSave) {
        await PromptAPI.saveDB(db);
    }
    return db;
}

// 辅助：从现有 URL 读取文件转换为 Base64
async function urlToBase64(url) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch(e) {
        console.error("图片转换失败", e);
        throw e;
    }
}

// ==========================================
// 节点 1 注册：PromptBrowserNode (含列表栏)
// ==========================================
app.registerExtension({
    name: "PromptManager.BrowserNode",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "PromptBrowserNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                const promptWidget = this.widgets.find(w => w.name === "prompt_text" || w.name === "输入prompt");
                
                const listContainer = document.createElement("div");
                listContainer.style.cssText = "width: 100%; min-height: 50px; max-height: 180px; overflow-y: auto; background: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 5px; box-sizing: border-box; display: flex; flex-direction: column; gap: 4px; font-family: sans-serif;";
                
                listContainer.addEventListener("wheel", (e) => e.stopPropagation(), { passive: false });
                listContainer.addEventListener("pointerdown", (e) => e.stopPropagation());

                const header = document.createElement("div");
                header.style.cssText = "display: flex; justify-content: space-between; font-size: 11px; color: #ff6b9d; font-weight: bold; padding: 0 5px 4px 5px; border-bottom: 1px dashed rgba(255,107,157,0.4); margin-bottom: 4px;";
                header.innerHTML = `<span>&lt;Prompt&gt;</span><span style="padding-right:38px;">&lt;权重&gt;</span>`;
                
                const listBody = document.createElement("div");
                listBody.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
                
                listContainer.appendChild(header);
                listContainer.appendChild(listBody);

                this.addDOMWidget("prompt_list", "HTML", listContainer, { serialize: false, hideOnZoom: false });

                let cachedList = [];
                let isUpdatingFromList = false;

                const renderList = () => {
                    listBody.innerHTML = '';
                    
                    if (!isUpdatingFromList) {
                        cachedList = parsePromptText(promptWidget.value);
                    }

                    if (cachedList.length === 0) {
                        listBody.innerHTML = '<div style="color:#555; font-size:11px; text-align:center; padding:10px;">暂无 Prompt</div>';
                        return;
                    }

                    cachedList.forEach((item, index) => {
                        const row = document.createElement("div");
                        row.style.cssText = `display: flex; justify-content: space-between; align-items: center; background: #252525; padding: 4px 6px; border-radius: 4px; transition: 0.2s; ${item.enabled === false ? 'opacity: 0.4;' : ''}`;
                        
                        const tagSpan = document.createElement("span");
                        tagSpan.style.cssText = `color: #ddd; font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; cursor: pointer; user-select: none; ${item.enabled === false ? 'text-decoration: line-through;' : ''}`;
                        tagSpan.title = "双击停用(移除) / 恢复启用";
                        tagSpan.innerText = item.tag;

                        tagSpan.ondblclick = (e) => {
                            e.stopPropagation();
                            isUpdatingFromList = true;
                            item.enabled = item.enabled === false ? true : false;
                            promptWidget.value = buildPromptText(cachedList);
                            app.graph.setDirtyCanvas(true);
                            renderList();
                            setTimeout(() => { isUpdatingFromList = false; }, 50);
                        };

                        const rightCtrl = document.createElement("div");
                        rightCtrl.style.cssText = "display: flex; align-items: center; gap: 6px;";

                        const numInput = document.createElement("input");
                        numInput.type = "number";
                        numInput.step = "0.1";
                        numInput.value = item.weight.toFixed(1);
                        numInput.disabled = item.enabled === false;
                        numInput.style.cssText = `width: 45px; background: #111; border: 1px solid #444; color: #ff6b9d; font-size: 12px; font-weight: bold; border-radius: 4px; text-align: center; outline: none; ${item.enabled === false ? 'cursor: not-allowed; opacity: 0.5;' : ''}`;
                        
                        numInput.onchange = (e) => {
                            isUpdatingFromList = true;
                            item.weight = parseFloat(e.target.value) || 1.0;
                            promptWidget.value = buildPromptText(cachedList);
                            app.graph.setDirtyCanvas(true);
                            renderList();
                            setTimeout(() => { isUpdatingFromList = false; }, 50);
                        };

                        const delBtn = document.createElement("button");
                        delBtn.innerHTML = "×";
                        delBtn.title = "彻底删除此项";
                        delBtn.style.cssText = "background: #5a1a1a; color: #f44336; border: none; border-radius: 4px; width: 22px; height: 22px; cursor: pointer; font-weight: bold; display: flex; align-items: center; justify-content: center; transition: 0.2s;";
                        delBtn.onmouseover = () => delBtn.style.background = "#f44336";
                        delBtn.onmouseout = () => delBtn.style.background = "#5a1a1a";
                        delBtn.onclick = (e) => {
                            e.stopPropagation();
                            isUpdatingFromList = true;
                            cachedList.splice(index, 1);
                            promptWidget.value = buildPromptText(cachedList);
                            app.graph.setDirtyCanvas(true);
                            renderList();
                            setTimeout(() => { isUpdatingFromList = false; }, 50);
                        };

                        rightCtrl.appendChild(numInput);
                        rightCtrl.appendChild(delBtn);

                        row.appendChild(tagSpan);
                        row.appendChild(rightCtrl);
                        listBody.appendChild(row);
                    });
                };

                const originalCallback = promptWidget.callback;
                promptWidget.callback = function() {
                    if (originalCallback) originalCallback.apply(this, arguments);
                    if (!isUpdatingFromList) renderList();
                };

                renderList();

                this.addWidget("button", "打开 Prompt 浏览器", "open", async () => {
                    currentActiveWidget = promptWidget;
                    localDB = await getAndMigrateDB();
                    if (!localDB.models) localDB.models = {};
                    if (!localDB.models.main_models) localDB.models.main_models = {};
                    if (!localDB.contexts) localDB.contexts = {};
                    if (!localDB.images) localDB.images = {};
                    openNativeBrowser();
                });

                this.addWidget("button", "随机挑选", "random", async () => {
                    if (Object.keys(localDB.contexts || {}).length === 0) {
                        localDB = await getAndMigrateDB();
                    }
                    if (!currentModelId) currentModelId = Object.keys(localDB.models?.main_models || {})[0];
                    if (!currentModeId && currentModelId) {
                        currentModeId = Object.keys(localDB.models.main_models[currentModelId].modes || {})[0];
                    }
                    
                    const ctx = `${currentModelId}_${currentModeId}`;
                    if (!localDB.contexts || !localDB.contexts[ctx] || !localDB.contexts[ctx].items) return;
                    
                    const dataItems = localDB.contexts[ctx].items;
                    if (dataItems.length === 0) return;
                    
                    const count = Math.min(dataItems.length, Math.floor(Math.random() * 4) + 3);
                    const shuffled = [...dataItems].sort(() => 0.5 - Math.random());
                    const selected = shuffled.slice(0, count);
                    
                    const newParsed = selected.map(tag => ({ original: tag, tag: tag, weight: 1.0, enabled: true }));
                    promptWidget.value = buildPromptText(newParsed);
                    app.graph.setDirtyCanvas(true);
                    renderList();
                });
                
                this.setSize([400, 350]);
            };
        }
    }
});

// ==========================================
// 节点 2 注册：PromptViewerNode (实时展示器) - 已深度修复交互重构！
// ==========================================

function findImagesForTagFromDB(tag, db) {
    if (!db.images || !db.contexts) return [];
    const cleanTag = tag.trim().toLowerCase();
    let allImgs = [];
    
    for (const ctx in db.contexts) {
        const items = db.contexts[ctx].items || [];
        const matchedItem = items.find(i => i.toLowerCase() === cleanTag);
        if (matchedItem) {
            const imgKey = `${ctx}_${matchedItem}`;
            if (db.images[imgKey] && db.images[imgKey].length > 0) {
                allImgs.push(...db.images[imgKey]);
            }
        }
    }
    return [...new Set(allImgs)];
}

async function renderViewerCards(container, textValue, nodeInstance) {
    container.innerHTML = '';
    const parsed = parsePromptText(textValue);
    
    if (parsed.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #555; font-size: 12px; padding: 20px;">等待输入连接...</div>`;
        return;
    }

    if (Object.keys(localDB.contexts).length === 0) {
        localDB = await getAndMigrateDB();
    }

    parsed.forEach(item => {
        const card = document.createElement("div");
        card.style.cssText = "background: #222; border: 1px solid #333; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; transition: 0.2s; align-self: start;";
        
        const images = findImagesForTagFromDB(item.tag, localDB);
        let currentImgIndex = 0;

        const imgWrap = document.createElement("div");
        imgWrap.style.cssText = "width: 100%; aspect-ratio: 1/1; background: #111; position: relative; overflow: hidden;";
        
        // 【终极绝缘防御墙】：使用原生监听器，彻底切断 ComfyUI/LiteGraph 的底层事件劫持
        const stopEvent = (e) => { e.stopPropagation(); };
        imgWrap.addEventListener("pointerdown", stopEvent);
        imgWrap.addEventListener("mousedown", stopEvent);
        imgWrap.addEventListener("mouseup", stopEvent);
        imgWrap.addEventListener("click", stopEvent);
        imgWrap.addEventListener("wheel", stopEvent);

        if (images.length > 0) {
            const imgEl = document.createElement("img");
            imgEl.src = images[currentImgIndex];
            // 恢复图片本身的响应，抛弃 pointer-events: none 黑科技
            imgEl.style.cssText = "width: 100%; height: 100%; object-fit: cover; transition: 0.2s; cursor: zoom-in; pointer-events: auto;";
            
            // 使用 pointerup 触发机制，确保手指/鼠标抬起时必定能穿透执行
            imgEl.addEventListener("pointerup", (e) => {
                e.preventDefault();
                e.stopPropagation();
                let viewer = document.getElementById("pm-standalone-viewer");
                if (!viewer) {
                    viewer = document.createElement("div");
                    viewer.id = "pm-standalone-viewer";
                    viewer.style.cssText = "position: fixed; top:0; left:0; width:100vw; height:100vh; background: rgba(0,0,0,0.85); z-index: 999999; display:none; flex-direction:column; align-items:center; justify-content:center; cursor: zoom-out;";
                    viewer.innerHTML = `<img id="pm-standalone-img" src="" style="max-width: 90%; max-height: 90%; object-fit: contain; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.8);">`;
                    document.body.appendChild(viewer);
                    viewer.addEventListener("pointerup", (ve) => {
                        ve.stopPropagation();
                        pmHideModal("pm-standalone-viewer");
                    });
                }
                const fullImgEl = document.getElementById("pm-standalone-img");
                if (fullImgEl) {
                    fullImgEl.src = images[currentImgIndex];
                    pmShowModal("pm-standalone-viewer");
                }
            });

            imgWrap.appendChild(imgEl);

            // 多图切换按钮（同样上防御墙）
            if (images.length > 1) {
                const btnStyle = "position: absolute; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.6); color: white; border: none; padding: 4px 6px; cursor: pointer; border-radius: 4px; font-weight: bold; font-size: 9px; z-index: 10; transition: 0.2s;";
                
                const leftBtn = document.createElement("button");
                leftBtn.innerText = "◀";
                leftBtn.style.cssText = btnStyle + "left: 4px;";
                leftBtn.onmouseover = () => leftBtn.style.background = "#ff6b9d";
                leftBtn.onmouseout = () => leftBtn.style.background = "rgba(0,0,0,0.6)";
                
                const rightBtn = document.createElement("button");
                rightBtn.innerText = "▶";
                rightBtn.style.cssText = btnStyle + "right: 4px;";
                rightBtn.onmouseover = () => rightBtn.style.background = "#ff6b9d";
                rightBtn.onmouseout = () => rightBtn.style.background = "rgba(0,0,0,0.6)";
                
                leftBtn.addEventListener("pointerdown", stopEvent);
                leftBtn.addEventListener("mousedown", stopEvent);
                leftBtn.addEventListener("pointerup", (e) => {
                    e.preventDefault(); e.stopPropagation();
                    currentImgIndex = (currentImgIndex - 1 + images.length) % images.length;
                    imgEl.src = images[currentImgIndex];
                });

                rightBtn.addEventListener("pointerdown", stopEvent);
                rightBtn.addEventListener("mousedown", stopEvent);
                rightBtn.addEventListener("pointerup", (e) => {
                    e.preventDefault(); e.stopPropagation();
                    currentImgIndex = (currentImgIndex + 1) % images.length;
                    imgEl.src = images[currentImgIndex];
                });
                
                imgWrap.appendChild(leftBtn);
                imgWrap.appendChild(rightBtn);
            }

        } else {
            // 无图时的渲染
            imgWrap.style.cursor = "default";
            imgWrap.innerHTML = `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #444; font-size: 11px; font-weight: bold;">无图</div>`;
        }

        const tagDiv = document.createElement("div");
        tagDiv.style.cssText = "padding: 6px; font-size: 11px; color: #ddd; text-align: center; word-break: break-all; font-weight: bold; border-top: 1px solid #333;";
        tagDiv.innerText = item.tag;
        
        if (item.weight !== 1.0) {
            const weightBadge = document.createElement("div");
            weightBadge.style.cssText = "position: absolute; top: 4px; right: 4px; background: rgba(255,107,157,0.8); color: white; font-size: 10px; font-weight: bold; padding: 2px 4px; border-radius: 4px;";
            weightBadge.innerText = item.weight;
            imgWrap.appendChild(weightBadge);
        }

        card.appendChild(imgWrap);
        card.appendChild(tagDiv);
        container.appendChild(card);
    });

    if (nodeInstance) {
        app.graph.setDirtyCanvas(true);
    }
}

app.registerExtension({
    name: "PromptManager.ViewerNode",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "PromptViewerNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                
                const container = document.createElement("div");
                container.style.cssText = "width: 100%; min-width: 200px; min-height: 100px; height: 100%; overflow-y: auto; background: #151515; border-radius: 8px; padding: 10px; box-sizing: border-box; display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 8px;";
                
                this.addDOMWidget("viewer_grid", "HTML", container, { serialize: false, hideOnZoom: false });
                
                this.viewerContainer = container;
                this.lastPrompt = null;

                this.forceRefreshViewer = () => {
                    this.lastPrompt = null;
                };
                
                const checkUpdate = async () => {
                    if (this.flags?.collapsed || !this.graph) {
                        setTimeout(checkUpdate, 500); return;
                    }
                    
                    let currentVal = "";
                    const input = this.inputs?.find(inp => inp.name === "prompt_text" || inp.name === "prompt字符串");
                    if (input && input.link) {
                        const link = this.graph.links[input.link];
                        if (link) {
                            const originNode = this.graph.getNodeById(link.origin_id);
                            if (originNode) {
                                const pWidget = originNode.widgets?.find(w => w.name === "prompt_text" || w.name === "输入prompt");
                                if (pWidget) currentVal = pWidget.value;
                            }
                        }
                    }
                    
                    if (currentVal !== this.lastPrompt && currentVal !== null) {
                        this.lastPrompt = currentVal;
                        await renderViewerCards(this.viewerContainer, currentVal, this);
                    }
                    setTimeout(checkUpdate, 500);
                };
                
                checkUpdate();
                this.setSize([400, 300]);
            };

            const onExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (message) {
                if (onExecuted) onExecuted.apply(this, arguments);
                if (message && message.text) {
                    const newVal = message.text[0];
                    if (newVal !== this.lastPrompt) {
                        this.lastPrompt = newVal;
                        renderViewerCards(this.viewerContainer, newVal, this);
                    }
                }
            };
        }
    }
});


// ==========================================
// 模态框相关的 HTML/CSS 与逻辑 (Prompt浏览器)
// ==========================================

function openNativeBrowser() {
    let container = document.getElementById("pm-native-modal");
    
    if (!document.getElementById("pm-native-style")) {
        const style = document.createElement("style");
        style.id = "pm-native-style";
        style.innerHTML = `
            /* ... 原有 CSS 保持不变 ... */
            #pm-native-modal {
                position: fixed; top: 8vh; left: 15vw; width: 70vw; height: 85vh;
                background: #1e1e1e; border: 1px solid rgba(255,107,157,0.5); border-radius: 16px;
                display: flex; flex-direction: column; z-index: 10000;
                box-shadow: 0 10px 50px rgba(0,0,0,0.8); color: #ccc; font-family: sans-serif;
                resize: both; overflow: hidden; min-width: 800px; min-height: 500px;
            }
            .pm-header { padding: 12px 20px; background: #252525; display: flex; justify-content: space-between; align-items: center; cursor: move; border-bottom: 1px solid #333;}
            .pm-close-btn { background: #d32f2f; border: none; color: white; padding: 6px 14px; border-radius: 8px; cursor: pointer; font-weight: bold; transition: 0.2s;}
            .pm-close-btn:hover { background: #f44336; transform: scale(1.05); }
            
            ::-webkit-scrollbar { width: 8px; height: 8px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: rgba(255,107,157,0.3); border-radius: 4px; }
            ::-webkit-scrollbar-thumb:hover { background: rgba(255,107,157,0.6); }

            .pm-tabs { display: flex; background: #222; border-bottom: 1px solid #333; padding: 0 10px; overflow-x: auto; align-items: center;}
            .pm-tab-wrap { display: flex; align-items: center; border-bottom: 3px solid transparent; transition: 0.2s;}
            .pm-tab-wrap.active { border-bottom-color: #ff6b9d; background: #2a2a2a;}
            .pm-tab-btn { background: transparent; border: none; color: #888; padding: 12px 15px; font-size: 13px; font-weight: bold; cursor: pointer; white-space: nowrap;}
            .pm-tab-btn:hover { color: #ddd; }
            .pm-tab-wrap.active .pm-tab-btn { color: #ff6b9d; }
            
            .pm-body { display: flex; flex: 1; overflow: hidden; }
            .pm-sidebar { width: 250px; background: #1a1a1a; border-right: 1px solid #333; display: flex; flex-direction: column; }
            .pm-sidebar-scroll { flex: 1; padding: 10px; overflow-y: auto; display: flex; flex-direction: column; }
            
            .pm-cat-wrap { margin-top: 15px; margin-bottom: 5px; }
            .pm-cat-header { display: flex; justify-content: space-between; align-items: center; padding: 0 5px; margin-bottom: 5px;}
            .pm-cat-title { font-size: 14px; color: #888; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;}
            
            .pm-mode-wrap { display: flex; align-items: center; justify-content: space-between; padding-right: 5px; border-radius: 8px; transition: 0.2s; margin-bottom: 2px;}
            .pm-mode-wrap:hover { background: #2a2a2a; }
            .pm-mode-wrap.active { background: rgba(255,107,157,0.1); border-left: 4px solid #ff6b9d; }
            .pm-mode-btn { background: transparent; border: none; color: #bbb; text-align: left; padding: 8px 10px; flex: 1; cursor: pointer; font-size: 13px; }
            .pm-mode-wrap.active .pm-mode-btn { color: #ff6b9d; font-weight: bold;}
            
            .pm-ctrl-group { display: flex; gap: 4px; }
            .pm-ctrl-btn { background: rgba(0,0,0,0.3); border: 1px solid #444; color: #888; font-size: 11px; cursor: pointer; padding: 4px 8px; border-radius: 6px; transition: 0.2s; display: flex; align-items: center; justify-content: center; font-weight:bold;}
            .pm-ctrl-btn:hover { background: #333; color: #fff; border-color: #666; }
            .pm-ctrl-btn.del:hover { background: #5a1a1a; color: #f44336; border-color: #f44336; }
            
            .pm-divider { border-bottom: 1px dashed rgba(255,107,157,0.3); margin: 15px 5px 10px 5px; }
            
            .pm-add-btn { background: transparent; border: 1px dashed rgba(255,107,157,0.5); color: #777; padding: 8px; border-radius: 8px; font-size: 12px; cursor: pointer; text-align: center; transition: 0.2s; font-weight:bold;}
            .pm-add-btn:hover { border-color: #ff6b9d; color: #ff6b9d; background: rgba(255,107,157,0.1); }

            .pm-sidebar-footer { padding: 15px; background: #151515; border-top: 1px solid #333; display: flex; flex-direction: column; gap: 8px; }
            .pm-sidebar-group { margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px dashed rgba(255,107,157,0.3); }
            .pm-sidebar-group:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
            .pm-sidebar-label { font-size: 11px; color: #777; margin-bottom: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
            .pm-btn-row { display: flex; gap: 8px; margin-bottom: 8px; }

            .pm-action-btn { background: #2a2a2a; border: 1px solid #444; color: #ccc; padding: 8px; border-radius: 8px; cursor: pointer; font-size: 12px; transition: 0.2s; text-align: center; font-weight: bold;}
            .pm-action-btn:hover { background: #333; color: #fff; border-color: #666; transform: translateY(-1px);}
            .pm-action-btn.primary { background: rgba(255,107,157,0.15); color: #ff6b9d; border-color: rgba(255,107,157,0.4); }
            .pm-action-btn.primary:hover { background: #ff6b9d; color: #fff; border-color: #ff6b9d; }
            
            .pm-main-container { flex: 1; display: flex; flex-direction: column; background: #151515; overflow: hidden; position: relative;}
            
            .pm-toolbar { display: flex; gap: 15px; padding: 12px 20px; background: #1e1e1e; border-bottom: 1px solid #333; align-items: center;}
            .pm-search-input { flex: 1; padding: 10px 15px; background: #111; border: 1px solid #444; border-radius: 8px; color: #ddd; font-size: 13px; outline: none; transition: 0.2s;}
            .pm-search-input:focus { border-color: #ff6b9d; box-shadow: 0 0 5px rgba(255,107,157,0.3);}
            .pm-scope-select { padding: 10px; background: #111; border: 1px solid #444; border-radius: 8px; color: #ddd; font-size: 13px; outline: none;}
            
            .pm-zoom-slider { width: 100px; cursor: pointer; accent-color: #ff6b9d; }
            .pm-toolbar-right { display: flex; align-items: center; gap: 10px; background: #111; padding: 8px 15px; border-radius: 8px; border: 1px solid #444; }

            .pm-main { flex: 1; padding: 20px; overflow-y: auto; display: grid; gap: 20px; align-content: start; position: relative;}
            #pm-marquee { position: absolute; border: 1px solid #ff6b9d; background: rgba(255, 107, 157, 0.2); pointer-events: none; display: none; z-index: 100; border-radius:4px;}

            .pm-card { background: #222; padding: 12px; border-radius: 12px; border: 1px solid #333; transition: 0.2s; display: flex; flex-direction: column;}
            .pm-card:hover { border-color: #ff6b9d; box-shadow: 0 4px 15px rgba(0,0,0,0.5), 0 0 10px rgba(255,107,157,0.1); transform: translateY(-2px);}
            .pm-card.in-prompt { border-color: #ff6b9d; background: rgba(255,107,157,0.05); box-shadow: 0 0 10px rgba(255,107,157,0.2);}
            .pm-card.batch-selected { border-color: #f44336; background: #3a1e1e; }

            .pm-card-img-wrap { width: 100%; aspect-ratio: 1/1; background: #1a1a1a; margin-bottom: 10px; border-radius: 8px; overflow: hidden; position: relative;}
            .pm-card img { width: 100%; height: 100%; object-fit: cover; }
            .pm-no-img { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #555; font-size: 13px; font-weight:bold;}

            .pm-nav-arrow { position: absolute; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.6); color: white; border: none; padding: 8px 12px; cursor: pointer; z-index: 5; opacity: 0; transition: 0.2s; border-radius: 8px; font-weight: bold; }
            .pm-card-img-wrap:hover .pm-nav-arrow { opacity: 1; }
            .pm-nav-arrow.left { left: 8px; }
            .pm-nav-arrow.right { right: 8px; }
            .pm-nav-arrow:hover { background: #ff6b9d; }

            .pm-del-img-btn { position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.6); color: #fff; border: 1px solid #555; padding: 2px 6px; cursor: pointer; z-index: 10; transition: 0.2s; border-radius: 4px; font-weight: bold; font-size: 12px; }
            .pm-del-img-btn:hover { background: #f44336; border-color: #f44336; }

            .pm-card-title { font-size: 14px; text-align: center; color: #ddd; word-break: break-all; line-height: 1.3; font-weight: bold; }
            .pm-card-source { font-size: 11px; text-align: center; color: #888; margin-top: 4px; }
            
            .pm-card-tags { font-size: 11px; padding: 8px 0; display: flex; flex-wrap: wrap; gap: 6px; border-top: 1px dashed rgba(255,107,157,0.3); border-bottom: 1px dashed rgba(255,107,157,0.3); min-height: 32px; align-content: flex-start; margin-top: 8px; }
            .pm-tag { background: rgba(255, 107, 157, 0.15); border: 1px solid rgba(255, 107, 157, 0.4); padding: 3px 8px; border-radius: 12px; color: #ff6b9d; white-space: nowrap; font-weight: bold; }
            
            .pm-card-actions { display: flex; justify-content: flex-start; padding-top: 10px; gap: 6px; flex-wrap: wrap;}
            .pm-text-btn { background: #2a2a2a; color: #ccc; border: 1px solid #444; padding: 4px 6px; border-radius: 6px; cursor: pointer; transition: 0.2s; font-size: 11px; font-weight: bold; white-space: nowrap; }
            .pm-text-btn:hover { background: #ff6b9d; border-color: #ff6b9d; color: #fff; }
            .pm-text-btn.danger:hover { background: #f44336; border-color: #f44336; color: #fff; }
            .pm-text-btn.warning { color: #f8961e; border-color: #835213; }
            .pm-text-btn.warning:hover { background: #f8961e; color: #fff; border-color: #f8961e; }

            .pm-batch-bar { background: #222; border-top: 1px solid rgba(255,107,157,0.5); padding: 15px 20px; display: none; justify-content: space-between; align-items: center; }
            .pm-batch-bar.active { display: flex; }

            .pm-modal-overlay { position: fixed; top:0; left:0; width:100vw; height:100vh; background: rgba(0,0,0,0.85); z-index: 20001; display:none; flex-direction:column; align-items:center; justify-content:center;}
            .pm-list-item { background: #1a1a1a; border: 1px solid #333; padding: 15px; margin-bottom: 10px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center;}
            
            .pm-create-box { background: #222; width: 500px; border-radius: 16px; border: 1px solid rgba(255,107,157,0.5); display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.8);}
            .pm-create-header { padding: 20px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; background: #1a1a1a; font-size:16px;}
            .pm-create-tabs { display: flex; background: #111; border-bottom: 1px solid #333;}
            .pm-ct-btn { flex: 1; padding: 15px; background: transparent; border: none; color: #888; cursor: pointer; font-size: 14px; font-weight: bold; border-bottom: 3px solid transparent; transition:0.2s;}
            .pm-ct-btn.active { color: #ff6b9d; border-bottom-color: #ff6b9d; background: #222;}
            .pm-create-content { padding: 25px; color: #ccc; font-size: 13px; }
            .pm-input-text { width: 100%; padding: 12px; background: #111; border: 1px solid #444; border-radius: 8px; color: #ddd; margin-top: 10px; outline: none; transition:0.2s;}
            .pm-input-text:focus { border-color: #ff6b9d; box-shadow: 0 0 5px rgba(255,107,157,0.3);}

            .pm-combo-card { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; display: flex; padding: 15px; gap: 15px; margin-bottom: 15px; transition: 0.2s; }
            .pm-combo-card:hover { border-color: #ff6b9d; background: #222; box-shadow: 0 4px 15px rgba(0,0,0,0.4);}

            #pm-viewer-img { max-width: 90%; max-height: 90%; object-fit: contain; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); }

            .pm-progress-wrap { background: #222; padding: 30px 40px; border-radius: 16px; border: 1px solid #ff6b9d; display: flex; flex-direction: column; align-items: center; min-width: 350px; box-shadow: 0 10px 40px rgba(0,0,0,0.9); }
            .pm-progress-bar-container { width: 100%; height: 10px; background: #111; border-radius: 5px; overflow: hidden; margin-bottom: 15px; border: 1px solid #444; }
            #pm-progress-fill { width: 0%; height: 100%; background: linear-gradient(90deg, #ff6b9d, #ff8dae); transition: width 0.3s ease; }

            /* === 新增：拖拽占位符高亮样式 === */
            .pm-drag-over-tab { border-bottom-color: #f44336 !important; background: rgba(244,67,54,0.2) !important; }
            .pm-drag-over-cat { border: 1px dashed #ff6b9d !important; background: rgba(255,107,157,0.05) !important; }
            .pm-drag-over-mode { border-top: 2px solid #ff6b9d !important; background: rgba(255,107,157,0.2) !important; transform: translateY(2px); }
        `;
        document.head.appendChild(style);

        // 新建卡片弹窗
        const createModal = document.createElement("div");
        createModal.className = "pm-modal-overlay";
        createModal.id = "pm-create-modal";
        createModal.innerHTML = `
            <div class="pm-create-box">
                <div class="pm-create-header">
                    <b style="color:#ff6b9d;">新建卡片</b>
                    <button class="pm-close-btn" onclick="pmHideModal('pm-create-modal')">关闭</button>
                </div>
                <div class="pm-create-tabs">
                    <button class="pm-ct-btn active" id="ct-btn-img" onclick="switchCreateTab('img')">图片批量上传</button>
                    <button class="pm-ct-btn" id="ct-btn-txt" onclick="switchCreateTab('txt')">单文本创建</button>
                    <button class="pm-ct-btn" id="ct-btn-file" onclick="switchCreateTab('file')">TXT导入</button>
                </div>
                <div class="pm-create-content">
                    <div id="ct-content-img" style="display:block;">
                        <p style="color:#888; margin-bottom:15px; line-height:1.5;">选择多张图片，系统将以去后缀的文件名自动创建对应的带图卡片。（已包含哈希去重优化）</p>
                        <button class="pm-action-btn primary" style="width:100%; padding:12px; font-size:14px;" onclick="document.getElementById('pm-hidden-create-img').click()">选择图片文件...</button>
                        <input type="file" id="pm-hidden-create-img" multiple accept="image/*" style="display:none;">
                    </div>
                    <div id="ct-content-txt" style="display:none;">
                        <p style="color:#888;">创建一个纯提示词卡片：</p>
                        <input type="text" id="pm-create-single-input" class="pm-input-text" placeholder="输入 Prompt...">
                        <button class="pm-action-btn primary" style="width:100%; margin-top:20px; padding:12px; font-size:14px;" onclick="createSinglePrompt()">确认创建</button>
                    </div>
                    <div id="ct-content-file" style="display:none;">
                        <p style="color:#888; margin-bottom:15px; line-height:1.5;">上传 .txt 文件，自动按逗号或换行分割批量创建文本卡片。</p>
                        <button class="pm-action-btn primary" style="width:100%; padding:12px; font-size:14px;" onclick="document.getElementById('pm-hidden-create-txt').click()">选择 TXT 文件...</button>
                        <input type="file" id="pm-hidden-create-txt" accept=".txt" style="display:none;">
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(createModal);

        // 高级导入配置弹窗
        const importModal = document.createElement("div");
        importModal.className = "pm-modal-overlay";
        importModal.id = "pm-import-modal";
        importModal.style.zIndex = "20002";
        importModal.innerHTML = `
            <div class="pm-create-box" style="width: 550px;">
                <div class="pm-create-header">
                    <b style="color:#ff6b9d;">📥 智能导入引擎</b>
                    <button class="pm-close-btn" onclick="pmHideModal('pm-import-modal')">关闭</button>
                </div>
                <div class="pm-create-content" style="padding: 20px;">
                    <div style="background: rgba(255,107,157,0.1); padding:10px; border-radius:8px; margin-bottom:15px; border: 1px dashed rgba(255,107,157,0.3);">
                        <span style="font-weight:bold; color:#ff6b9d; display:block; margin-bottom:5px;">📦 解析到数据包信息：</span>
                        包含子分类数: <span id="pm-import-ctx-count" style="font-weight:bold; color:#fff;"></span> 个分类
                    </div>
                    
                    <label style="font-weight:bold; margin-bottom:10px; display:block; color:#eee;">📍 请选择数据的导入去向：</label>
                    
                    <div style="display:flex; flex-direction:column; gap:10px; margin-bottom: 20px;">
                        <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; background: #1a1a1a; padding: 10px; border-radius: 8px; border: 1px solid #333;">
                            <input type="radio" name="pm-import-target" value="current_tab" checked style="margin-top: 3px;">
                            <div>
                                <div style="font-weight:bold; color:#ff6b9d;">导入到当前的模型大标签页</div>
                                <div style="font-size:11px; color:#888; margin-top:4px;">智能转换并挂载到当前打开的标签下。如果缺失对应分类，将自动创建。</div>
                            </div>
                        </label>
                        <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; background: #1a1a1a; padding: 10px; border-radius: 8px; border: 1px solid #333;">
                            <input type="radio" name="pm-import-target" value="current_mode" style="margin-top: 3px;">
                            <div>
                                <div style="font-weight:bold; color:#ccc;">强制合并到当前选中的小分类</div>
                                <div style="font-size:11px; color:#888; margin-top:4px;">无视数据包结构，将所有卡片强行揉捏并全部塞进当前的分类里。</div>
                            </div>
                        </label>
                        <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; background: #1a1a1a; padding: 10px; border-radius: 8px; border: 1px solid #333;">
                            <input type="radio" name="pm-import-target" value="original" style="margin-top: 3px;">
                            <div>
                                <div style="font-weight:bold; color:#ccc;">原路严格恢复</div>
                                <div style="font-size:11px; color:#888; margin-top:4px;">无视您现在打开了哪个标签，强行依照数据包保存时的路径写回原处。</div>
                            </div>
                        </label>
                    </div>

                    <div style="border-top:1px dashed #444; padding-top:15px;">
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:bold; color:#ff6b9d;">
                            <input type="checkbox" id="pm-import-merge-check" checked>
                            🧩 与目标位置的现有数据进行追加合并 (保留旧卡片)
                        </label>
                    </div>
                    
                    <button class="pm-action-btn primary" style="width:100%; padding:12px; margin-top: 20px; font-size:14px;" onclick="executeImportFinal()">开始导入</button>
                </div>
            </div>
        `;
        document.body.appendChild(importModal);

        const imgViewer = document.createElement("div");
        imgViewer.id = "pm-image-viewer";
        imgViewer.className = "pm-modal-overlay";
        imgViewer.style.zIndex = "20005"; // 强制置于最顶层，防止被组合面板遮挡
        imgViewer.innerHTML = `<img id="pm-viewer-img" src="">`;
        document.body.appendChild(imgViewer);
        imgViewer.onclick = () => pmHideModal("pm-image-viewer");

        const progressOverlay = document.createElement("div");
        progressOverlay.id = "pm-progress-overlay";
        progressOverlay.className = "pm-modal-overlay";
        progressOverlay.style.zIndex = "20005";
        progressOverlay.innerHTML = `
            <div class="pm-progress-wrap">
                <h3 id="pm-progress-title" style="color:#ff6b9d; margin:0 0 15px 0;">处理中...</h3>
                <div class="pm-progress-bar-container"><div id="pm-progress-fill"></div></div>
                <div id="pm-progress-text" style="font-size:14px; color:#ccc; font-weight:bold;">0%</div>
            </div>
        `;
        document.body.appendChild(progressOverlay);

        const editCardModal = document.createElement("div");
        editCardModal.className = "pm-modal-overlay";
        editCardModal.id = "pm-edit-card-modal";
        editCardModal.style.zIndex = "20002";
        editCardModal.innerHTML = `
            <div class="pm-create-box" style="width: 450px;">
                <div class="pm-create-header">
                    <b style="color:#ff6b9d;">✏️ 编辑卡片 Prompt</b>
                    <button class="pm-close-btn" onclick="pmHideModal('pm-edit-card-modal')">关闭</button>
                </div>
                <div class="pm-create-content" style="padding: 20px;">
                    <label style="color:#ccc; font-weight:bold; margin-bottom:8px; display:block;">修改 Prompt 名称</label>
                    <input type="text" id="pm-edit-card-input" class="pm-input-text" style="margin-top:0; margin-bottom: 15px;">
                    
                    <label style="color:#ccc; font-weight:bold; margin-bottom:8px; display:block;">🏷️ 卡片标签 (逗号分隔)</label>
                    <input type="text" id="pm-edit-card-tags" class="pm-input-text" style="margin-top:0; margin-bottom: 25px;" placeholder="标签A, 标签B...">
                    
                    <button class="pm-action-btn primary" style="width:100%; padding:12px; font-size:14px;" onclick="executeEditCard()">保存修改</button>
                </div>
            </div>
        `;
        document.body.appendChild(editCardModal);

        window.currentEditCardTarget = null;
        window.openEditCardModal = function(item, ctx) {
            window.currentEditCardTarget = { item, ctx };
            document.getElementById("pm-edit-card-input").value = item;
            
            const tags = localDB.contexts[ctx]?.metadata?.[item]?.tags || [];
            document.getElementById("pm-edit-card-tags").value = tags.join(", ");
            
            pmShowModal("pm-edit-card-modal");
        };

        window.executeEditCard = async function() {
            if (!window.currentEditCardTarget) return;
            const { item, ctx } = window.currentEditCardTarget;
            const newVal = document.getElementById("pm-edit-card-input").value.trim();
            const tagsStr = document.getElementById("pm-edit-card-tags").value.trim();
            const newTags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(t => t) : [];
            
            if (!newVal) { alert("Prompt 不能为空！"); return; }
            
            const ctxData = localDB.contexts[ctx];
            if (newVal !== item && ctxData.items.includes(newVal)) {
                alert("该 Prompt 已存在！"); return;
            }
            
            updateProgress("正在修改...", "同步数据");
            try {
                if (newVal !== item) {
                    const itemIdx = ctxData.items.indexOf(item);
                    if (itemIdx > -1) ctxData.items[itemIdx] = newVal;
                    
                    if (ctxData.metadata && ctxData.metadata[item]) {
                        ctxData.metadata[newVal] = ctxData.metadata[item];
                        delete ctxData.metadata[item];
                    }
                    
                    if (ctxData.groups) {
                        ctxData.groups.forEach(g => {
                            const idx = g.items.indexOf(item);
                            if (idx > -1) g.items[idx] = newVal;
                        });
                    }
                    
                    if (ctxData.combos) {
                        ctxData.combos.forEach(c => {
                            c.elements.forEach(e => {
                                if (e.tag === item) e.tag = newVal;
                            });
                        });
                    }
                    
                    const oldImgKey = `${ctx}_${item}`;
                    const newImgKey = `${ctx}_${newVal}`;
                    if (localDB.images[oldImgKey]) {
                        localDB.images[newImgKey] = localDB.images[oldImgKey];
                        delete localDB.images[oldImgKey];
                    }
                }
                
                // === 新增：保存标签 ===
                if (!ctxData.metadata[newVal]) ctxData.metadata[newVal] = { tags: [] };
                ctxData.metadata[newVal].tags = newTags;
                
                await PromptAPI.saveDB(localDB);
                pmHideModal("pm-edit-card-modal");
                renderGrid();
            } catch (e) {
                console.error(e);
                alert("修改失败！");
            } finally {
                hideProgress();
            }
        };
    }

    if (!container) {
        container = document.createElement("div");
        container.id = "pm-native-modal";
        
        let initCompRate = localDB.settings?.compress_rate ?? 0.85;
        let initCompPct = Math.round(initCompRate * 100);
        let initMaxWidth = localDB.settings?.max_width ?? 900;

        container.innerHTML = `
            <div class="pm-header" id="pm-header">
                <span style="font-weight: bold; font-size: 15px; letter-spacing: 1px; color:#fff;">Prompt 浏览器</span>
                <button class="pm-close-btn" id="pm-close-btn">关闭界面 (ESC)</button>
            </div>
            <div class="pm-tabs" id="pm-tabs"></div>
            <div class="pm-body">
                <div class="pm-sidebar" id="pm-sidebar">
                    <div class="pm-sidebar-scroll" id="pm-sidebar-scroll"></div>
                    <div class="pm-sidebar-footer">
                        <div class="pm-sidebar-group">
                            <div class="pm-sidebar-label">工作区与操作</div>
                            <div class="pm-btn-row">
                                <button class="pm-action-btn" style="flex:1; color:#f8961e; border-color:#835213;" id="pm-btn-groups">收藏管理</button>
                                <button class="pm-action-btn" style="flex:1; color:#a78bfa; border-color:#534383;" id="pm-btn-combos">组合管理</button>
                            </div>
                            <div class="pm-btn-row">
                                <button class="pm-action-btn primary" style="flex:1;" id="pm-btn-add-card">新建卡片</button>
                                <button class="pm-action-btn" style="flex:1;" id="pm-btn-batch">批量操作</button>
                            </div>
                        </div>
                        <div class="pm-sidebar-group">
                            <div class="pm-sidebar-label">数据与备份</div>
                            <div class="pm-btn-row">
                                <button class="pm-action-btn" style="flex:1;" id="pm-btn-import">导入配置</button>
                                <button class="pm-action-btn" style="flex:1;" id="pm-btn-export">导出配置</button>
                            </div>
                            
                            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px dashed rgba(255,107,157,0.3);">
                                <div class="pm-sidebar-label" style="display:flex; justify-content:space-between; margin-bottom:5px;">
                                    图片压缩率 <span id="pm-comp-val" style="color:#ff6b9d;">${initCompPct}%</span>
                                </div>
                                <input type="range" id="pm-comp-slider" min="10" max="100" value="${initCompPct}" style="width:100%; cursor:pointer; accent-color:#ff6b9d;">
                                
                                <div class="pm-sidebar-label" style="display:flex; justify-content:space-between; margin-top:10px; margin-bottom:5px; align-items:center;">
                                    最大宽度 
                                    <div style="display:flex; align-items:center; gap:4px;">
                                        <input type="number" id="pm-width-input" value="${initMaxWidth}" min="100" max="4096" style="width:55px; background:#111; border:1px solid #444; color:#ff6b9d; border-radius:4px; text-align:center; outline:none; font-weight:bold; font-size:11px;"> px
                                    </div>
                                </div>
                                <input type="range" id="pm-width-slider" min="100" max="4096" step="10" value="${initMaxWidth}" style="width:100%; cursor:pointer; accent-color:#ff6b9d;">
                            </div>

                            <input type="file" id="pm-hidden-import" accept=".json" style="display:none;">
                            <input type="file" id="pm-hidden-append-img" multiple accept="image/*" style="display:none;">
                        </div>
                    </div>
                </div>
                <div class="pm-main-container">
                    <div class="pm-toolbar">
                        <input type="text" class="pm-search-input" id="pm-search-input" placeholder="输入提示词搜索... (Ctrl+F)">
                        <select class="pm-scope-select" id="pm-search-scope">
                            <option value="mode">搜索: 当前模式</option>
                            <option value="category">搜索: 当前分类</option>
                            <option value="model">搜索: 当前模型全库</option>
                        </select>
                        <div class="pm-toolbar-right">
                            <span style="font-size:12px; color:#aaa; font-weight:bold;">尺寸调节</span>
                            <input type="range" class="pm-zoom-slider" id="pm-zoom-slider" min="140" max="300" value="180">
                        </div>
                    </div>
                    <div class="pm-main" id="pm-main">
                        <div id="pm-marquee"></div>
                    </div>
                    <div class="pm-batch-bar" id="pm-batch-bar">
                        <span style="font-size:14px; color:#ff6b9d; font-weight:bold;" id="pm-batch-count">已选择: 0</span>
                        <div style="display:flex; gap:10px;">
                            <button class="pm-action-btn" style="color:#fff; border-color:#ff6b9d;" id="pm-btn-sel-all">全选/取消全选</button>
                            <button class="pm-action-btn" style="color:#f44336; border-color:#552222;" id="pm-btn-del-batch">彻底删除选中项</button>
                            <button class="pm-action-btn" id="pm-btn-cancel-batch">退出批量 (ESC)</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        const compSlider = document.getElementById("pm-comp-slider");
        const compVal = document.getElementById("pm-comp-val");
        compSlider.oninput = (e) => { compVal.innerText = e.target.value + "%"; };
        compSlider.onchange = async (e) => {
            if (!localDB.settings) localDB.settings = {};
            localDB.settings.compress_rate = parseInt(e.target.value) / 100;
            await PromptAPI.saveDB(localDB);
            syncImportNodeWidgets();
        };

        const widthSlider = document.getElementById("pm-width-slider");
        const widthInput = document.getElementById("pm-width-input");
        
        const updateWidthSetting = async (val) => {
            let num = parseInt(val);
            if (isNaN(num) || num < 100) num = 100;
            if (num > 4096) num = 4096;
            
            widthSlider.value = num;
            widthInput.value = num;
            
            if (!localDB.settings) localDB.settings = {};
            localDB.settings.max_width = num;
            await PromptAPI.saveDB(localDB);
            syncImportNodeWidgets();
        };

        if (widthSlider && widthInput) {
            // 滑动时实时更新输入框的数字
            widthSlider.oninput = (e) => { widthInput.value = e.target.value; };
            // 滑动松手后保存
            widthSlider.onchange = (e) => { updateWidthSetting(e.target.value); };
            // 输入框手动输入并回车/失去焦点后保存并同步滑块
            widthInput.onchange = (e) => { updateWidthSetting(e.target.value); };
        }

        document.getElementById("pm-close-btn").onclick = closeNativeBrowser;
        let isDraggingWin = false, offsetX = 0, offsetY = 0;
        const header = document.getElementById("pm-header");
        header.addEventListener("mousedown", (e) => {
            if (e.target.tagName.toLowerCase() === 'button') return;
            isDraggingWin = true; offsetX = e.clientX - container.offsetLeft; offsetY = e.clientY - container.offsetTop;
        });
        window.addEventListener("mousemove", (e) => {
            if (!isDraggingWin) return;
            container.style.left = (e.clientX - offsetX) + "px"; container.style.top = (e.clientY - offsetY) + "px";
        });
        window.addEventListener("mouseup", () => isDraggingWin = false);

        let searchTimeout;
        document.getElementById("pm-search-input").oninput = (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => { searchQuery = e.target.value.toLowerCase().trim(); renderGrid(); }, 300);
        };
        document.getElementById("pm-search-scope").onchange = (e) => { searchScope = e.target.value; renderGrid(); };
        document.getElementById("pm-zoom-slider").oninput = () => { renderGrid(); };

        document.getElementById("pm-btn-batch").onclick = () => { isBatchMode = true; batchSelection.clear(); document.getElementById("pm-batch-bar").classList.add("active"); renderGrid(); };
        document.getElementById("pm-btn-cancel-batch").onclick = exitBatchMode;
        document.getElementById("pm-btn-sel-all").onclick = toggleSelectAll;
        document.getElementById("pm-btn-del-batch").onclick = async () => {
            if (batchSelection.size === 0) return;
            if (!confirm(`彻底删除 ${batchSelection.size} 个项目及其硬盘图片？\n\n注意：物理文件将被彻底擦除，不可恢复！`)) return;
            await executeBatchDelete();
        };

        document.getElementById("pm-btn-groups").onclick = () => openGroupsModal();
        document.getElementById("pm-btn-combos").onclick = () => openCombosModal();

        document.getElementById("pm-btn-export").onclick = () => {
            const includeImg = confirm("是否包含图片数据？\n[确定] 全量导出 (含所有图片)\n[取消] 仅导出文本结构 (轻巧)");
            const exportData = JSON.parse(JSON.stringify(localDB));
            if (!includeImg) exportData.images = {};
            const blob = new Blob([JSON.stringify(exportData)], {type: "application/json"});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `Prompt_Backup_${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
        };
        document.getElementById("pm-btn-import").onclick = () => document.getElementById("pm-hidden-import").click();
        document.getElementById("pm-hidden-import").onchange = (e) => { if (e.target.files.length > 0) handleImportFile(e.target.files[0]); e.target.value = ''; };
        
        document.getElementById("pm-btn-add-card").onclick = () => {
            if (!currentModelId || !currentModeId) { alert("请先在左侧点选一个分类模式！"); return; }
            pmShowModal("pm-create-modal");
        };
        document.getElementById("pm-hidden-create-img").onchange = async (e) => {
            if (e.target.files.length > 0) await handleBatchCreateImages(e.target.files);
            e.target.value = '';
        };
        document.getElementById("pm-hidden-create-txt").onchange = async (e) => {
            if (e.target.files.length > 0) await handleCreateTXT(e.target.files[0]);
            e.target.value = '';
        };
        document.getElementById("pm-hidden-append-img").onchange = async (e) => {
            if (e.target.files.length === 0 || !currentAppendTarget) return;
            await executeAppendImages(e.target.files, currentAppendTarget.item, currentAppendTarget.ctx);
            e.target.value = ''; 
        };

        setupMarquee(); setupShortcuts();

    } else {
        container.style.display = "flex"; exitBatchMode();
    }
    renderModelTabs();
}

window.switchCreateTab = function(tab) {
    document.querySelectorAll('.pm-ct-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('[id^="ct-content-"]').forEach(c => c.style.display = 'none');
    document.getElementById(`ct-btn-${tab}`).classList.add('active');
    document.getElementById(`ct-content-${tab}`).style.display = 'block';
};

function closeNativeBrowser() { 
    document.getElementById("pm-native-modal").style.display = "none"; 
    syncImportNodeWidgets();
}

function exitBatchMode() {
    isBatchMode = false; batchSelection.clear();
    const bb = document.getElementById("pm-batch-bar"); if (bb) bb.classList.remove("active");
    renderGrid();
}

function setupShortcuts() {
    document.addEventListener("keydown", (e) => {
        const modal = document.getElementById("pm-native-modal");
        if (!modal || modal.style.display === "none") return;
        if (e.target.tagName === 'INPUT' && e.key !== 'Escape') return;

        if (e.key === "Escape") {
            if (window.pmActiveModals && window.pmActiveModals.length > 0) {
                const topModal = window.pmActiveModals.pop();
                document.getElementById(topModal).style.display = 'none';
                e.stopPropagation();
            } else if (isBatchMode) { 
                exitBatchMode(); 
                e.stopPropagation(); 
            } else { 
                closeNativeBrowser(); 
                e.stopPropagation(); 
            }
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
            e.preventDefault(); e.stopPropagation();
            const searchInput = document.getElementById("pm-search-input");
            if (searchInput) searchInput.focus();
        }
    }, true);
}

function renderModelTabs() {
    const tabsContainer = document.getElementById("pm-tabs");
    tabsContainer.innerHTML = '';
    const models = localDB.models.main_models;
    
    if (Object.keys(models).length === 0) {
        tabsContainer.innerHTML = '<span style="color:#666; padding:12px; font-size:12px;">没有任何模型</span>';
    } else {
        if (!currentModelId || !models[currentModelId]) currentModelId = Object.keys(models)[0];
        for (const [mId, mData] of Object.entries(models)) {
            const wrap = document.createElement("div"); wrap.className = `pm-tab-wrap ${mId === currentModelId ? 'active' : ''}`;
            
            // === 新增：支持拖拽标签页换顺序 ===
            wrap.draggable = true;
            wrap.ondragstart = (e) => { e.dataTransfer.setData("text/plain", "model_"+mId); e.stopPropagation(); };
            wrap.ondragover = (e) => { e.preventDefault(); wrap.classList.add('pm-drag-over-tab'); };
            wrap.ondragleave = (e) => { wrap.classList.remove('pm-drag-over-tab'); };
            wrap.ondrop = async (e) => {
                e.preventDefault(); e.stopPropagation(); wrap.classList.remove('pm-drag-over-tab');
                const type_id = e.dataTransfer.getData("text/plain");
                if (type_id.startsWith("model_")) {
                    const srcId = type_id.replace("model_", "");
                    localDB.models.main_models = reorderObjectKeys(localDB.models.main_models, srcId, mId);
                    await PromptAPI.saveDB(localDB);
                    renderModelTabs();
                    syncImportNodeWidgets();
                }
            };

            const btn = document.createElement("button"); btn.className = "pm-tab-btn"; btn.innerText = mData.name || mId;
            btn.onclick = () => { currentModelId = mId; currentModeId = null; renderModelTabs(); };
            
            const ctrlGroup = document.createElement("div"); ctrlGroup.className = "pm-ctrl-group";
            const editBtn = document.createElement("button"); editBtn.className = "pm-ctrl-btn"; editBtn.innerText = "设置"; editBtn.onclick = (e) => { e.stopPropagation(); editModel(mId); };
            const delBtn = document.createElement("button"); delBtn.className = "pm-ctrl-btn del"; delBtn.innerText = "删除"; delBtn.onclick = (e) => { e.stopPropagation(); deleteModel(mId); };
            ctrlGroup.appendChild(editBtn); ctrlGroup.appendChild(delBtn);

            wrap.appendChild(btn); wrap.appendChild(ctrlGroup); tabsContainer.appendChild(wrap);
        }
    }
    const addBtn = document.createElement("button"); addBtn.className = "pm-ctrl-btn"; addBtn.style.display = "block"; addBtn.style.marginLeft = "10px"; addBtn.style.opacity = "1"; addBtn.innerText = "新建模型";
    addBtn.onclick = () => addModel(); tabsContainer.appendChild(addBtn);
    renderSidebar();
}

function renderSidebar() {
    const scrollArea = document.getElementById("pm-sidebar-scroll"); scrollArea.innerHTML = '';
    const main = document.getElementById("pm-main"); main.innerHTML = '<div style="color:#555; padding:20px; font-size:12px;">请选择一个模式...</div>';

    const models = localDB.models.main_models;
    if (!currentModelId || !models[currentModelId]) return;
    const currentModel = models[currentModelId];
    if (!currentModel.categories) currentModel.categories = [{ id: 'custom', name: '默认分类' }];
    if (!currentModel.modes) currentModel.modes = {};

    let firstModeId = null;

    currentModel.categories.forEach(cat => {
        const catWrap = document.createElement("div"); catWrap.className = "pm-cat-wrap";
        
        // === 新增：支持拖拽大分类换顺序 ===
        catWrap.draggable = true;
        catWrap.ondragstart = (e) => { e.dataTransfer.setData("text/plain", "cat_"+cat.id); e.stopPropagation(); };
        catWrap.ondragover = (e) => { e.preventDefault(); catWrap.classList.add('pm-drag-over-cat'); e.stopPropagation(); };
        catWrap.ondragleave = (e) => { catWrap.classList.remove('pm-drag-over-cat'); e.stopPropagation(); };
        catWrap.ondrop = async (e) => {
            e.preventDefault(); e.stopPropagation(); catWrap.classList.remove('pm-drag-over-cat');
            const type_id = e.dataTransfer.getData("text/plain");
            if (type_id.startsWith("cat_")) {
                const srcId = type_id.replace("cat_", "");
                if (srcId !== cat.id) {
                    const cats = currentModel.categories;
                    const srcIdx = cats.findIndex(c => c.id === srcId);
                    const tgtIdx = cats.findIndex(c => c.id === cat.id);
                    if(srcIdx > -1 && tgtIdx > -1) {
                        const [moved] = cats.splice(srcIdx, 1);
                        cats.splice(tgtIdx, 0, moved);
                        await PromptAPI.saveDB(localDB);
                        renderSidebar();
                        syncImportNodeWidgets();
                    }
                }
            } else if (type_id.startsWith("mode_")) {
                // 如果把模式拖拽到了大分类的头上，直接将其归入该分类的最末尾
                const srcModeId = type_id.replace("mode_", "");
                currentModel.modes[srcModeId].group = cat.id;
                await PromptAPI.saveDB(localDB);
                renderSidebar();
                syncImportNodeWidgets();
            }
        };

        const catHeader = document.createElement("div"); catHeader.className = "pm-cat-header";
        
        // === 新增：大分类折叠与展开功能 ===
        const isCollapsed = collapsedCategories.has(cat.id);
        const arrowSpan = document.createElement("span");
        arrowSpan.innerHTML = "▼";
        arrowSpan.style.cssText = `cursor: pointer; display: inline-block; transition: 0.2s; transform: ${isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'}; color: #ff6b9d; margin-right: 6px; font-size: 10px;`;
        arrowSpan.onclick = (e) => {
            e.stopPropagation();
            if (isCollapsed) collapsedCategories.delete(cat.id);
            else collapsedCategories.add(cat.id);
            renderSidebar();
        };

        const titleSpan = document.createElement("span"); titleSpan.className = "pm-cat-title"; titleSpan.innerText = cat.name;
        
        const titleGroup = document.createElement("div");
        titleGroup.style.display = "flex"; titleGroup.style.alignItems = "center";
        titleGroup.appendChild(arrowSpan);
        titleGroup.appendChild(titleSpan);
        
        const ctrlDiv = document.createElement("div"); ctrlDiv.className = "pm-ctrl-group";
        const editCat = document.createElement("button"); editCat.className = "pm-ctrl-btn"; editCat.innerText = "设置"; editCat.onclick = () => editCategory(cat.id);
        const delCat = document.createElement("button"); delCat.className = "pm-ctrl-btn del"; delCat.innerText = "删除"; delCat.onclick = () => deleteCategory(cat.id);
        ctrlDiv.appendChild(editCat); ctrlDiv.appendChild(delCat);
        catHeader.appendChild(titleGroup); catHeader.appendChild(ctrlDiv); catWrap.appendChild(catHeader);

        // 为折叠留出的容器包裹
        const modeContainer = document.createElement("div");
        if (isCollapsed) modeContainer.style.display = "none";

        const modesInCat = Object.entries(currentModel.modes).filter(([id, m]) => m.group === cat.id || (!m.group && cat.id === 'custom'));
        modesInCat.forEach(([modId, modData]) => {
            if (!firstModeId) firstModeId = modId;
            const mWrap = document.createElement("div"); mWrap.className = `pm-mode-wrap ${modId === currentModeId ? 'active' : ''}`;
            
            // === 新增：支持拖拽小模式换顺序与换分类 ===
            mWrap.draggable = true;
            mWrap.ondragstart = (e) => { e.dataTransfer.setData("text/plain", "mode_"+modId); e.stopPropagation(); };
            mWrap.ondragover = (e) => { e.preventDefault(); mWrap.classList.add('pm-drag-over-mode'); e.stopPropagation(); };
            mWrap.ondragleave = (e) => { mWrap.classList.remove('pm-drag-over-mode'); e.stopPropagation(); };
            mWrap.ondrop = async (e) => {
                e.preventDefault(); e.stopPropagation(); mWrap.classList.remove('pm-drag-over-mode');
                const type_id = e.dataTransfer.getData("text/plain");
                if (type_id.startsWith("mode_")) {
                    const srcModeId = type_id.replace("mode_", "");
                    if (srcModeId !== modId) {
                        currentModel.modes[srcModeId].group = cat.id; // 继承放置处模式的归属分类
                        currentModel.modes = reorderObjectKeys(currentModel.modes, srcModeId, modId);
                        await PromptAPI.saveDB(localDB);
                        renderSidebar();
                        syncImportNodeWidgets();
                    }
                }
            };

            const btn = document.createElement("button"); btn.className = "pm-mode-btn"; btn.innerText = modData.name || modId;
            btn.onclick = () => { currentModeId = modId; exitBatchMode(); renderSidebar(); };

            const mCtrl = document.createElement("div"); mCtrl.className = "pm-ctrl-group";
            const mEdit = document.createElement("button"); mEdit.className = "pm-ctrl-btn"; mEdit.innerText = "设置"; mEdit.onclick = () => editMode(modId);
            const mDel = document.createElement("button"); mDel.className = "pm-ctrl-btn del"; mDel.innerText = "删除"; mDel.onclick = () => deleteMode(modId);
            mCtrl.appendChild(mEdit); mCtrl.appendChild(mDel);

            mWrap.appendChild(btn); mWrap.appendChild(mCtrl); 
            modeContainer.appendChild(mWrap);
        });

        const addModeBtn = document.createElement("div"); addModeBtn.className = "pm-add-btn"; addModeBtn.innerText = "新建模式"; addModeBtn.onclick = () => addMode(cat.id);
        modeContainer.appendChild(addModeBtn); 
        
        catWrap.appendChild(modeContainer);
        
        const divider = document.createElement("div"); divider.className = "pm-divider";
        catWrap.appendChild(divider);
        
        scrollArea.appendChild(catWrap);
    });

    const addCatBtn = document.createElement("div"); addCatBtn.className = "pm-add-btn"; addCatBtn.style.borderStyle = "solid"; addCatBtn.innerText = "新建分类";
    addCatBtn.onclick = () => addCategory(); scrollArea.appendChild(addCatBtn);

    if (!currentModeId && firstModeId) currentModeId = firstModeId;
    if (currentModeId) renderGrid();
}

function getScopedContexts() {
    let targetCtxs = [];
    if (!currentModelId || !currentModeId) return targetCtxs;
    const model = localDB.models.main_models[currentModelId];
    if (searchScope === "mode") { targetCtxs.push(`${currentModelId}_${currentModeId}`); } 
    else if (searchScope === "category") {
        const currentCatId = model.modes[currentModeId]?.group || 'custom';
        Object.entries(model.modes).forEach(([mId, m]) => { if (m.group === currentCatId || (!m.group && currentCatId === 'custom')) targetCtxs.push(`${currentModelId}_${mId}`); });
    } else if (searchScope === "model") {
        Object.keys(model.modes).forEach(mId => targetCtxs.push(`${currentModelId}_${mId}`));
    }
    return targetCtxs;
}

function renderGrid() {
    const main = document.getElementById("pm-main");
    main.innerHTML = '<div id="pm-marquee"></div>';

    const zoomSize = document.getElementById("pm-zoom-slider") ? document.getElementById("pm-zoom-slider").value : 180;
    main.style.gridTemplateColumns = `repeat(auto-fill, minmax(${zoomSize}px, 1fr))`;

    const targetCtxs = getScopedContexts();
    let allItems = [];

    targetCtxs.forEach(ctx => {
        const ctxData = localDB.contexts?.[ctx];
        if (ctxData && ctxData.items) {
            ctxData.items.forEach(item => {
                if (searchQuery) {
                    const lowItem = item.toLowerCase();
                    const tagsStr = (ctxData.metadata?.[item]?.tags || []).join(" ").toLowerCase();
                    if (!lowItem.includes(searchQuery) && !tagsStr.includes(searchQuery)) return; 
                }
                allItems.push({ item, ctx });
            });
        }
    });

    if (allItems.length === 0) {
        main.innerHTML += '<div style="color:#555; grid-column: 1 / -1; margin-top:10px; font-size:14px;">空空如也。</div>';
        return;
    }

    let activePrompts = [];
    if (currentActiveWidget && currentActiveWidget.value) {
        const parsed = parsePromptText(currentActiveWidget.value);
        activePrompts = parsed.map(p => p.tag);
    }

    allItems.forEach(({ item, ctx }) => {
        const imgKey = `${ctx}_${item}`;
        const imgList = localDB.images?.[imgKey] || [];
        const hasImg = imgList.length > 0;
        
        const batchKey = `${ctx}||${item}`;
        const isSelectedInBatch = batchSelection.has(batchKey);
        const isInWidget = activePrompts.includes(item);

        const card = document.createElement("div");
        card.className = "pm-card pm-selectable-card";
        card.dataset.ctx = ctx; card.dataset.item = item;
        
        if (isBatchMode && isSelectedInBatch) card.classList.add("batch-selected");
        else if (!isBatchMode && isInWidget) card.classList.add("in-prompt");

        const imgWrap = document.createElement("div"); imgWrap.className = "pm-card-img-wrap";
        let currentImgIndex = 0;

        if (hasImg) {
            const imgEl = document.createElement("img"); 
            imgEl.src = imgList[currentImgIndex];
            imgEl.style.cursor = "pointer";
            imgEl.onclick = (e) => { 
                if (isBatchMode) return; 
                e.stopPropagation(); 
                document.getElementById('pm-viewer-img').src = imgList[currentImgIndex]; 
                pmShowModal("pm-image-viewer");
            };
            imgWrap.appendChild(imgEl);
            
            const delImgBtn = document.createElement("button");
            delImgBtn.className = "pm-del-img-btn";
            delImgBtn.innerHTML = "×";
            delImgBtn.title = "删除此图";
            delImgBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm("仅彻底删除当前显示的这张图片？")) {
                    await PromptAPI.deleteFile(imgList[currentImgIndex]); 
                    imgList.splice(currentImgIndex, 1);
                    localDB.images[imgKey] = imgList;
                    await PromptAPI.saveDB(localDB); renderGrid();
                }
            };
            imgWrap.appendChild(delImgBtn);

            if (imgList.length > 1) {
                const leftArrow = document.createElement("button"); leftArrow.className = "pm-nav-arrow left"; leftArrow.innerText = "◀";
                const rightArrow = document.createElement("button"); rightArrow.className = "pm-nav-arrow right"; rightArrow.innerText = "▶";
                const updateImg = () => { imgEl.src = imgList[currentImgIndex]; };
                leftArrow.onclick = (e) => { e.stopPropagation(); currentImgIndex = (currentImgIndex - 1 + imgList.length) % imgList.length; updateImg(); };
                rightArrow.onclick = (e) => { e.stopPropagation(); currentImgIndex = (currentImgIndex + 1) % imgList.length; updateImg(); };
                imgWrap.appendChild(leftArrow); imgWrap.appendChild(rightArrow);
            }
        } else {
            imgWrap.innerHTML = `<div class="pm-no-img">无图 (点传图上传)</div>`;
        }

        const titleDiv = document.createElement("div"); titleDiv.className = "pm-card-title"; titleDiv.innerText = item;
        
        card.appendChild(imgWrap); 
        card.appendChild(titleDiv);

        if (searchScope !== "mode") {
            const modId = ctx.split('_')[1];
            const mName = localDB.models.main_models[currentModelId]?.modes[modId]?.name || modId;
            const sourceDiv = document.createElement("div"); sourceDiv.className = "pm-card-source"; sourceDiv.innerText = `[${mName}]`;
            card.appendChild(sourceDiv);
        }

        const tagsWrap = document.createElement("div"); tagsWrap.className = "pm-card-tags";
        const tags = localDB.contexts[ctx]?.metadata?.[item]?.tags || [];
        if (tags.length === 0) {
            tagsWrap.innerHTML = '<span style="color:#555; font-style:italic;">暂无标签</span>';
        } else {
            tags.forEach(t => { 
                const s = document.createElement("span"); s.className = "pm-tag"; s.innerText = t; tagsWrap.appendChild(s); 
            });
        }
        card.appendChild(tagsWrap);

        const actionsWrap = document.createElement("div"); actionsWrap.className = "pm-card-actions";

        const inGrp = localDB.contexts[ctx]?.groups?.some(g => g.items.includes(item));
        const favBtn = document.createElement("button"); favBtn.className = `pm-text-btn ${inGrp ? 'warning' : ''}`; favBtn.innerText = inGrp ? "已收藏" : "收藏";
        favBtn.onclick = (e) => { e.stopPropagation(); openGroupSelectModal(item, ctx); };
        actionsWrap.appendChild(favBtn);

        const appendBtn = document.createElement("button"); appendBtn.className = "pm-text-btn"; appendBtn.innerText = "上传";
        appendBtn.onclick = (e) => { e.stopPropagation(); currentAppendTarget = { item, ctx }; document.getElementById("pm-hidden-append-img").click(); };
        actionsWrap.appendChild(appendBtn);

        const editBtn = document.createElement("button"); editBtn.className = "pm-text-btn"; editBtn.innerText = "编辑";
        editBtn.onclick = (e) => { e.stopPropagation(); openEditCardModal(item, ctx); };
        actionsWrap.appendChild(editBtn);

        const delCardBtn = document.createElement("button"); delCardBtn.className = "pm-text-btn danger"; delCardBtn.innerText = "删除";
        delCardBtn.onclick = async (e) => {
            e.stopPropagation(); if (confirm(`彻底删除卡片 [ ${item} ] 及其所有图片？\n此操作不可逆！`)) await deleteCardDirect(item, ctx);
        };
        actionsWrap.appendChild(delCardBtn);

        card.appendChild(actionsWrap);

        card.onclick = (e) => {
            if (isBatchMode) {
                if (window._isDraggingMarquee) return; 
                if (batchSelection.has(batchKey)) batchSelection.delete(batchKey); else batchSelection.add(batchKey);
                document.getElementById("pm-batch-count").innerText = `已选择: ${batchSelection.size}`; renderGrid();
            } else { togglePromptInWidget(item); renderGrid(); }
        };

        main.appendChild(card);
    });
}

function updateProgress(title, text, percent = null) {
    const overlay = document.getElementById("pm-progress-overlay");
    if (overlay) {
        pmShowModal("pm-progress-overlay");
        document.getElementById("pm-progress-title").innerText = title || "处理中...";
        document.getElementById("pm-progress-text").innerText = text || "请稍候";
        if (percent !== null) {
            document.getElementById("pm-progress-fill").style.width = percent + "%";
        } else {
            document.getElementById("pm-progress-fill").style.width = "100%";
        }
    }
}

function hideProgress() {
    pmHideModal("pm-progress-overlay");
}

async function deleteCardDirect(item, ctx) {
    updateProgress("正在删除...", "清理数据与物理文件");
    try {
        if (localDB.contexts[ctx]) {
            localDB.contexts[ctx].items = localDB.contexts[ctx].items.filter(i => i !== item);
            if (localDB.contexts[ctx].metadata) delete localDB.contexts[ctx].metadata[item];
            if (localDB.contexts[ctx].groups) {
                localDB.contexts[ctx].groups.forEach(g => {
                    g.items = g.items.filter(x => x !== item);
                });
            }
        }
        const imgKey = `${ctx}_${item}`;
        if (localDB.images[imgKey]) { 
            for (const url of localDB.images[imgKey]) await PromptAPI.deleteFile(url); 
            delete localDB.images[imgKey]; 
        }
        await PromptAPI.saveDB(localDB);
    } catch (e) {
        console.error("Delete Card Error", e);
        alert("删除过程中出现异常！");
    } finally {
        hideProgress();
        renderGrid();
    }
}

function togglePromptInWidget(promptTxt) {
    if (!currentActiveWidget) return;
    let parsed = parsePromptText(currentActiveWidget.value);
    
    const index = parsed.findIndex(p => p.tag === promptTxt);
    if (index !== -1) {
        parsed.splice(index, 1);
    } else {
        parsed.push({ original: promptTxt, tag: promptTxt, weight: 1.0, enabled: true });
    }
    
    currentActiveWidget.value = buildPromptText(parsed);
    app.graph.setDirtyCanvas(true);
}

function getActiveContext() { return `${currentModelId}_${currentModeId}`; }

window.createSinglePrompt = async function() {
    const val = document.getElementById("pm-create-single-input").value.trim();
    if (!val) { alert("请输入提示词内容！"); return; }
    const ctx = getActiveContext();
    if (!localDB.contexts[ctx]) localDB.contexts[ctx] = { items: [], metadata: {} };
    if (localDB.contexts[ctx].items.includes(val)) { alert("该卡片已存在！"); return; }
    localDB.contexts[ctx].items.push(val); localDB.contexts[ctx].metadata[val] = { tags: [] };
    await PromptAPI.saveDB(localDB);
    document.getElementById("pm-create-single-input").value = "";
    pmHideModal("pm-create-modal"); renderGrid();
};

async function handleBatchCreateImages(files) {
    const ctx = getActiveContext();
    if (!localDB.contexts[ctx]) localDB.contexts[ctx] = { items: [], metadata: {} };
    let addedCount = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.match('image.*')) continue;
        
        let promptName = file.name.replace(/\.[^/.]+$/, "").trim();
        try { promptName = decodeURIComponent(promptName); } catch(e) {}
        if (!promptName) continue;

        let pct = Math.round(((i + 1) / files.length) * 100);
        updateProgress("正在批量上传...", `处理中: ${i+1} / ${files.length} (${pct}%)`, pct);
        
        if (!localDB.contexts[ctx].items.includes(promptName)) {
            localDB.contexts[ctx].items.push(promptName);
            localDB.contexts[ctx].metadata[promptName] = { tags: [] };
            addedCount++;
        }
        const imgKey = `${ctx}_${promptName}`;
        if (!localDB.images[imgKey]) localDB.images[imgKey] = [];
        
        try {
            const compRate = localDB.settings?.compress_rate ?? 0.85;
            const maxWidth = localDB.settings?.max_width ?? 900;
            const base64 = await compressImage(file, maxWidth, compRate);
            const hash = cyrb53(base64); 
            const safeName = promptName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').substring(0, 15) || 'img';
            const filename = `img_${safeName}_${hash}.jpg`;
            const url = await PromptAPI.uploadImage(base64, filename, ctx);
            
            if (url && !localDB.images[imgKey].includes(url)) {
                localDB.images[imgKey].push(url);
            }
        } catch(e) { console.error("Upload error", e); }
    }
    await PromptAPI.saveDB(localDB);
    pmHideModal("pm-create-modal");
    hideProgress(); renderGrid();
}

async function handleCreateTXT(file) {
    const ctx = getActiveContext();
    if (!localDB.contexts[ctx]) localDB.contexts[ctx] = { items: [], metadata: {} };
    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        const rawPrompts = text.split(/[,\r\n]+/);
        let addedCount = 0;
        rawPrompts.forEach(p => {
            let val = p.trim();
            try { val = decodeURIComponent(val); } catch(e) {}
            if (val && !localDB.contexts[ctx].items.includes(val)) {
                localDB.contexts[ctx].items.push(val); localDB.contexts[ctx].metadata[val] = { tags: [] }; addedCount++;
            }
        });
        if (addedCount > 0) { await PromptAPI.saveDB(localDB); alert(`成功导入 ${addedCount} 个新提示词卡片！`); } 
        else { alert("文件中未发现新的有效内容。"); }
        pmHideModal("pm-create-modal"); renderGrid();
    };
    reader.readAsText(file);
}

async function executeAppendImages(files, item, ctx) {
    const imgKey = `${ctx}_${item}`;
    if (!localDB.images[imgKey]) localDB.images[imgKey] = [];
    
    let successCount = 0;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let pct = Math.round(((i + 1) / files.length) * 100);
        updateProgress("正在追加图片...", `处理中: ${i+1} / ${files.length} (${pct}%)`, pct);
        try {
            const compRate = localDB.settings?.compress_rate ?? 0.85;
            const maxWidth = localDB.settings?.max_width ?? 900;
            const base64 = await compressImage(file, maxWidth, compRate);
            const hash = cyrb53(base64);
            const safeName = item.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').substring(0, 15) || 'img';
            const filename = `img_${safeName}_${hash}.jpg`;
            const url = await PromptAPI.uploadImage(base64, filename, ctx);
            
            if (url && !localDB.images[imgKey].includes(url)) { 
                localDB.images[imgKey].push(url); 
                successCount++; 
            }
        } catch(err) { console.error(err); }
    }
    if (successCount > 0) await PromptAPI.saveDB(localDB);
    hideProgress(); renderGrid();
}

function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image(); img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement("canvas"); let w = img.width, h = img.height;
                if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL("image/jpeg", quality));
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
}

function toggleSelectAll() {
    const main = document.getElementById("pm-main");
    const cards = main.querySelectorAll(".pm-selectable-card");
    if (cards.length === 0) return;

    let visibleSelected = 0;
    cards.forEach(card => {
        if (batchSelection.has(`${card.dataset.ctx}||${card.dataset.item}`)) visibleSelected++;
    });

    if (visibleSelected === cards.length) {
        cards.forEach(card => batchSelection.delete(`${card.dataset.ctx}||${card.dataset.item}`));
    } else {
        cards.forEach(card => batchSelection.add(`${card.dataset.ctx}||${card.dataset.item}`));
    }
    document.getElementById("pm-batch-count").innerText = `已选择: ${batchSelection.size}`;
    renderGrid();
}

async function executeBatchDelete() {
    updateProgress("正在删除...", "清理数据与物理文件");
    try {
        for (const batchKey of batchSelection) {
            const [ctx, item] = batchKey.split('||');
            if (!localDB.contexts[ctx]) continue;
            localDB.contexts[ctx].items = localDB.contexts[ctx].items.filter(i => i !== item);
            if (localDB.contexts[ctx].metadata) delete localDB.contexts[ctx].metadata[item];
            if (localDB.contexts[ctx].groups) {
                localDB.contexts[ctx].groups.forEach(g => {
                    g.items = g.items.filter(x => x !== item);
                });
            }
            const imgKey = `${ctx}_${item}`;
            if (localDB.images[imgKey]) { 
                for (const url of localDB.images[imgKey]) await PromptAPI.deleteFile(url); 
                delete localDB.images[imgKey]; 
            }
        }
        await PromptAPI.saveDB(localDB);
        batchSelection.clear();
        document.getElementById("pm-batch-count").innerText = `已选择: 0`;
    } catch (e) {
        console.error("Batch Delete Error", e);
        alert("删除过程中出现异常！");
    } finally {
        hideProgress();
        renderGrid();
    }
}

function setupMarquee() {
    const main = document.getElementById("pm-main");
    let isDrawing = false; let startX = 0, startY = 0;
    let selectionSnapshot = new Set(); window._isDraggingMarquee = false;

    main.addEventListener("mousedown", (e) => {
        if (!isBatchMode || e.target.closest('.pm-img-overlay') || e.target.closest('.pm-card-actions')) return;
        isDrawing = true; window._isDraggingMarquee = false;
        const rect = main.getBoundingClientRect();
        startX = e.clientX - rect.left + main.scrollLeft; startY = e.clientY - rect.top + main.scrollTop;
        selectionSnapshot = new Set(batchSelection);
        
        const marquee = document.getElementById("pm-marquee");
        marquee.style.display = "block"; marquee.style.left = startX + "px"; marquee.style.top = startY + "px"; marquee.style.width = "0px"; marquee.style.height = "0px";
    });

    main.addEventListener("mousemove", (e) => {
        if (!isDrawing || !isBatchMode) return;
        window._isDraggingMarquee = true;
        const rect = main.getBoundingClientRect();
        const currentX = e.clientX - rect.left + main.scrollLeft; const currentY = e.clientY - rect.top + main.scrollTop;

        const left = Math.min(startX, currentX); const top = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX); const height = Math.abs(currentY - startY);

        const marquee = document.getElementById("pm-marquee");
        marquee.style.left = left + "px"; marquee.style.top = top + "px"; marquee.style.width = width + "px"; marquee.style.height = height + "px";

        const marqueeRect = { left, top, right: left + width, bottom: top + height };
        const cards = main.querySelectorAll(".pm-selectable-card");
        
        cards.forEach(card => {
            const cardRect = { left: card.offsetLeft, top: card.offsetTop, right: card.offsetLeft + card.offsetWidth, bottom: card.offsetTop + card.offsetHeight };
            const isIntersecting = !(marqueeRect.right < cardRect.left || marqueeRect.left > cardRect.right || marqueeRect.bottom < cardRect.top || marqueeRect.top > cardRect.bottom);
            const batchKey = `${card.dataset.ctx}||${card.dataset.item}`;
            
            const originallySelected = selectionSnapshot.has(batchKey);
            const shouldBeSelected = isIntersecting ? !originallySelected : originallySelected;

            if (shouldBeSelected) { batchSelection.add(batchKey); card.classList.add("batch-selected"); } 
            else { batchSelection.delete(batchKey); card.classList.remove("batch-selected"); }
        });
        document.getElementById("pm-batch-count").innerText = `已选择: ${batchSelection.size}`;
    });

    const stopDrawing = () => {
        if (isDrawing) {
            isDrawing = false; document.getElementById("pm-marquee").style.display = "none";
            setTimeout(() => { window._isDraggingMarquee = false; }, 50); 
        }
    };
    main.addEventListener("mouseup", stopDrawing); main.addEventListener("mouseleave", stopDrawing);
}

async function addModel() {
    const name = prompt("请输入新模型名称:"); if (!name) return;
    const id = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').toLowerCase() + "_" + Date.now();
    localDB.models.main_models[id] = { name: name, categories: [{id:'custom', name:'默认分类'}], modes: {} };
    await PromptAPI.saveDB(localDB); currentModelId = id; currentModeId = null; renderModelTabs(); syncImportNodeWidgets();
}
async function editModel(mId) {
    const newName = prompt("重命名模型:", localDB.models.main_models[mId].name); if (!newName) return;
    localDB.models.main_models[mId].name = newName; await PromptAPI.saveDB(localDB); renderModelTabs(); syncImportNodeWidgets();
}
async function deleteModel(mId) {
    if (!confirm(`将彻底删除该模型及其包含的所有数据与硬盘图片文件！确认吗？`)) return;
    updateProgress("正在清理数据与文件...", "请稍候");
    for (const ctx of Object.keys(localDB.contexts)) { if (ctx.startsWith(mId + "_")) { await cleanupContextImages(ctx); delete localDB.contexts[ctx]; } }
    delete localDB.models.main_models[mId]; if (currentModelId === mId) { currentModelId = null; currentModeId = null; }
    await PromptAPI.saveDB(localDB); hideProgress(); renderModelTabs(); syncImportNodeWidgets();
}
async function addCategory() {
    const name = prompt("请输入新分类名称:"); if (!name) return;
    const id = "cat_" + Date.now(); localDB.models.main_models[currentModelId].categories.push({ id, name });
    await PromptAPI.saveDB(localDB); renderSidebar(); syncImportNodeWidgets();
}
async function editCategory(cId) {
    const cat = localDB.models.main_models[currentModelId].categories.find(c => c.id === cId); if(!cat) return;
    const newName = prompt("重命名分类:", cat.name); if (!newName) return;
    cat.name = newName; await PromptAPI.saveDB(localDB); renderSidebar(); syncImportNodeWidgets();
}
async function deleteCategory(cId) {
    if (!confirm("删除此分类？(其内部模式将移入默认分类)")) return;
    const model = localDB.models.main_models[currentModelId]; model.categories = model.categories.filter(c => c.id !== cId);
    const defaultCatId = model.categories.length > 0 ? model.categories[0].id : 'custom';
    Object.values(model.modes).forEach(m => { if(m.group === cId) m.group = defaultCatId; }); await PromptAPI.saveDB(localDB); renderSidebar(); syncImportNodeWidgets();
}
async function addMode(catId) {
    const name = prompt("请输入新模式名称:"); if (!name) return;
    const id = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').toLowerCase() + "_" + Date.now();
    localDB.models.main_models[currentModelId].modes[id] = { name: name, group: catId };
    await PromptAPI.saveDB(localDB); currentModeId = id; renderSidebar(); syncImportNodeWidgets();
}
async function editMode(modId) {
    const newName = prompt("重命名模式:", localDB.models.main_models[currentModelId].modes[modId].name); if (!newName) return;
    localDB.models.main_models[currentModelId].modes[modId].name = newName; await PromptAPI.saveDB(localDB); renderSidebar(); syncImportNodeWidgets();
}
async function deleteMode(modId) {
    if (!confirm(`将彻底删除该模式下的所有 Prompt 卡片及其硬盘图片文件！确认吗？`)) return;
    updateProgress("正在清理数据与文件...", "请稍候");
    const ctx = `${currentModelId}_${modId}`; await cleanupContextImages(ctx);
    delete localDB.contexts[ctx]; delete localDB.models.main_models[currentModelId].modes[modId];
    if (currentModeId === modId) currentModeId = null; await PromptAPI.saveDB(localDB); hideProgress(); renderSidebar(); syncImportNodeWidgets();
}

async function cleanupContextImages(ctx) {
    if (!localDB.contexts[ctx]) return;
    const foldersToWipe = new Set();
    foldersToWipe.add(ctx);

    for (const item of localDB.contexts[ctx].items) {
        const imgKey = `${ctx}_${item}`;
        if (localDB.images[imgKey]) { 
            for (const url of localDB.images[imgKey]) {
                await PromptAPI.deleteFile(url);
                const match = url.match(/^\/prompt_data\/([^\/]+)\//);
                if (match) foldersToWipe.add(decodeURIComponent(match[1]));
            }
            delete localDB.images[imgKey]; 
        }
    }
    for (const f of foldersToWipe) {
        await PromptAPI.deleteFolder(f);
    }
}


// ==========================================
// 核心导入引擎 (带策略选择器)
// ==========================================
let pendingImportData = null;

async function handleImportFile(file) {
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            let normalizedData = { contexts: {}, images: {} };

            if (data.type === 'multi_export' && data.contexts) {
                for (const [ctx, ctxData] of Object.entries(data.contexts)) {
                    normalizedData.contexts[ctx] = { items: ctxData.items || [], metadata: ctxData.metadata || {} };
                    if (ctxData.images) { for (const [itemName, imgData] of Object.entries(ctxData.images)) { normalizedData.images[`${ctx}_${itemName}`] = Array.isArray(imgData) ? imgData : [imgData]; } }
                }
            } else if (data.items && data.metadata) {
                const ctx = data.context || getActiveContext();
                normalizedData.contexts[ctx] = { items: data.items || [], metadata: data.metadata || {} };
                if (data.images) { for (const [itemName, imgData] of Object.entries(data.images)) { normalizedData.images[`${ctx}_${itemName}`] = Array.isArray(imgData) ? imgData : [imgData]; } }
            } else if (data.contexts) { normalizedData = data; } else throw new Error("JSON 格式无法识别");

            pendingImportData = normalizedData;
            document.getElementById("pm-import-ctx-count").innerText = Object.keys(normalizedData.contexts).length;
            pmShowModal("pm-import-modal");

        } catch (err) { alert("格式错误或无法解析的数据包！"); }
    };
    reader.readAsText(file);
}

window.executeImportFinal = async function() {
    pmHideModal('pm-import-modal');
    const targetStrategy = document.querySelector('input[name="pm-import-target"]:checked').value;
    const isMerge = document.getElementById('pm-import-merge-check').checked;
    const data = pendingImportData;
    
    try {
        const ctxMapping = {};
        for (let oldCtx of Object.keys(data.contexts)) {
            let targetCtx = oldCtx;
            if (targetStrategy === 'current_tab') {
                let oldModeId = oldCtx.includes('_') ? oldCtx.substring(oldCtx.indexOf('_') + 1) : oldCtx;
                targetCtx = `${currentModelId}_${oldModeId}`;
            } else if (targetStrategy === 'current_mode') {
                targetCtx = getActiveContext();
            }
            ctxMapping[oldCtx] = targetCtx;
        }

        if (data.images) {
            updateProgress("正在处理图片...", "转换并分离存储路径...");
            for (const [imgKey, imgArray] of Object.entries(data.images)) {
                let newImgUrls = []; 
                const firstUnder = imgKey.indexOf('_');
                const oldCtx = firstUnder > -1 ? imgKey.substring(0, firstUnder) : getActiveContext();
                const itemName = firstUnder > -1 ? imgKey.substring(firstUnder + 1) : imgKey;
                const safeName = (itemName || "img").replace(/[^a-zA-Z0-9]/g, '');

                const realTargetCtx = ctxMapping[oldCtx] || oldCtx;

                for (let i = 0; i < imgArray.length; i++) {
                    let imgData = imgArray[i];

                    if (imgData.startsWith('/prompt_data/') && !imgData.includes(`/${realTargetCtx}/`)) {
                        try {
                            imgData = await urlToBase64(imgData);
                        } catch(e) {
                            console.error("图片隔离克隆失败，放弃该图", imgData);
                        }
                    }

                    if (imgData.startsWith('data:image/') || imgData.length > 1000) {
                        const compRate = localDB.settings?.compress_rate ?? 0.85;
                        const url = await PromptAPI.uploadImage(imgData, `import_${safeName}_${Date.now()}_${i}.jpg`, realTargetCtx);
                        if (url) newImgUrls.push(url);
                    } else { 
                        newImgUrls.push(imgData); 
                    }
                }
                data.images[imgKey] = newImgUrls;
            }
        }
        
        updateProgress("合并配置...", "即将完成");
        let clearedCtxs = new Set();

        for (let oldCtx of Object.keys(data.contexts)) {
            const cData = data.contexts[oldCtx];
            const targetCtx = ctxMapping[oldCtx] || oldCtx;
            
            if (targetStrategy === 'current_tab') {
                let oldModeId = oldCtx.includes('_') ? oldCtx.substring(oldCtx.indexOf('_') + 1) : oldCtx;
                if (!localDB.models.main_models[currentModelId].modes[oldModeId]) {
                    const catId = localDB.models.main_models[currentModelId].categories[0]?.id || 'custom';
                    localDB.models.main_models[currentModelId].modes[oldModeId] = { name: oldModeId, group: catId };
                }
            } else if (targetStrategy === 'original') {
                if (targetCtx.includes('_')) {
                    const parts = targetCtx.split('_'); const mId = parts[0]; const modId = parts.slice(1).join('_');
                    if (!localDB.models.main_models[mId]) localDB.models.main_models[mId] = { name: mId, categories: [{id:'custom', name:'导入分类'}], modes: {} };
                    if (!localDB.models.main_models[mId].modes[modId]) localDB.models.main_models[mId].modes[modId] = { name: modId, group: "custom" };
                }
            }
            
            if (!localDB.contexts[targetCtx]) localDB.contexts[targetCtx] = { items: [], metadata: {} };
            const d = localDB.contexts[targetCtx];
            
            if (!isMerge && !clearedCtxs.has(targetCtx)) { 
                d.items = []; d.metadata = {}; 
                clearedCtxs.add(targetCtx);
            }
            
            const newItems = cData.items.filter(i => !d.items.includes(i)); d.items.push(...newItems);
            
            if (cData.metadata) {
                for (const [k, v] of Object.entries(cData.metadata)) {
                    if (d.metadata[k]) {
                        d.metadata[k].tags = [...new Set([...(d.metadata[k].tags||[]), ...(v.tags||[])])];
                    } else d.metadata[k] = v;
                }
            }
            for (const item of cData.items) {
                const oldImgKey = `${oldCtx}_${item}`;
                const newImgKey = `${targetCtx}_${item}`;
                if (data.images[oldImgKey] && data.images[oldImgKey].length > 0) {
                    if (!localDB.images[newImgKey]) localDB.images[newImgKey] = [];
                    localDB.images[newImgKey].push(...data.images[oldImgKey]);
                    localDB.images[newImgKey] = [...new Set(localDB.images[newImgKey])];
                }
            }
        }
        await PromptAPI.saveDB(localDB); 
        hideProgress(); 
        renderModelTabs(); 
        syncImportNodeWidgets();
    } catch (e) { hideProgress(); alert("导入错误: " + e.message); }
}

function getCtxData(ctx) {
    if (!localDB.contexts[ctx]) localDB.contexts[ctx] = { items: [], metadata: {}, cart: [], groups: [], combos: [] };
    if (!localDB.contexts[ctx].groups) localDB.contexts[ctx].groups = [];
    if (!localDB.contexts[ctx].combos) localDB.contexts[ctx].combos = [];
    return localDB.contexts[ctx];
}

window.copyTxt = function(txt) { navigator.clipboard.writeText(txt); alert("已复制: " + txt); }

function openGroupSelectModal(item, ctx) {
    const d = getCtxData(ctx);
    let modal = document.getElementById("pm-group-select-modal");
    if (!modal) {
        modal = document.createElement("div"); modal.id = "pm-group-select-modal"; modal.className = "pm-modal-overlay";
        modal.innerHTML = `
            <div class="pm-create-box">
                <div class="pm-create-header">
                    <b style="color:#eee;" id="pm-gsel-title">归类卡片</b>
                    <button class="pm-close-btn" onclick="pmHideModal('pm-group-select-modal')">关闭</button>
                </div>
                <div class="pm-create-content">
                    <div id="pm-group-select-list" style="max-height: 300px; overflow-y: auto;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    document.getElementById("pm-gsel-title").innerText = `归类卡片: [ ${item} ]`;
    
    const list = document.getElementById("pm-group-select-list");
    if (d.groups.length === 0) list.innerHTML = `<div style="color:#666; text-align:center;">暂无分组，请去左侧"收藏管理"新建。</div>`;
    else list.innerHTML = '';
    
    d.groups.forEach((g, idx) => {
        const has = g.items.includes(item);
        const div = document.createElement("div"); div.className = "pm-list-item";
        div.innerHTML = `
            <label style="cursor:pointer; display:flex; align-items:center; gap:10px;">
                <input type="checkbox" ${has?'checked':''} onchange="toggleGroupItem(${idx}, '${item}', '${ctx}', this.checked)">
                <span style="color:#ccc; font-weight:bold;">${g.name}</span>
            </label>
            <span style="color:#666; font-size:12px;">${g.items.length} 项</span>
        `;
        list.appendChild(div);
    });
    pmShowModal("pm-group-select-modal");
}

window.toggleGroupItem = async function(gIdx, item, ctx, isChecked) {
    const d = getCtxData(ctx); const g = d.groups[gIdx];
    if (isChecked && !g.items.includes(item)) g.items.push(item);
    else if (!isChecked && g.items.includes(item)) g.items = g.items.filter(x => x !== item);
    await PromptAPI.saveDB(localDB); renderGrid(); 
}

function openGroupsModal() {
    const ctx = getActiveContext(); const d = getCtxData(ctx);
    let modal = document.getElementById("pm-groups-modal");
    if (!modal) {
        modal = document.createElement("div"); modal.id = "pm-groups-modal"; modal.className = "pm-modal-overlay"; 
        modal.innerHTML = `
            <div class="pm-create-box" style="width: 750px; height: 80vh;">
                <div class="pm-create-header">
                    <b style="color:#eee;">收藏夹管理</b>
                    <button class="pm-close-btn" onclick="pmHideModal('pm-groups-modal')">关闭</button>
                </div>
                <div class="pm-create-content" style="display:flex; flex-direction:column; height: 100%; padding:0;">
                    <div style="padding:15px; border-bottom:1px solid #333; background:#1a1a1a;">
                        <div style="display:flex; gap:10px;">
                            <input type="text" id="pm-new-grp-name" class="pm-search-input" placeholder="输入新分组名称...">
                            <button class="pm-action-btn primary" onclick="createNewGroup('${ctx}')">新建分组</button>
                        </div>
                    </div>
                    <div id="pm-groups-content" style="flex:1; overflow-y:auto; padding:15px; background:#111;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal); 
    }
    
    const content = document.getElementById("pm-groups-content");
    if (d.groups.length === 0) content.innerHTML = `<div style="color:#555; text-align:center; padding:50px;">当前模式下没有收藏夹分组。</div>`;
    else content.innerHTML = '';

    d.groups.forEach((g, idx) => {
        const div = document.createElement("div"); div.className = "pm-list-item";
        div.innerHTML = `
            <div style="flex:1;">
                <b style="color:#ff6b9d; font-size:16px;">${g.name}</b>
                <div style="color:#888; font-size:12px; margin-top:5px;">包含 ${g.items.length} 张卡片</div>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="pm-action-btn" style="color:#4caf50; border-color:#1e3e1e;" onclick="openGroupDetail(${idx}, '${ctx}')">查看内页</button>
                <button class="pm-action-btn" onclick="copyTxt('${g.items.join(', ')}')">提取 Prompt</button>
                <button class="pm-text-btn danger" onclick="deleteGroup(${idx}, '${ctx}')">删除</button>
            </div>
        `;
        content.appendChild(div);
    });
    pmShowModal("pm-groups-modal");
}

window.createNewGroup = async function(ctx) {
    const val = document.getElementById("pm-new-grp-name").value.trim();
    if (!val) { alert("请输入名称！"); return; }
    getCtxData(ctx).groups.unshift({ name: val, items: [] });
    await PromptAPI.saveDB(localDB); openGroupsModal();
}

window.deleteGroup = async function(idx, ctx) {
    if (confirm("删除此分组？(组内的卡片将保留在总库中)")) {
        getCtxData(ctx).groups.splice(idx, 1); await PromptAPI.saveDB(localDB); openGroupsModal(); renderGrid();
    }
}

window.openGroupDetail = function(idx, ctx) {
    const g = getCtxData(ctx).groups[idx];
    let modal = document.getElementById("pm-group-detail-modal");
    if (!modal) { 
        modal = document.createElement("div"); modal.id = "pm-group-detail-modal"; modal.className = "pm-modal-overlay"; modal.style.zIndex="20002"; 
        modal.innerHTML = `
            <div class="pm-create-box" style="width: 80vw; height: 85vh;">
                <div class="pm-create-header">
                    <b style="color:#ff6b9d;" id="pm-gdt-title">分组内页</b>
                    <button class="pm-close-btn" onclick="pmHideModal('pm-group-detail-modal')">返回列表</button>
                </div>
                <div class="pm-main" id="pm-grp-grid" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));"></div>
            </div>
        `;
        document.body.appendChild(modal); 
    }
    
    document.getElementById("pm-gdt-title").innerText = `分组内页: ${g.name}`;
    const grid = document.getElementById("pm-grp-grid");
    if (g.items.length === 0) grid.innerHTML = `<div style="color:#555; grid-column:1/-1;">分组内空空如也。</div>`;
    else grid.innerHTML = '';
    
    g.items.forEach(item => {
        const imgList = localDB.images[`${ctx}_${item}`] || [];
        const card = document.createElement("div"); card.className = "pm-card";
        
        let imgHtml = imgList.length > 0 ? `<img src="${imgList[0]}" onclick="document.getElementById('pm-viewer-img').src='${imgList[0]}'; pmShowModal('pm-image-viewer');">` : `<div class="pm-no-img">暂无图片</div>`;
        
        card.innerHTML = `
            <div class="pm-card-img-wrap" style="cursor:pointer;">
                ${imgHtml}
                <div class="pm-img-overlay" style="display:flex;">
                    <button class="pm-text-btn danger" style="margin:auto;" onclick="removeCardFromGroup(${idx}, '${item}', '${ctx}')">移出分组</button>
                </div>
            </div>
            <div class="pm-card-title">${item}</div>
        `;
        grid.appendChild(card);
    });
    pmShowModal("pm-group-detail-modal");
}

window.removeCardFromGroup = async function(gIdx, item, ctx) {
    const g = getCtxData(ctx).groups[gIdx];
    g.items = g.items.filter(x => x !== item);
    await PromptAPI.saveDB(localDB);
    openGroupDetail(gIdx, ctx); renderGrid();
}

function openCombosModal() {
    const ctx = getActiveContext(); const d = getCtxData(ctx);
    let modal = document.getElementById("pm-combos-modal");
    if (!modal) {
        modal = document.createElement("div"); modal.id = "pm-combos-modal"; modal.className = "pm-modal-overlay"; 
        modal.innerHTML = `
            <div class="pm-create-box" style="width: 800px; height: 80vh;">
                <div class="pm-create-header">
                    <b style="color:#eee;">组合预设管理</b>
                    <button class="pm-close-btn" onclick="pmHideModal('pm-combos-modal')">关闭</button>
                </div>
                <div class="pm-create-content" style="display:flex; flex-direction:column; height: 100%; padding:0;">
                    <div style="padding:15px; border-bottom:1px solid #333; background:#1a1a1a;">
                        <button class="pm-action-btn primary" style="width:100%;" onclick="createNewCombo('${ctx}')">创建新组合</button>
                    </div>
                    <div id="pm-combos-content" style="flex:1; overflow-y:auto; padding:15px; background:#111;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.id = "pm-hidden-combo-img"; fileInput.accept = "image/*"; fileInput.style.display = "none";
        document.body.appendChild(fileInput);
        fileInput.onchange = async (e) => {
            if (e.target.files.length > 0 && window.currentComboEditIdx !== undefined) {
                updateProgress("上传组合预览图...", "请稍候");
                
                const compRate = localDB.settings?.compress_rate ?? 0.85;
                const maxWidth = localDB.settings?.max_width ?? 900;
                const base64 = await compressImage(e.target.files[0], maxWidth, compRate);
                const hash = cyrb53(base64);
                const url = await PromptAPI.uploadImage(base64, `combo_${hash}.jpg`, ctx);
                
                if (url) {
                    const cbs = localDB.contexts[ctx].combos;
                    if (cbs[window.currentComboEditIdx].image) await PromptAPI.deleteFile(cbs[window.currentComboEditIdx].image);
                    cbs[window.currentComboEditIdx].image = url;
                    await PromptAPI.saveDB(localDB); openComboEditModal(window.currentComboEditIdx, ctx); openCombosModal();
                }
                hideProgress();
            }
            e.target.value = '';
        };
    }
    
    const content = document.getElementById("pm-combos-content");
    if (d.combos.length === 0) content.innerHTML = `<div style="color:#555; text-align:center; padding:50px;">暂无组合预设。</div>`;
    else content.innerHTML = '';
    
    d.combos.forEach((c, idx) => {
        const div = document.createElement("div"); div.className = "pm-combo-card";
        const imgHtml = c.image ? `<img src="${c.image}" style="width:100px; height:100px; object-fit:cover; border-radius:8px; cursor:pointer;" onclick="document.getElementById('pm-viewer-img').src='${c.image}'; pmShowModal('pm-image-viewer');">` : `<div style="width:100px; height:100px; background:#222; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#444; font-size:12px;">无预览图</div>`;
        const promptStr = c.elements.map(e => e.weight != 1 ? `(${e.tag}:${e.weight})` : e.tag).join(', ');

        div.innerHTML = `
            ${imgHtml}
            <div style="flex:1; display:flex; flex-direction:column; justify-content:center;">
                <b style="color:#ff6b9d; font-size:16px; margin-bottom:5px;">${c.name}</b>
                <div style="color:#888; font-size:12px; line-height:1.4; max-height:40px; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${promptStr || '暂无标签...'}</div>
            </div>
            <div style="display:flex; flex-direction:column; justify-content:center; gap:8px; min-width:110px;">
                <button class="pm-action-btn" style="color:#fff; padding:6px 10px; font-size:12px;" onclick="exportComboToBrowser(${idx}, '${ctx}')">导出到浏览器</button>
                <button class="pm-action-btn" style="padding:6px 10px; font-size:12px;" onclick="openComboEditModal(${idx}, '${ctx}')">编辑</button>
                <button class="pm-action-btn" style="color:#f44336; border-color:#5a1a1a; padding:6px 10px; font-size:12px;" onclick="deleteCombo(${idx}, '${ctx}')">删除</button>
            </div>
        `;
        content.appendChild(div);
    });
    pmShowModal("pm-combos-modal");
}

window.createNewCombo = async function(ctx) {
    localDB.contexts[ctx].combos.unshift({ name: "新组合预设_" + Date.now(), elements: [], image: null });
    await PromptAPI.saveDB(localDB); openCombosModal(); openComboEditModal(0, ctx);
}

window.openComboEditModal = function(idx, ctx) {
    const c = getCtxData(ctx).combos[idx]; window.currentComboEditIdx = idx;
    let modal = document.getElementById("pm-combo-edit-modal");
    if (!modal) { 
        modal = document.createElement("div"); modal.id = "pm-combo-edit-modal"; modal.className = "pm-modal-overlay"; modal.style.zIndex="20002"; 
        modal.innerHTML = `
            <div class="pm-create-box" style="width: 500px;">
                <div class="pm-create-header">
                    <b style="color:#ff6b9d;" id="pm-cedit-title">编辑组合</b>
                    <button class="pm-close-btn" onclick="pmHideModal('pm-combo-edit-modal')">返回</button>
                </div>
                <div class="pm-create-content" id="pm-cedit-content"></div>
            </div>
        `;
        document.body.appendChild(modal); 
    }
    
    document.getElementById("pm-cedit-title").innerText = `编辑组合: ${c.name}`;
    let imgArea = c.image ? `<img src="${c.image}" style="width:100%; height:200px; object-fit:contain; border-radius:8px; cursor:pointer;" onclick="document.getElementById('pm-hidden-combo-img').click()">` : `<div style="width:100%; height:200px; background:#111; border:1px dashed #444; border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:#777;" onclick="document.getElementById('pm-hidden-combo-img').click()">点击上传预览图</div>`;

    document.getElementById("pm-cedit-content").innerHTML = `
        <input type="text" class="pm-search-input" style="width:100%; margin-bottom:15px; font-weight:bold; font-size:14px;" value="${c.name}" onchange="updateComboName(${idx}, '${ctx}', this.value)">
        ${imgArea}
        <div style="margin: 15px 0 5px 0; color:#888; font-size:12px; display:flex; justify-content:space-between; align-items:center;">
            <span>组合标签列表：</span>
            <button class="pm-action-btn" style="padding:4px 8px; font-size:11px;" onclick="importNodeToCombo(${idx}, '${ctx}')">从节点列表导入</button>
        </div>
        <div id="pm-combo-edit-elements" style="background:#111; padding:10px; border-radius:8px; border:1px solid #333; max-height:200px; overflow-y:auto;"></div>
        <button class="pm-add-btn" style="width:100%; margin-top:10px;" onclick="addComboElement(${idx}, '${ctx}')">新增一行标签</button>
    `;

    const elContainer = document.getElementById("pm-combo-edit-elements");
    if (c.elements.length === 0) elContainer.innerHTML = `<div style="color:#555; text-align:center;">暂无标签，请添加。</div>`;
    c.elements.forEach((el, elIdx) => {
        const elDiv = document.createElement("div"); elDiv.style.display = "flex"; elDiv.style.gap = "8px"; elDiv.style.marginBottom = "8px";
        elDiv.innerHTML = `
            <input type="text" class="pm-search-input" style="flex:3; padding:6px 10px;" value="${el.tag}" placeholder="标签内容" onchange="updateComboEl(${idx}, ${elIdx}, 'tag', this.value, '${ctx}')">
            <input type="number" step="0.1" class="pm-search-input" style="flex:1; padding:6px 10px;" value="${el.weight || 1}" placeholder="权重" onchange="updateComboEl(${idx}, ${elIdx}, 'weight', this.value, '${ctx}')">
            <button class="pm-text-btn danger" onclick="removeComboEl(${idx}, ${elIdx}, '${ctx}')">删除</button>
        `;
        elContainer.appendChild(elDiv);
    });
    pmShowModal("pm-combo-edit-modal");
}

window.updateComboName = async function(idx, ctx, val) { localDB.contexts[ctx].combos[idx].name = val; await PromptAPI.saveDB(localDB); openCombosModal(); }
window.addComboElement = async function(idx, ctx) { localDB.contexts[ctx].combos[idx].elements.push({ tag: "新标签", weight: 1 }); await PromptAPI.saveDB(localDB); openComboEditModal(idx, ctx); openCombosModal(); }
window.updateComboEl = async function(cIdx, eIdx, field, val, ctx) { localDB.contexts[ctx].combos[cIdx].elements[eIdx][field] = val; await PromptAPI.saveDB(localDB); openCombosModal(); }
window.removeComboEl = async function(cIdx, eIdx, ctx) { localDB.contexts[ctx].combos[cIdx].elements.splice(eIdx, 1); await PromptAPI.saveDB(localDB); openComboEditModal(cIdx, ctx); openCombosModal(); }

// 新增：从节点导入组合的逻辑
window.importNodeToCombo = async function(idx, ctx) {
    let textToImport = "";
    // 优先从当前激活的节点输入框获取
    if (currentActiveWidget && currentActiveWidget.value) {
        textToImport = currentActiveWidget.value;
    } else {
        // 兜底方案：去画板上找第一个 Prompt浏览器 节点
        const browserNode = app.graph._nodes.find(n => n.type === "PromptBrowserNode");
        if (browserNode) {
            const w = browserNode.widgets?.find(w => w.name === "prompt_text" || w.name === "输入prompt");
            if (w) textToImport = w.value;
        }
    }

    if (!textToImport.trim()) {
        alert("节点列表中暂无 Prompt，请先在节点中添加！");
        return;
    }

    const parsed = parsePromptText(textToImport);
    const combo = localDB.contexts[ctx].combos[idx];
    let addedCount = 0;

    parsed.forEach(p => {
        // 去重判断，避免重复导入相同的 tag
        if (!combo.elements.some(e => e.tag === p.tag)) {
            combo.elements.push({ tag: p.tag, weight: p.weight });
            addedCount++;
        }
    });

    if (addedCount > 0) {
        await PromptAPI.saveDB(localDB);
        openComboEditModal(idx, ctx); // 刷新当前编辑面板
        openCombosModal(); // 后台同步刷新组合大列表
    } else {
        alert("节点列表中的标签已存在于当前组合中！");
    }
}

window.exportComboToBrowser = function(idx, ctx) {
    const c = localDB.contexts[ctx].combos[idx];
    const promptStr = c.elements.map(e => e.weight != 1 ? `(${e.tag}:${e.weight})` : e.tag).join(', ');
    
    if (!promptStr) {
        alert("组合为空！");
        return;
    }

    let targetWidget = currentActiveWidget;
    if (!targetWidget) {
        // 如果没有记住激活的节点，则去画板上找第一个浏览器节点
        const browserNode = app.graph._nodes.find(n => n.type === "PromptBrowserNode");
        if (browserNode) {
            targetWidget = browserNode.widgets?.find(w => w.name === "prompt_text" || w.name === "输入prompt");
        }
    }
    
    if (targetWidget) {
        let currentVal = targetWidget.value || "";
        if (currentVal && !currentVal.endsWith(",") && !currentVal.endsWith(", ")) {
            currentVal += ", ";
        }
        targetWidget.value = currentVal + promptStr;
        app.graph.setDirtyCanvas(true); // 触发 ComfyUI 画布脏标记刷新 UI
        alert("已成功导出组合到 Prompt 浏览器节点中！");
    } else {
        alert("找不到 Prompt 浏览器节点！请先在画布上创建一个。");
    }
}

window.deleteCombo = async function(idx, ctx) {
    if (confirm("彻底删除这个组合预设吗？")) {
        const c = localDB.contexts[ctx].combos[idx];
        if (c.image) await PromptAPI.deleteFile(c.image);
        localDB.contexts[ctx].combos.splice(idx, 1); await PromptAPI.saveDB(localDB); openCombosModal();
    }
}

// ==========================================
// 节点 5 注册：Prompt收藏夹盲盒 (带列表 UI 与权重控制)
// ==========================================
app.registerExtension({
    name: "PromptManager.GroupRandomizerNode",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "PromptGroupRandomizerNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                const promptWidget = this.widgets.find(w => w.name === "prompt_text" || w.name === "输入prompt");
                
                // === 新增：隐藏原生文本框，只留着它默默存储和传递数据 ===
                if (promptWidget) {
                    if (promptWidget.inputEl) {
                        promptWidget.inputEl.style.display = "none";
                    }
                    promptWidget.computeSize = () => [0, -4]; // 去除其占据的高度空间
                }

                // 完全复用 PromptBrowserNode 的列表 UI
                const listContainer = document.createElement("div");
                listContainer.style.cssText = "width: 100%; min-height: 50px; max-height: 180px; overflow-y: auto; background: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 5px; box-sizing: border-box; display: flex; flex-direction: column; gap: 4px; font-family: sans-serif;";
                
                listContainer.addEventListener("wheel", (e) => e.stopPropagation(), { passive: false });
                listContainer.addEventListener("pointerdown", (e) => e.stopPropagation());

                const header = document.createElement("div");
                header.style.cssText = "display: flex; justify-content: space-between; font-size: 11px; color: #ff6b9d; font-weight: bold; padding: 0 5px 4px 5px; border-bottom: 1px dashed rgba(255,107,157,0.4); margin-bottom: 4px;";
                header.innerHTML = `<span>&lt;盲盒结果区&gt;</span><span style="padding-right:38px;">&lt;权重&gt;</span>`;
                
                const listBody = document.createElement("div");
                listBody.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
                
                listContainer.appendChild(header);
                listContainer.appendChild(listBody);

                this.addDOMWidget("prompt_list", "HTML", listContainer, { serialize: false, hideOnZoom: false });

                let cachedList = [];
                let isUpdatingFromList = false;

                const renderList = () => {
                    listBody.innerHTML = '';
                    
                    if (!isUpdatingFromList) {
                        cachedList = parsePromptText(promptWidget.value);
                    }

                    if (cachedList.length === 0) {
                        listBody.innerHTML = '<div style="color:#555; font-size:11px; text-align:center; padding:10px;">点击按钮抽取盲盒</div>';
                        return;
                    }

                    cachedList.forEach((item, index) => {
                        const row = document.createElement("div");
                        row.style.cssText = `display: flex; justify-content: space-between; align-items: center; background: #252525; padding: 4px 6px; border-radius: 4px; transition: 0.2s; ${item.enabled === false ? 'opacity: 0.4;' : ''}`;
                        
                        const tagSpan = document.createElement("span");
                        tagSpan.style.cssText = `color: #ddd; font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; cursor: pointer; user-select: none; ${item.enabled === false ? 'text-decoration: line-through;' : ''}`;
                        tagSpan.title = "双击停用(移除) / 恢复启用";
                        tagSpan.innerText = item.tag;

                        tagSpan.ondblclick = (e) => {
                            e.stopPropagation();
                            isUpdatingFromList = true;
                            item.enabled = item.enabled === false ? true : false;
                            promptWidget.value = buildPromptText(cachedList);
                            app.graph.setDirtyCanvas(true);
                            renderList();
                            setTimeout(() => { isUpdatingFromList = false; }, 50);
                        };

                        const rightCtrl = document.createElement("div");
                        rightCtrl.style.cssText = "display: flex; align-items: center; gap: 6px;";

                        const numInput = document.createElement("input");
                        numInput.type = "number";
                        numInput.step = "0.1";
                        numInput.value = item.weight.toFixed(1);
                        numInput.disabled = item.enabled === false;
                        numInput.style.cssText = `width: 45px; background: #111; border: 1px solid #444; color: #ff6b9d; font-size: 12px; font-weight: bold; border-radius: 4px; text-align: center; outline: none; ${item.enabled === false ? 'cursor: not-allowed; opacity: 0.5;' : ''}`;
                        
                        numInput.onchange = (e) => {
                            isUpdatingFromList = true;
                            item.weight = parseFloat(e.target.value) || 1.0;
                            promptWidget.value = buildPromptText(cachedList);
                            app.graph.setDirtyCanvas(true);
                            renderList();
                            setTimeout(() => { isUpdatingFromList = false; }, 50);
                        };

                        const delBtn = document.createElement("button");
                        delBtn.innerHTML = "×";
                        delBtn.title = "彻底删除此项";
                        delBtn.style.cssText = "background: #5a1a1a; color: #f44336; border: none; border-radius: 4px; width: 22px; height: 22px; cursor: pointer; font-weight: bold; display: flex; align-items: center; justify-content: center; transition: 0.2s;";
                        delBtn.onmouseover = () => delBtn.style.background = "#f44336";
                        delBtn.onmouseout = () => delBtn.style.background = "#5a1a1a";
                        delBtn.onclick = (e) => {
                            e.stopPropagation();
                            isUpdatingFromList = true;
                            cachedList.splice(index, 1);
                            promptWidget.value = buildPromptText(cachedList);
                            app.graph.setDirtyCanvas(true);
                            renderList();
                            setTimeout(() => { isUpdatingFromList = false; }, 50);
                        };

                        rightCtrl.appendChild(numInput);
                        rightCtrl.appendChild(delBtn);
                        row.appendChild(tagSpan);
                        row.appendChild(rightCtrl);
                        listBody.appendChild(row);
                    });
                };

                const originalCallback = promptWidget.callback;
                promptWidget.callback = function() {
                    if (originalCallback) originalCallback.apply(this, arguments);
                    if (!isUpdatingFromList) renderList();
                };

                renderList();

                // 核心：抽取盲盒按钮逻辑
                this.addWidget("button", "抽取盲盒", "draw_blind_box", async () => {
                    if (Object.keys(localDB.contexts || {}).length === 0) {
                        localDB = await getAndMigrateDB();
                    }
                    
                    const groupWidget = this.widgets.find(w => w.name === "选择分组");
                    const countWidget = this.widgets.find(w => w.name === "抽取数量");
                    
                    if (!groupWidget || !countWidget || groupWidget.value === "无可用分组_请先创建" || !groupWidget.value.includes(" || ")) {
                        alert("请先创建收藏分组并选择！");
                        return;
                    }

                    const [ctx_id, g_name] = groupWidget.value.split(" || ");
                    const groups = localDB.contexts?.[ctx_id]?.groups || [];
                    const targetGroup = groups.find(g => g.name === g_name);

                    if (!targetGroup || !targetGroup.items || targetGroup.items.length === 0) {
                        alert(`分组 [${g_name}] 内没有任何卡片，无法抽取！`);
                        return;
                    }

                    const count = Math.min(targetGroup.items.length, countWidget.value);
                    const shuffled = [...targetGroup.items].sort(() => 0.5 - Math.random());
                    const selected = shuffled.slice(0, count);

                    const newParsed = selected.map(tag => ({ original: tag, tag: tag, weight: 1.0, enabled: true }));
                    promptWidget.value = buildPromptText(newParsed);
                    app.graph.setDirtyCanvas(true);
                    renderList();
                });
                
                // 缩小节点初始高度，让界面更紧凑
                this.setSize([400, 260]);
            };
        }
    }
});

// ==========================================
// 节点 6 注册：Prompt实时预览图 (逆向查线即时刷新机制)
// ==========================================
app.registerExtension({
    name: "PromptManager.PreviewNode",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "PromptPreviewNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                
                const container = document.createElement("div");
                container.style.cssText = "width: 100%; height: 100%; min-height: 200px; display: flex; align-items: center; justify-content: center; background: #111; border-radius: 8px; overflow: hidden; border: 1px dashed #444;";
                
                const img = document.createElement("img");
                img.style.cssText = "max-width: 100%; max-height: 100%; object-fit: contain; display: none; cursor: zoom-in;";
                
                img.addEventListener("pointerup", (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (img.src) {
                        let viewer = document.getElementById("pm-standalone-viewer");
                        const fullImgEl = document.getElementById("pm-standalone-img");
                        if (viewer && fullImgEl) {
                            fullImgEl.src = img.src;
                            pmShowModal("pm-standalone-viewer");
                        }
                    }
                });

                const placeholder = document.createElement("div");
                placeholder.style.cssText = "color: #555; font-size: 12px; font-weight: bold; text-align: center;";
                placeholder.innerHTML = "等待连接到<br><span style='color:#ff6b9d'>[组合预设加载器]</span>";
                
                container.appendChild(img);
                container.appendChild(placeholder);
                
                this.addDOMWidget("preview_img", "HTML", container, { serialize: false, hideOnZoom: false });
                
                this.lastCombo = null;
                
                // 核心黑科技：心跳检测其相连的前置节点状态，从而实现 0 延迟刷新
                const checkUpdate = () => {
                    if (!this.graph || this.flags?.collapsed) { 
                        setTimeout(checkUpdate, 500); return; 
                    }
                    
                    let currentComboName = null;
                    const input = this.inputs?.find(inp => inp.name === "图像" || inp.type === "IMAGE");
                    if (input && input.link) {
                        const link = this.graph.links[input.link];
                        if (link) {
                            const originNode = this.graph.getNodeById(link.origin_id);
                            if (originNode && originNode.type === "PromptComboLoaderNode") {
                                const comboWidget = originNode.widgets?.find(w => w.name === "选择组合");
                                if (comboWidget) currentComboName = comboWidget.value;
                            }
                        }
                    }
                    
                    if (currentComboName !== this.lastCombo) {
                        this.lastCombo = currentComboName;
                        if (!currentComboName || currentComboName === "无可用组合_请先创建") {
                            img.style.display = "none";
                            placeholder.style.display = "block";
                            placeholder.innerHTML = "等待连接到<br><span style='color:#ff6b9d'>[组合预设加载器]</span>";
                        } else {
                            // 去内存数据库里光速查出组合图 URL
                            let imgUrl = null;
                            if (localDB.contexts) {
                                for (const ctx of Object.values(localDB.contexts)) {
                                    const combo = (ctx.combos || []).find(c => c.name === currentComboName);
                                    if (combo && combo.image) {
                                        imgUrl = combo.image;
                                        break;
                                    }
                                }
                            }
                            
                            if (imgUrl) {
                                img.src = imgUrl;
                                img.style.display = "block";
                                placeholder.style.display = "none";
                            } else {
                                img.style.display = "none";
                                placeholder.style.display = "block";
                                placeholder.innerText = "该组合尚未上传预览图";
                            }
                        }
                    }
                    setTimeout(checkUpdate, 300);
                };
                checkUpdate();
                this.setSize([280, 280]);
            };
        }
    }
});