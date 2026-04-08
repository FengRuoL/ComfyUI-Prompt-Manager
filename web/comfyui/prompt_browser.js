import { app } from "../../scripts/app.js";
import { PromptAPI } from "./prompt_api.js";

// === 1. 初始化全局引用 ===
window.PM_Global = window.PM_Global || { state: {}, utils: {}, ui: {} };
const STATE = window.PM_Global.state;
const UTILS = window.PM_Global.utils;
const UI = window.PM_Global.ui;

window.PM_Global.ui.openNativeBrowser = openNativeBrowser;
window.PM_Global.ui.renderGrid = renderGrid;

window.switchCreateTab = function(tab) {
    document.querySelectorAll('.pm-ct-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('[id^="ct-content-"]').forEach(c => c.style.display = 'none');
    document.getElementById(`ct-btn-${tab}`).classList.add('active');
    document.getElementById(`ct-content-${tab}`).style.display = 'block';
};

window.createSinglePrompt = async function() {
    const val = document.getElementById("pm-create-single-input").value.trim();
    if (!val) return alert("请输入提示词内容！");
    const ctx = `${STATE.currentModelId}_${STATE.currentModeId}`;
    if (!STATE.localDB.contexts[ctx]) STATE.localDB.contexts[ctx] = { items: [], metadata: {} };
    if (STATE.localDB.contexts[ctx].items.includes(val)) return alert("该卡片已存在！");
    STATE.localDB.contexts[ctx].items.push(val); STATE.localDB.contexts[ctx].metadata[val] = { tags: [] };
    await PromptAPI.saveDB(STATE.localDB);
    document.getElementById("pm-create-single-input").value = "";
    window.pmHideModal("pm-create-modal"); renderGrid();
};

window.executeEditCard = async function() {
    if (!STATE.currentEditCardTarget) return;
    const { item, ctx } = STATE.currentEditCardTarget;
    const newVal = document.getElementById("pm-edit-card-input").value.trim();
    const tagsStr = document.getElementById("pm-edit-card-tags").value.trim();
    const newTags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(t => t) : [];
    
    if (!newVal) return alert("Prompt 不能为空！");
    const ctxData = STATE.localDB.contexts[ctx];
    if (newVal !== item && ctxData.items.includes(newVal)) return alert("该 Prompt 已存在！");
    
    UI.updateProgress("正在修改...", "同步数据");
    try {
        if (newVal !== item) {
            const itemIdx = ctxData.items.indexOf(item);
            if (itemIdx > -1) ctxData.items[itemIdx] = newVal;
            if (ctxData.metadata && ctxData.metadata[item]) { ctxData.metadata[newVal] = ctxData.metadata[item]; delete ctxData.metadata[item]; }
            if (ctxData.groups) ctxData.groups.forEach(g => { const idx = g.items.indexOf(item); if (idx > -1) g.items[idx] = newVal; });
            if (ctxData.combos) ctxData.combos.forEach(c => { c.elements.forEach(e => { if (e.tag === item) e.tag = newVal; }); });
            
            const oldImgKey = `${ctx}_${item}`; const newImgKey = `${ctx}_${newVal}`;
            if (STATE.localDB.images[oldImgKey]) { STATE.localDB.images[newImgKey] = STATE.localDB.images[oldImgKey]; delete STATE.localDB.images[oldImgKey]; }
        }
        if (!ctxData.metadata[newVal]) ctxData.metadata[newVal] = { tags: [] };
        ctxData.metadata[newVal].tags = newTags;
        await PromptAPI.saveDB(STATE.localDB); window.pmHideModal("pm-edit-card-modal"); renderGrid();
    } catch (e) { alert("修改失败！"); } finally { UI.hideProgress(); }
};

window.PM_Global.ui.openGroupSelectModal = function(item, ctx) {
    const d = STATE.localDB.contexts[ctx];
    if(!d.groups) d.groups = [];
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
    if (d.groups.length === 0) list.innerHTML = `<div style="color:#666; text-align:center;">暂无分组，请去左侧"收藏管理"新建。</div>`; else list.innerHTML = '';
    
    d.groups.forEach((g, idx) => {
        const has = g.items.includes(item);
        const div = document.createElement("div"); div.className = "pm-list-item";
        div.innerHTML = `
            <label style="cursor:pointer; display:flex; align-items:center; gap:10px;">
                <input type="checkbox" ${has?'checked':''} onchange="PM_Global.ui.toggleGroupItem(${idx}, '${item}', '${ctx}', this.checked)">
                <span style="color:#ccc; font-weight:bold;">${g.name}</span>
            </label>
            <span style="color:#666; font-size:12px;">${g.items.length} 项</span>
        `;
        list.appendChild(div);
    });
    window.pmShowModal("pm-group-select-modal");
};

window.PM_Global.ui.toggleGroupItem = async function(gIdx, item, ctx, isChecked) {
    const d = STATE.localDB.contexts[ctx]; const g = d.groups[gIdx];
    if (isChecked && !g.items.includes(item)) g.items.push(item);
    else if (!isChecked && g.items.includes(item)) g.items = g.items.filter(x => x !== item);
    await PromptAPI.saveDB(STATE.localDB); renderGrid(); 
};

window.executeImportFinal = async function() {
    window.pmHideModal('pm-import-modal');
    const targetStrategy = document.querySelector('input[name="pm-import-target"]:checked').value;
    
    // === 新增拦截逻辑：防止无分类时生成 null_xxx 文件夹 ===
    if (targetStrategy !== 'original') {
        if (!STATE.currentModelId || !STATE.currentModeId) {
            alert("导入失败：当前没有任何分类环境！\n请选择【原路严格恢复】，或者先关闭窗口创建一个模型和分类。");
            return;
        }
    }
    // ====================================================

    const isMerge = document.getElementById('pm-import-merge-check').checked;
    const data = STATE.pendingImportData;
    
    const getModIdFromCtx = (ctx) => {
        let mId = ctx.split('_')[0];
        if (data.models && data.models.main_models) {
            for (const key of Object.keys(data.models.main_models)) {
                if (ctx.startsWith(key + '_')) return ctx.substring(key.length + 1);
            }
        }
        return ctx.substring(mId.length + 1);
    };

    try {
        const ctxMapping = {};
        for (let oldCtx of Object.keys(data.contexts)) {
            let targetCtx = oldCtx;
            if (targetStrategy === 'current_tab') {
                let oldModeId = getModIdFromCtx(oldCtx);
                targetCtx = `${STATE.currentModelId}_${oldModeId}`;
            } else if (targetStrategy === 'current_mode') {
                targetCtx = `${STATE.currentModelId}_${STATE.currentModeId}`;
            }
            ctxMapping[oldCtx] = targetCtx;
        }

        if (data.images) {
            UI.updateProgress("处理图片...", "转换并分离路径...");
            let newImagesMap = {};
            for (let oldCtx of Object.keys(data.contexts)) {
                const targetCtx = ctxMapping[oldCtx] || oldCtx;
                for (const item of data.contexts[oldCtx].items) {
                    const oldImgKey = `${oldCtx}_${item}`;
                    const newImgKey = `${targetCtx}_${item}`;
                    const safeName = (item || "img").replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').substring(0, 20);
                    
                    if (data.images[oldImgKey] && data.images[oldImgKey].length > 0) {
                        newImagesMap[newImgKey] = [];
                        for (let i = 0; i < data.images[oldImgKey].length; i++) {
                            let imgData = data.images[oldImgKey][i];
                            if (imgData.startsWith('/prompt_data/') && !imgData.includes(`/${targetCtx}/`)) {
                                try { imgData = await UTILS.urlToBase64(imgData); } catch(e) {}
                            }
                            if (imgData.startsWith('data:image/') || imgData.length > 1000) {
                                const url = await PromptAPI.uploadImage(imgData, `import_${safeName}_${Date.now()}_${i}.jpg`, targetCtx);
                                if (url) newImagesMap[newImgKey].push(url);
                            } else {
                                newImagesMap[newImgKey].push(imgData);
                            }
                        }
                    }
                }
            }
            data.images = newImagesMap;
        }
        
        UI.updateProgress("合并配置...", "即将完成");
        let clearedCtxs = new Set();
        for (let oldCtx of Object.keys(data.contexts)) {
            const cData = data.contexts[oldCtx];
            const targetCtx = ctxMapping[oldCtx] || oldCtx;
            const meta = STATE.pendingImportMeta[oldCtx] || {};
            const modeName = meta.modeName || '导入模式';
            const modelName = meta.modelName || '导入模型';
            
            if (targetStrategy === 'current_tab') {
                let oldModeId = getModIdFromCtx(oldCtx);
                if (!STATE.localDB.models.main_models[STATE.currentModelId].modes[oldModeId]) {
                    const catId = STATE.localDB.models.main_models[STATE.currentModelId].categories[0]?.id || 'custom';
                    STATE.localDB.models.main_models[STATE.currentModelId].modes[oldModeId] = { name: modeName, group: catId };
                }
            } else if (targetStrategy === 'original') {
                let mId = oldCtx.split('_')[0];
                let modId = oldCtx.substring(mId.length + 1);
                if (data.models && data.models.main_models) {
                    for (const key of Object.keys(data.models.main_models)) {
                        if (oldCtx.startsWith(key + '_')) { mId = key; modId = oldCtx.substring(key.length + 1); break; }
                    }
                }
                if (!STATE.localDB.models.main_models[mId]) STATE.localDB.models.main_models[mId] = { name: modelName, categories: [{id:'custom', name:'导入分类'}], modes: {} };
                if (!STATE.localDB.models.main_models[mId].modes[modId]) STATE.localDB.models.main_models[mId].modes[modId] = { name: modeName, group: "custom" };
            }

            if (!STATE.localDB.contexts[targetCtx]) STATE.localDB.contexts[targetCtx] = { items: [], metadata: {} };
            const d = STATE.localDB.contexts[targetCtx];
            if (!isMerge && !clearedCtxs.has(targetCtx)) { 
                d.items = []; d.metadata = {}; 
                d.groups = []; d.combos = [];
                clearedCtxs.add(targetCtx); 
            }
            
            const newItems = cData.items.filter(i => !d.items.includes(i)); 
            d.items.push(...newItems);
            
            if (cData.metadata) {
                for (const [k, v] of Object.entries(cData.metadata)) {
                    if (d.metadata[k]) d.metadata[k].tags = [...new Set([...(d.metadata[k].tags||[]), ...(v.tags||[])])];
                    else d.metadata[k] = v;
                }
            }
            
            if (cData.groups) {
                if (!d.groups) d.groups = [];
                cData.groups.forEach(g => {
                    let existingGroup = d.groups.find(x => x.name === g.name);
                    if (existingGroup) existingGroup.items = [...new Set([...existingGroup.items, ...g.items])];
                    else d.groups.push(JSON.parse(JSON.stringify(g)));
                });
            }
            if (cData.combos) {
                if (!d.combos) d.combos = [];
                cData.combos.forEach(c => {
                    let existingCombo = d.combos.find(x => x.name === c.name);
                    if (existingCombo) { existingCombo.elements = c.elements; if(c.image) existingCombo.image = c.image; }
                    else d.combos.push(JSON.parse(JSON.stringify(c)));
                });
            }

            for (const item of cData.items) {
                const newImgKey = `${targetCtx}_${item}`;
                if (data.images[newImgKey] && data.images[newImgKey].length > 0) {
                    if (!STATE.localDB.images[newImgKey]) STATE.localDB.images[newImgKey] = [];
                    STATE.localDB.images[newImgKey].push(...data.images[newImgKey]);
                    STATE.localDB.images[newImgKey] = [...new Set(STATE.localDB.images[newImgKey])];
                }
            }
        }
        await PromptAPI.saveDB(STATE.localDB); UI.hideProgress(); renderModelTabs(); UTILS.syncImportNodeWidgets();
    } catch (e) { UI.hideProgress(); alert("导入错误: " + e.message); }
};

window.PM_Global.ui.openBatchEditModal = function() {
    if (STATE.batchSelection.size === 0) return alert("请先选中需要编辑的卡片");
    document.getElementById('pm-batch-affect-count').innerText = STATE.batchSelection.size;
    
    const sel = document.getElementById('pm-batch-group-select');
    sel.innerHTML = '';
    const ctx = `${STATE.currentModelId}_${STATE.currentModeId}`;
    const groups = STATE.localDB.contexts[ctx]?.groups || [];
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.name; opt.innerText = g.name; sel.appendChild(opt);
    });
    window.pmShowModal('pm-batch-edit-modal');
};

window.PM_Global.ui.onBatchActionChange = function(val) {
    document.getElementById('pm-batch-tag-div').style.display = val.includes('tags') ? 'block' : 'none';
    document.getElementById('pm-batch-group-div').style.display = val.includes('group') ? 'block' : 'none';
};

window.PM_Global.ui.executeBatchEdit = async function() {
    const act = document.getElementById('pm-batch-action-select').value;
    if (act === 'add-tags' || act === 'remove-tags') {
        const tags = document.getElementById('pm-batch-tag-input').value.split(',').map(x => x.trim()).filter(x => x);
        STATE.batchSelection.forEach(batchKey => {
            const [ctx, item] = batchKey.split('||');
            const d = STATE.localDB.contexts[ctx];
            if (!d) return;
            if (!d.metadata[item]) d.metadata[item] = { tags: [] };
            if (act === 'add-tags') { d.metadata[item].tags = [...new Set([...d.metadata[item].tags, ...tags])]; } 
            else { d.metadata[item].tags = d.metadata[item].tags.filter(x => !tags.includes(x)); }
        });
    } else {
        const gName = document.getElementById('pm-batch-group-select').value;
        const targetCtx = `${STATE.currentModelId}_${STATE.currentModeId}`;
        const g = STATE.localDB.contexts[targetCtx]?.groups?.find(x => x.name === gName);
        if (g) {
            STATE.batchSelection.forEach(batchKey => {
                const [ctx, item] = batchKey.split('||');
                if (ctx === targetCtx) {
                    if (act === 'add-to-group' && !g.items.includes(item)) g.items.push(item);
                    else if (act === 'remove-from-group') g.items = g.items.filter(x => x !== item);
                }
            });
        }
    }
    
    await PromptAPI.saveDB(STATE.localDB);
    window.pmHideModal('pm-batch-edit-modal');
    window.exitBatchMode();
    alert("批量操作已成功应用！");
};

window.PM_Global.ui.executeExport = async function() {
    const scope = document.getElementById("pm-export-scope").value;
    const includeImg = document.getElementById("pm-export-img-check").checked;
    
    // 唤起进度条，防止大文件打包时页面假死
    UI.updateProgress("正在准备导出...", "统计数据结构");

    let exportData = {
        type: "prompt_manager_export",
        scope: scope,
        models: { main_models: {} },
        contexts: {},
        images: {}
    };

    let targetCtxs = [];
    const currentModelId = STATE.currentModelId;
    const currentModeId = STATE.currentModeId;
    const modelData = STATE.localDB.models.main_models[currentModelId];

    if (scope === "all") {
        exportData.models = JSON.parse(JSON.stringify(STATE.localDB.models));
        exportData.settings = STATE.localDB.settings;
        targetCtxs = Object.keys(STATE.localDB.contexts || {}); 
    } else {
        exportData.settings = STATE.localDB.settings; 
        
        if (scope === "model") {
            exportData.models.main_models[currentModelId] = JSON.parse(JSON.stringify(modelData));
            Object.keys(modelData.modes).forEach(mId => targetCtxs.push(`${currentModelId}_${mId}`));
        } else if (scope === "category") {
            const catId = modelData.modes[currentModeId]?.group || 'custom';
            exportData.models.main_models[currentModelId] = JSON.parse(JSON.stringify(modelData));
            for (const mId in exportData.models.main_models[currentModelId].modes) {
                const m = exportData.models.main_models[currentModelId].modes[mId];
                if (m.group === catId || (!m.group && catId === 'custom')) {
                    targetCtxs.push(`${currentModelId}_${mId}`);
                } else {
                    delete exportData.models.main_models[currentModelId].modes[mId];
                }
            }
        } else if (scope === "mode") {
            exportData.models.main_models[currentModelId] = JSON.parse(JSON.stringify(modelData));
            for (const mId in exportData.models.main_models[currentModelId].modes) {
                if (mId === currentModeId) {
                    targetCtxs.push(`${currentModelId}_${mId}`);
                } else {
                    delete exportData.models.main_models[currentModelId].modes[mId];
                }
            }
        }
    }

    targetCtxs.forEach(ctx => {
        if (STATE.localDB.contexts[ctx]) {
            exportData.contexts[ctx] = JSON.parse(JSON.stringify(STATE.localDB.contexts[ctx]));
        }
    });

    // 核心修复：真实提取并转换图片数据
    if (includeImg) {
        let totalImgs = 0;
        let processedImgs = 0;

        // 预先计算图片总数以更新进度条
        targetCtxs.forEach(ctx => {
            if (STATE.localDB.contexts[ctx] && STATE.localDB.contexts[ctx].items) {
                STATE.localDB.contexts[ctx].items.forEach(item => {
                    const imgKey = `${ctx}_${item}`;
                    if (STATE.localDB.images[imgKey]) totalImgs += STATE.localDB.images[imgKey].length;
                });
            }
        });

        for (const ctx of targetCtxs) {
            if (STATE.localDB.contexts[ctx] && STATE.localDB.contexts[ctx].items) {
                for (const item of STATE.localDB.contexts[ctx].items) {
                    const imgKey = `${ctx}_${item}`;
                    if (STATE.localDB.images[imgKey] && STATE.localDB.images[imgKey].length > 0) {
                        exportData.images[imgKey] = [];
                        for (const url of STATE.localDB.images[imgKey]) {
                            try {
                                processedImgs++;
                                // 限制 UI 更新频率，避免过度消耗性能
                                if (processedImgs % 5 === 0 || processedImgs === totalImgs) {
                                    let pct = Math.round((processedImgs / totalImgs) * 100);
                                    UI.updateProgress("正在打包实体图片...", `处理进度: ${processedImgs} / ${totalImgs}`, pct);
                                }

                                if (url.startsWith('/prompt_data/')) {
                                    // 抓取本地图片并转换为 Base64
                                    const b64 = await UTILS.urlToBase64(url);
                                    exportData.images[imgKey].push(b64);
                                } else {
                                    exportData.images[imgKey].push(url);
                                }
                            } catch (err) {
                                console.warn(`图片打包失败 (路径: ${url})`, err);
                            }
                        }
                    }
                }
            }
        }
    }

    UI.updateProgress("正在生成文件...", "即将开始下载，请勿刷新页面");

    // 延迟 500ms 保证主线程不卡死，执行下载
    setTimeout(() => {
        try {
            const blob = new Blob([JSON.stringify(exportData)], {type: "application/json"});
            const url = URL.createObjectURL(blob); 
            const a = document.createElement('a'); 
            a.href = url; 
            const imgLabel = includeImg ? "Full" : "NoImg";
            a.download = `Prompt_Backup_${scope}_${imgLabel}_${Date.now()}.json`; 
            a.click(); 
            URL.revokeObjectURL(url);
            window.pmHideModal("pm-export-modal");
            UI.hideProgress();
        } catch(e) {
            UI.hideProgress();
            alert("导出失败！可能是图库极大（几百MB）触发了浏览器的单字符串内存限制。请尝试缩小导出范围（如按大类或小类导出）。");
        }
    }, 500);
};

// === 3. 大部分业务渲染逻辑 ===
function openNativeBrowser() {
    let container = document.getElementById("pm-native-modal");
    if (!document.getElementById("pm-native-style")) {
        const style = document.createElement("style");
        style.id = "pm-native-style";
        style.innerHTML = `
            #pm-native-modal { position: fixed; top: 8vh; left: 15vw; width: 70vw; height: 85vh; background: #1e1e1e; border: 1px solid rgba(255,107,157,0.5); border-radius: 16px; display: flex; flex-direction: column; z-index: 10000; box-shadow: 0 10px 50px rgba(0,0,0,0.8); color: #ccc; font-family: sans-serif; resize: both; overflow: hidden; min-width: 800px; min-height: 500px; }
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
            .pm-main.batch-active { user-select: none; -webkit-user-select: none; }
            
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
            .pm-drag-over-tab { border-bottom-color: #f44336 !important; background: rgba(244,67,54,0.2) !important; }
            .pm-drag-over-cat { border: 1px dashed #ff6b9d !important; background: rgba(255,107,157,0.05) !important; }
            .pm-drag-over-mode { border-top: 2px solid #ff6b9d !important; background: rgba(255,107,157,0.2) !important; transform: translateY(2px); }
        `;
        document.head.appendChild(style);

        const createModal = document.createElement("div"); createModal.className = "pm-modal-overlay"; createModal.id = "pm-create-modal";
        createModal.innerHTML = `
            <div class="pm-create-box">
                <div class="pm-create-header"><b style="color:#ff6b9d;">新建卡片</b><button class="pm-close-btn" onclick="pmHideModal('pm-create-modal')">关闭</button></div>
                <div class="pm-create-tabs">
                    <button class="pm-ct-btn active" id="ct-btn-img" onclick="switchCreateTab('img')">图片批量上传</button>
                    <button class="pm-ct-btn" id="ct-btn-txt" onclick="switchCreateTab('txt')">单文本创建</button>
                    <button class="pm-ct-btn" id="ct-btn-file" onclick="switchCreateTab('file')">TXT导入</button>
                </div>
                <div class="pm-create-content">
                    <div id="ct-content-img" style="display:block;">
                        <p style="color:#888; margin-bottom:15px;">选择多张图片以去后缀文件名自动创建卡片。</p>
                        <button class="pm-action-btn primary" style="width:100%; padding:12px;" onclick="document.getElementById('pm-hidden-create-img').click()">选择图片...</button>
                        <input type="file" id="pm-hidden-create-img" multiple accept="image/*" style="display:none;">
                    </div>
                    <div id="ct-content-txt" style="display:none;">
                        <input type="text" id="pm-create-single-input" class="pm-input-text" placeholder="输入 Prompt...">
                        <button class="pm-action-btn primary" style="width:100%; margin-top:20px; padding:12px;" onclick="createSinglePrompt()">确认创建</button>
                    </div>
                    <div id="ct-content-file" style="display:none;">
                        <p style="color:#888; margin-bottom:15px;">上传 .txt 自动按逗号分割批量创建。</p>
                        <button class="pm-action-btn primary" style="width:100%; padding:12px;" onclick="document.getElementById('pm-hidden-create-txt').click()">选择 TXT...</button>
                        <input type="file" id="pm-hidden-create-txt" accept=".txt" style="display:none;">
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(createModal);

        const importModal = document.createElement("div"); importModal.className = "pm-modal-overlay"; importModal.id = "pm-import-modal"; importModal.style.zIndex = "20002";
        importModal.innerHTML = `
            <div class="pm-create-box" style="width: 550px;">
                <div class="pm-create-header"><b style="color:#ff6b9d;">数据导入</b><button class="pm-close-btn" onclick="pmHideModal('pm-import-modal')">关闭</button></div>
                <div class="pm-create-content" style="padding: 20px;">
                    <div style="background: rgba(255,107,157,0.1); padding:10px; border-radius:8px; margin-bottom:15px; border: 1px dashed rgba(255,107,157,0.3);">
                        <span style="font-weight:bold; color:#ff6b9d; display:block; margin-bottom:5px;">包含分类数: <span id="pm-import-ctx-count"></span></span>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:10px; margin-bottom: 20px;">
                        <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; background: #1a1a1a; padding: 10px; border-radius: 8px; border: 1px solid #333;"><input type="radio" name="pm-import-target" value="current_tab" checked><div><div style="color:#ff6b9d;font-weight:bold;">导入当前一级分类大标签</div></div></label>
                        <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; background: #1a1a1a; padding: 10px; border-radius: 8px; border: 1px solid #333;"><input type="radio" name="pm-import-target" value="current_mode"><div><div style="color:#ccc;font-weight:bold;">强行合并到当前三级分类</div></div></label>
                        <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; background: #1a1a1a; padding: 10px; border-radius: 8px; border: 1px solid #333;"><input type="radio" name="pm-import-target" value="original"><div><div style="color:#ccc;font-weight:bold;">原路严格恢复</div></div></label>
                    </div>
                    <div style="border-top:1px dashed #444; padding-top:15px;">
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:bold; color:#ff6b9d;"><input type="checkbox" id="pm-import-merge-check" checked> 与目标位置的现有数据进行追加合并</label>
                    </div>
                    <button class="pm-action-btn primary" style="width:100%; padding:12px; margin-top:20px;" onclick="executeImportFinal()">开始导入</button>
                </div>
            </div>
        `;
        document.body.appendChild(importModal);

        const exportModal = document.createElement("div"); exportModal.className = "pm-modal-overlay"; exportModal.id = "pm-export-modal"; exportModal.style.zIndex = "20002";
        exportModal.innerHTML = `
            <div class="pm-create-box" style="width: 500px;">
                <div class="pm-create-header"><b style="color:#ff6b9d;">导出数据</b><button class="pm-close-btn" onclick="pmHideModal('pm-export-modal')">关闭</button></div>
                <div class="pm-create-content" style="padding: 20px;">
                    <label style="color:#ccc; font-weight:bold; margin-bottom:10px; display:block;">选择导出范围</label>
                    <select id="pm-export-scope" class="pm-scope-select" style="width:100%; margin-bottom:20px;">
                        <option value="all">导出全库 (所有一级分类)</option>
                        <option value="model">导出当前一级分类 (全部子类)</option>
                        <option value="category">导出当前二级分类</option>
                        <option value="mode">导出当前三级分类</option>
                    </select>
                    
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:bold; color:#ff6b9d;">
                        <input type="checkbox" id="pm-export-img-check" checked> 包含图片数据 (体积较大)
                    </label>
                    <p style="font-size:12px; color:#888; margin-top:10px; line-height:1.5;">* 如果取消勾选图片，将仅导出纯文本的属性、收藏夹分组、组合预设等配置信息。该选项极大地缩小了文件体积。</p>
                    
                    <button class="pm-action-btn primary" style="width:100%; padding:12px; margin-top:20px;" onclick="PM_Global.ui.executeExport()">生成并下载 JSON</button>
                </div>
            </div>
        `;
        document.body.appendChild(exportModal);

        const imgViewer = document.createElement("div"); imgViewer.id = "pm-image-viewer"; imgViewer.className = "pm-modal-overlay"; imgViewer.style.zIndex = "20005";
        imgViewer.innerHTML = `<img id="pm-viewer-img" src="">`; document.body.appendChild(imgViewer); imgViewer.onclick = () => window.pmHideModal("pm-image-viewer");

        const progressOverlay = document.createElement("div"); progressOverlay.id = "pm-progress-overlay"; progressOverlay.className = "pm-modal-overlay"; progressOverlay.style.zIndex = "20005";
        progressOverlay.innerHTML = `<div class="pm-progress-wrap"><h3 id="pm-progress-title" style="color:#ff6b9d; margin:0 0 15px 0;">处理中...</h3><div class="pm-progress-bar-container"><div id="pm-progress-fill"></div></div><div id="pm-progress-text" style="font-size:14px; color:#ccc; font-weight:bold;">0%</div></div>`;
        document.body.appendChild(progressOverlay);

        const editCardModal = document.createElement("div"); editCardModal.className = "pm-modal-overlay"; editCardModal.id = "pm-edit-card-modal"; editCardModal.style.zIndex = "20002";
        editCardModal.innerHTML = `
            <div class="pm-create-box" style="width: 450px;">
                <div class="pm-create-header"><b style="color:#ff6b9d;">编辑卡片</b><button class="pm-close-btn" onclick="pmHideModal('pm-edit-card-modal')">关闭</button></div>
                <div class="pm-create-content" style="padding: 20px;">
                    <label style="color:#ccc; font-weight:bold; margin-bottom:8px; display:block;">修改 Prompt</label>
                    <input type="text" id="pm-edit-card-input" class="pm-input-text" style="margin-top:0; margin-bottom: 15px;">
                    <label style="color:#ccc; font-weight:bold; margin-bottom:8px; display:block;">卡片标签 (逗号分隔)</label>
                    <input type="text" id="pm-edit-card-tags" class="pm-input-text" style="margin-top:0; margin-bottom: 25px;">
                    <button class="pm-action-btn primary" style="width:100%; padding:12px;" onclick="executeEditCard()">保存修改</button>
                </div>
            </div>
        `;
        document.body.appendChild(editCardModal);

        const batchEditModal = document.createElement("div"); batchEditModal.className = "pm-modal-overlay"; batchEditModal.id = "pm-batch-edit-modal"; batchEditModal.style.zIndex = "20002";
        batchEditModal.innerHTML = `
            <div class="pm-create-box" style="width: 450px;">
                <div class="pm-create-header"><b style="color:#ff6b9d;">批量编辑</b><button class="pm-close-btn" onclick="pmHideModal('pm-batch-edit-modal')">关闭</button></div>
                <div class="pm-create-content" style="padding: 20px;">
                    <select id="pm-batch-action-select" class="pm-scope-select" style="width:100%; margin-bottom:15px;" onchange="PM_Global.ui.onBatchActionChange(this.value)">
                        <option value="add-tags">批量添加标签</option>
                        <option value="remove-tags">批量移除标签</option>
                        <option value="add-to-group">批量加入收藏分组</option>
                        <option value="remove-from-group">批量移出收藏分组</option>
                    </select>
                    <div id="pm-batch-tag-div">
                        <input type="text" id="pm-batch-tag-input" class="pm-search-input" style="width:100%; margin-bottom:15px;" placeholder="输入标签，用逗号分隔">
                    </div>
                    <div id="pm-batch-group-div" style="display:none; margin-bottom:15px;">
                        <select id="pm-batch-group-select" class="pm-scope-select" style="width:100%;"></select>
                    </div>
                    <p style="font-size:12px; color:#888; margin-bottom:20px;">将影响当前选中的 <span id="pm-batch-affect-count" style="color:#ff6b9d; font-weight:bold;">0</span> 个项目。</p>
                    <button class="pm-action-btn primary" style="width:100%; padding:12px; font-size:14px;" onclick="PM_Global.ui.executeBatchEdit()">确认执行</button>
                </div>
            </div>
        `;
        document.body.appendChild(batchEditModal);

        window.openEditCardModal = function(item, ctx) {
            STATE.currentEditCardTarget = { item, ctx };
            document.getElementById("pm-edit-card-input").value = item;
            const tags = STATE.localDB.contexts[ctx]?.metadata?.[item]?.tags || [];
            document.getElementById("pm-edit-card-tags").value = tags.join(", ");
            window.pmShowModal("pm-edit-card-modal");
        };
    }

    if (!container) {
        container = document.createElement("div"); container.id = "pm-native-modal";
        let initCompRate = STATE.localDB.settings?.compress_rate ?? 0.85;
        let initCompPct = Math.round(initCompRate * 100);
        let initMaxWidth = STATE.localDB.settings?.max_width ?? 900;

        container.innerHTML = `
            <div class="pm-header" id="pm-header"><span style="font-weight: bold; font-size: 15px; color:#fff;">Prompt 浏览器</span><button class="pm-close-btn" id="pm-close-btn">关闭界面 (ESC)</button></div>
            <div class="pm-tabs" id="pm-tabs"></div>
            <div class="pm-body">
                <div class="pm-sidebar" id="pm-sidebar">
                    <div class="pm-sidebar-scroll" id="pm-sidebar-scroll"></div>
                    <div class="pm-sidebar-footer">
                        <div class="pm-sidebar-group">
                            <div class="pm-sidebar-label">工作区与操作</div>
                            <div class="pm-btn-row">
                                <button class="pm-action-btn" style="flex:1; color:#f8961e; border-color:#835213;" onclick="PM_Global.ui.openGroupsModal()">收藏管理</button>
                                <button class="pm-action-btn" style="flex:1; color:#a78bfa; border-color:#534383;" onclick="PM_Global.ui.openCombosModal()">组合管理</button>
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
                            <div style="margin-top:15px; padding-top:15px; border-top: 1px dashed rgba(255,107,157,0.3);">
                                <div class="pm-sidebar-label" style="display:flex; justify-content:space-between; margin-bottom:5px;">图片压缩率 <span id="pm-comp-val" style="color:#ff6b9d;">${initCompPct}%</span></div>
                                <input type="range" id="pm-comp-slider" min="10" max="100" value="${initCompPct}" style="width:100%; cursor:pointer;">
                                <div class="pm-sidebar-label" style="display:flex; justify-content:space-between; margin-top:10px; margin-bottom:5px;">最大宽度 <input type="number" id="pm-width-input" value="${initMaxWidth}" min="100" max="4096" style="width:55px; background:#111; border:1px solid #444; color:#ff6b9d; border-radius:4px; text-align:center;"> px</div>
                                <input type="range" id="pm-width-slider" min="100" max="4096" step="10" value="${initMaxWidth}" style="width:100%; cursor:pointer;">
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
                            <option value="mode">搜索: 当前三级分类</option><option value="category">搜索: 当前二级分类</option><option value="model">搜索: 当前一级分类</option>
                        </select>
                        <select class="pm-scope-select" id="pm-sort-select">
                            <option value="name_asc">排序: 名称升序</option>
                            <option value="name_desc">排序: 名称降序</option>
                            <option value="img_first">排序: 有图优先</option>
                            <option value="img_last">排序: 无图优先</option>
                        </select>
                        <div class="pm-toolbar-right"><span style="font-size:12px; color:#aaa;">尺寸调节</span><input type="range" class="pm-zoom-slider" id="pm-zoom-slider" min="140" max="300" value="180"></div>
                    </div>
                    <div class="pm-main" id="pm-main"><div id="pm-marquee"></div></div>
                    <div class="pm-batch-bar" id="pm-batch-bar">
                        <span style="font-size:14px; color:#ff6b9d; font-weight:bold;" id="pm-batch-count">已选择: 0</span>
                        <div style="display:flex; gap:10px;">
                            <button class="pm-action-btn" style="color:#fff; border-color:#ff6b9d;" onclick="toggleSelectAll()">全选/反选</button>
                            <button class="pm-action-btn" style="color:#a78bfa; border-color:#534383;" onclick="PM_Global.ui.openBatchEditModal()">批量编辑</button>
                            <button class="pm-action-btn" style="color:#f44336; border-color:#552222;" onclick="executeBatchDelete()">彻底删除选中项</button>
                            <button class="pm-action-btn" onclick="exitBatchMode()">退出批量 (ESC)</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        document.getElementById("pm-comp-slider").onchange = async (e) => {
            if (!STATE.localDB.settings) STATE.localDB.settings = {};
            STATE.localDB.settings.compress_rate = parseInt(e.target.value) / 100;
            await PromptAPI.saveDB(STATE.localDB); UTILS.syncImportNodeWidgets();
        };
        document.getElementById("pm-comp-slider").oninput = (e) => document.getElementById("pm-comp-val").innerText = e.target.value + "%";

        const updateWidth = async (val) => {
            let num = parseInt(val); if(isNaN(num) || num<100) num=100; if(num>4096) num=4096;
            document.getElementById("pm-width-slider").value = num; document.getElementById("pm-width-input").value = num;
            if (!STATE.localDB.settings) STATE.localDB.settings = {}; STATE.localDB.settings.max_width = num;
            await PromptAPI.saveDB(STATE.localDB); UTILS.syncImportNodeWidgets();
        };
        document.getElementById("pm-width-slider").onchange = (e) => updateWidth(e.target.value);
        document.getElementById("pm-width-slider").oninput = (e) => document.getElementById("pm-width-input").value = e.target.value;
        document.getElementById("pm-width-input").onchange = (e) => updateWidth(e.target.value);

        document.getElementById("pm-close-btn").onclick = closeNativeBrowser;
        
        let isDraggingWin = false, offsetX = 0, offsetY = 0;
        document.getElementById("pm-header").addEventListener("mousedown", (e) => {
            if (e.target.tagName.toLowerCase() === 'button') return;
            isDraggingWin = true; offsetX = e.clientX - container.offsetLeft; offsetY = e.clientY - container.offsetTop;
        });
        window.addEventListener("mousemove", (e) => { if (isDraggingWin) { container.style.left = (e.clientX - offsetX) + "px"; container.style.top = (e.clientY - offsetY) + "px"; } });
        window.addEventListener("mouseup", () => isDraggingWin = false);

        let searchTimeout;
        document.getElementById("pm-search-input").oninput = (e) => { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => { STATE.searchQuery = e.target.value.toLowerCase().trim(); renderGrid(); }, 300); };
        document.getElementById("pm-search-scope").onchange = (e) => { STATE.searchScope = e.target.value; renderGrid(); };
        document.getElementById("pm-sort-select").onchange = (e) => { STATE.sortMode = e.target.value; renderGrid(); };
        document.getElementById("pm-zoom-slider").oninput = () => renderGrid();

        document.getElementById("pm-btn-batch").onclick = () => { 
            STATE.isBatchMode = true; 
            STATE.batchSelection.clear(); 
            document.getElementById("pm-batch-bar").classList.add("active"); 
            document.getElementById("pm-main").classList.add("batch-active");
            renderGrid(); 
        };
        document.getElementById("pm-btn-export").onclick = () => {
            window.pmShowModal("pm-export-modal");
        };
        document.getElementById("pm-btn-import").onclick = () => document.getElementById("pm-hidden-import").click();
        document.getElementById("pm-hidden-import").onchange = (e) => { if (e.target.files.length > 0) handleImportFile(e.target.files[0]); e.target.value = ''; };
        
        document.getElementById("pm-btn-add-card").onclick = () => {
            if (!STATE.currentModelId || !STATE.currentModeId) return alert("请先选择三级分类！");
            window.pmShowModal("pm-create-modal");
        };
        document.getElementById("pm-hidden-create-img").onchange = async (e) => { if (e.target.files.length > 0) await handleBatchCreateImages(e.target.files); e.target.value = ''; };
        document.getElementById("pm-hidden-create-txt").onchange = async (e) => { if (e.target.files.length > 0) await handleCreateTXT(e.target.files[0]); e.target.value = ''; };
        document.getElementById("pm-hidden-append-img").onchange = async (e) => {
            if (e.target.files.length === 0 || !STATE.currentAppendTarget) return;
            await executeAppendImages(e.target.files, STATE.currentAppendTarget.item, STATE.currentAppendTarget.ctx); e.target.value = ''; 
        };

        setupMarquee(); setupShortcuts();

    } else { container.style.display = "flex"; window.exitBatchMode(); }
    renderModelTabs();
}

window.exitBatchMode = function() {
    STATE.isBatchMode = false; STATE.batchSelection.clear();
    const bb = document.getElementById("pm-batch-bar"); if (bb) bb.classList.remove("active");
    const main = document.getElementById("pm-main"); if (main) main.classList.remove("batch-active");
    renderGrid();
};

window.toggleSelectAll = function() {
    const main = document.getElementById("pm-main");
    const cards = main.querySelectorAll(".pm-selectable-card");
    if (cards.length === 0) return;
    let visibleSelected = 0;
    cards.forEach(c => { if (STATE.batchSelection.has(`${c.dataset.ctx}||${c.dataset.item}`)) visibleSelected++; });
    if (visibleSelected === cards.length) cards.forEach(c => STATE.batchSelection.delete(`${c.dataset.ctx}||${c.dataset.item}`));
    else cards.forEach(c => STATE.batchSelection.add(`${c.dataset.ctx}||${c.dataset.item}`));
    document.getElementById("pm-batch-count").innerText = `已选择: ${STATE.batchSelection.size}`; renderGrid();
};

window.executeBatchDelete = async function() {
    if (STATE.batchSelection.size === 0) return;
    if (!confirm(`彻底删除 ${STATE.batchSelection.size} 个项目及其硬盘图片？`)) return;
    UI.updateProgress("正在删除...", "清理数据");
    try {
        for (const batchKey of STATE.batchSelection) {
            const [ctx, item] = batchKey.split('||');
            if (!STATE.localDB.contexts[ctx]) continue;
            STATE.localDB.contexts[ctx].items = STATE.localDB.contexts[ctx].items.filter(i => i !== item);
            if (STATE.localDB.contexts[ctx].metadata) delete STATE.localDB.contexts[ctx].metadata[item];
            if (STATE.localDB.contexts[ctx].groups) STATE.localDB.contexts[ctx].groups.forEach(g => g.items = g.items.filter(x => x !== item));
            const imgKey = `${ctx}_${item}`;
            if (STATE.localDB.images[imgKey]) { for (const url of STATE.localDB.images[imgKey]) await PromptAPI.deleteFile(url); delete STATE.localDB.images[imgKey]; }
        }
        await PromptAPI.saveDB(STATE.localDB); STATE.batchSelection.clear(); document.getElementById("pm-batch-count").innerText = `已选择: 0`;
    } catch (e) { alert("删除异常！"); } finally { UI.hideProgress(); renderGrid(); }
};

function closeNativeBrowser() { document.getElementById("pm-native-modal").style.display = "none"; UTILS.syncImportNodeWidgets(); }

function setupShortcuts() {
    document.addEventListener("keydown", (e) => {
        const modal = document.getElementById("pm-native-modal");
        if (!modal || modal.style.display === "none") return;
        if (e.target.tagName === 'INPUT' && e.key !== 'Escape') return;

        if (e.key === "Escape") {
            if (STATE.activeModals && STATE.activeModals.length > 0) {
                const topModal = STATE.activeModals.pop(); document.getElementById(topModal).style.display = 'none'; e.stopPropagation();
            } else if (STATE.isBatchMode) { window.exitBatchMode(); e.stopPropagation(); } else { closeNativeBrowser(); e.stopPropagation(); }
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
            e.preventDefault(); e.stopPropagation(); const searchInput = document.getElementById("pm-search-input"); if (searchInput) searchInput.focus();
        }
    }, true);
}

function renderModelTabs() {
    const tabsContainer = document.getElementById("pm-tabs"); tabsContainer.innerHTML = '';
    
    // === 新增安全校验：彻底防止空数据导致的崩溃 ===
    if (!STATE.localDB) STATE.localDB = {};
    if (!STATE.localDB.models) STATE.localDB.models = { main_models: {} };
    if (!STATE.localDB.models.main_models) STATE.localDB.models.main_models = {};
    if (!STATE.localDB.contexts) STATE.localDB.contexts = {};
    if (!STATE.localDB.images) STATE.localDB.images = {};
    // ===========================================

    const models = STATE.localDB.models.main_models;
    if (Object.keys(models).length === 0) {
        tabsContainer.innerHTML = '<span style="color:#666; padding:12px; font-size:12px;">没有任何一级分类</span>';
    } else {
        if (!STATE.currentModelId || !models[STATE.currentModelId]) STATE.currentModelId = Object.keys(models)[0];
        for (const [mId, mData] of Object.entries(models)) {
            const wrap = document.createElement("div"); wrap.className = `pm-tab-wrap ${mId === STATE.currentModelId ? 'active' : ''}`;
            wrap.draggable = true;
            wrap.ondragstart = (e) => { e.dataTransfer.setData("text/plain", "model_"+mId); e.stopPropagation(); };
            wrap.ondragover = (e) => { e.preventDefault(); wrap.classList.add('pm-drag-over-tab'); };
            wrap.ondragleave = () => { wrap.classList.remove('pm-drag-over-tab'); };
            wrap.ondrop = async (e) => {
                e.preventDefault(); e.stopPropagation(); wrap.classList.remove('pm-drag-over-tab');
                const type_id = e.dataTransfer.getData("text/plain");
                if (type_id.startsWith("model_")) {
                    const srcId = type_id.replace("model_", "");
                    STATE.localDB.models.main_models = UTILS.reorderObjectKeys(STATE.localDB.models.main_models, srcId, mId);
                    await PromptAPI.saveDB(STATE.localDB); renderModelTabs(); UTILS.syncImportNodeWidgets();
                }
            };

            const btn = document.createElement("button"); btn.className = "pm-tab-btn"; btn.innerText = mData.name || mId;
            btn.onclick = () => { STATE.currentModelId = mId; STATE.currentModeId = null; renderModelTabs(); };
            
            const ctrlGroup = document.createElement("div"); ctrlGroup.className = "pm-ctrl-group";
            const editBtn = document.createElement("button"); editBtn.className = "pm-ctrl-btn"; editBtn.innerText = "设置"; editBtn.onclick = (e) => { e.stopPropagation(); editModel(mId); };
            const delBtn = document.createElement("button"); delBtn.className = "pm-ctrl-btn del"; delBtn.innerText = "删除"; delBtn.onclick = (e) => { e.stopPropagation(); deleteModel(mId); };
            ctrlGroup.appendChild(editBtn); ctrlGroup.appendChild(delBtn);
            wrap.appendChild(btn); wrap.appendChild(ctrlGroup); tabsContainer.appendChild(wrap);
        }
    }
    const addBtn = document.createElement("button"); addBtn.className = "pm-ctrl-btn"; addBtn.style.display = "block"; addBtn.style.marginLeft = "10px"; addBtn.innerText = "新建一级分类";
    addBtn.onclick = () => addModel(); tabsContainer.appendChild(addBtn);
    renderSidebar();
}

function renderSidebar() {
    const scrollArea = document.getElementById("pm-sidebar-scroll"); scrollArea.innerHTML = '';
    const main = document.getElementById("pm-main"); main.innerHTML = '<div style="color:#555; padding:20px;">请选择三级分类...</div>';

    const models = STATE.localDB.models.main_models;
    if (!STATE.currentModelId || !models[STATE.currentModelId]) return;
    const currentModel = models[STATE.currentModelId];
    if (!currentModel.categories || currentModel.categories.length === 0) currentModel.categories = [{ id: 'custom', name: '默认二级分类' }];
    if (!currentModel.modes) currentModel.modes = {};

    let firstModeId = null;

    currentModel.categories.forEach(cat => {
        const catWrap = document.createElement("div"); catWrap.className = "pm-cat-wrap";
        catWrap.draggable = true;
        catWrap.ondragstart = (e) => { e.dataTransfer.setData("text/plain", "cat_"+cat.id); e.stopPropagation(); };
        catWrap.ondragover = (e) => { e.preventDefault(); catWrap.classList.add('pm-drag-over-cat'); };
        catWrap.ondragleave = () => { catWrap.classList.remove('pm-drag-over-cat'); };
        catWrap.ondrop = async (e) => {
            e.preventDefault(); e.stopPropagation(); catWrap.classList.remove('pm-drag-over-cat');
            const type_id = e.dataTransfer.getData("text/plain");
            if (type_id.startsWith("cat_")) {
                const srcId = type_id.replace("cat_", "");
                if (srcId !== cat.id) {
                    const cats = currentModel.categories; const srcIdx = cats.findIndex(c => c.id === srcId), tgtIdx = cats.findIndex(c => c.id === cat.id);
                    if(srcIdx > -1 && tgtIdx > -1) { const [moved] = cats.splice(srcIdx, 1); cats.splice(tgtIdx, 0, moved); await PromptAPI.saveDB(STATE.localDB); renderSidebar(); UTILS.syncImportNodeWidgets(); }
                }
            } else if (type_id.startsWith("mode_")) {
                const srcModeId = type_id.replace("mode_", ""); currentModel.modes[srcModeId].group = cat.id; await PromptAPI.saveDB(STATE.localDB); renderSidebar(); UTILS.syncImportNodeWidgets();
            }
        };

        const catHeader = document.createElement("div"); catHeader.className = "pm-cat-header";
        const isCollapsed = STATE.collapsedCategories.has(cat.id);
        const arrowSpan = document.createElement("span");
        arrowSpan.innerHTML = "▼"; arrowSpan.style.cssText = `cursor: pointer; display: inline-block; transition: 0.2s; transform: ${isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'}; color: #ff6b9d; margin-right: 6px; font-size: 10px;`;
        arrowSpan.onclick = (e) => { e.stopPropagation(); if (isCollapsed) STATE.collapsedCategories.delete(cat.id); else STATE.collapsedCategories.add(cat.id); renderSidebar(); };

        const titleSpan = document.createElement("span"); titleSpan.className = "pm-cat-title"; titleSpan.innerText = cat.name;
        const titleGroup = document.createElement("div"); titleGroup.style.display = "flex"; titleGroup.appendChild(arrowSpan); titleGroup.appendChild(titleSpan);
        
        const ctrlDiv = document.createElement("div"); ctrlDiv.className = "pm-ctrl-group";
        const editCat = document.createElement("button"); editCat.className = "pm-ctrl-btn"; editCat.innerText = "设置"; editCat.onclick = () => editCategory(cat.id);
        const delCat = document.createElement("button"); delCat.className = "pm-ctrl-btn del"; delCat.innerText = "删除"; delCat.onclick = () => deleteCategory(cat.id);
        ctrlDiv.appendChild(editCat); ctrlDiv.appendChild(delCat);
        catHeader.appendChild(titleGroup); catHeader.appendChild(ctrlDiv); catWrap.appendChild(catHeader);

        const modeContainer = document.createElement("div"); if (isCollapsed) modeContainer.style.display = "none";
        Object.entries(currentModel.modes).filter(([id, m]) => m.group === cat.id || (!m.group && cat.id === 'custom')).forEach(([modId, modData]) => {
            if (!firstModeId) firstModeId = modId;
            const mWrap = document.createElement("div"); mWrap.className = `pm-mode-wrap ${modId === STATE.currentModeId ? 'active' : ''}`;
            mWrap.draggable = true;
            mWrap.ondragstart = (e) => { e.dataTransfer.setData("text/plain", "mode_"+modId); e.stopPropagation(); };
            mWrap.ondragover = (e) => { e.preventDefault(); mWrap.classList.add('pm-drag-over-mode'); };
            mWrap.ondragleave = () => { mWrap.classList.remove('pm-drag-over-mode'); };
            mWrap.ondrop = async (e) => {
                e.preventDefault(); e.stopPropagation(); mWrap.classList.remove('pm-drag-over-mode');
                const type_id = e.dataTransfer.getData("text/plain");
                if (type_id.startsWith("mode_")) {
                    const srcModeId = type_id.replace("mode_", "");
                    if (srcModeId !== modId) {
                        currentModel.modes[srcModeId].group = cat.id; currentModel.modes = UTILS.reorderObjectKeys(currentModel.modes, srcModeId, modId);
                        await PromptAPI.saveDB(STATE.localDB); renderSidebar(); UTILS.syncImportNodeWidgets();
                    }
                }
            };

            const btn = document.createElement("button"); btn.className = "pm-mode-btn"; btn.innerText = modData.name || modId;
            btn.onclick = () => { STATE.currentModeId = modId; window.exitBatchMode(); renderSidebar(); };

            const mCtrl = document.createElement("div"); mCtrl.className = "pm-ctrl-group";
            const mEdit = document.createElement("button"); mEdit.className = "pm-ctrl-btn"; mEdit.innerText = "设置"; mEdit.onclick = () => editMode(modId);
            const mDel = document.createElement("button"); mDel.className = "pm-ctrl-btn del"; mDel.innerText = "删除"; mDel.onclick = () => deleteMode(modId);
            mCtrl.appendChild(mEdit); mCtrl.appendChild(mDel);
            mWrap.appendChild(btn); mWrap.appendChild(mCtrl); modeContainer.appendChild(mWrap);
        });

        const addModeBtn = document.createElement("div"); addModeBtn.className = "pm-add-btn"; addModeBtn.innerText = "新建三级分类"; addModeBtn.onclick = () => addMode(cat.id);
        modeContainer.appendChild(addModeBtn); catWrap.appendChild(modeContainer);
        const divider = document.createElement("div"); divider.className = "pm-divider"; catWrap.appendChild(divider);
        scrollArea.appendChild(catWrap);
    });

    const addCatBtn = document.createElement("div"); addCatBtn.className = "pm-add-btn"; addCatBtn.style.borderStyle = "solid"; addCatBtn.innerText = "新建二级分类";
    addCatBtn.onclick = () => addCategory(); scrollArea.appendChild(addCatBtn);

    if (!STATE.currentModeId && firstModeId) STATE.currentModeId = firstModeId;
    if (STATE.currentModeId) renderGrid();
}

function renderGrid() {
    const main = document.getElementById("pm-main");
    main.innerHTML = '<div id="pm-marquee"></div>';
    const zoomSize = document.getElementById("pm-zoom-slider") ? document.getElementById("pm-zoom-slider").value : 180;
    main.style.gridTemplateColumns = `repeat(auto-fill, minmax(${zoomSize}px, 1fr))`;

    let targetCtxs = [];
    if (STATE.currentModelId && STATE.currentModeId) {
        const model = STATE.localDB.models.main_models[STATE.currentModelId];
        if (STATE.searchScope === "mode") targetCtxs.push(`${STATE.currentModelId}_${STATE.currentModeId}`);
        else if (STATE.searchScope === "category") {
            const currentCatId = model.modes[STATE.currentModeId]?.group || 'custom';
            Object.entries(model.modes).forEach(([mId, m]) => { if (m.group === currentCatId || (!m.group && currentCatId === 'custom')) targetCtxs.push(`${STATE.currentModelId}_${mId}`); });
        } else if (STATE.searchScope === "model") Object.keys(model.modes).forEach(mId => targetCtxs.push(`${STATE.currentModelId}_${mId}`));
    }

    let allItems = [];
    targetCtxs.forEach(ctx => {
        const ctxData = STATE.localDB.contexts?.[ctx];
        if (ctxData && ctxData.items) {
            ctxData.items.forEach(item => {
                if (STATE.searchQuery) {
                    const lowItem = item.toLowerCase(); const tagsStr = (ctxData.metadata?.[item]?.tags || []).join(" ").toLowerCase();
                    if (!lowItem.includes(STATE.searchQuery) && !tagsStr.includes(STATE.searchQuery)) return; 
                }
                allItems.push({ item, ctx });
            });
        }
    });

    if (allItems.length === 0) return main.innerHTML += '<div style="color:#555; grid-column: 1 / -1; margin-top:10px;">空空如也。</div>';

    const sortMode = STATE.sortMode || "name_asc";
    allItems.sort((a, b) => {
        if (sortMode === "name_asc") {
            return a.item.localeCompare(b.item, 'zh-CN');
        } else if (sortMode === "name_desc") {
            return b.item.localeCompare(a.item, 'zh-CN');
        } else if (sortMode === "img_first" || sortMode === "img_last") {
            const aHasImg = (STATE.localDB.images[`${a.ctx}_${a.item}`]?.length > 0) ? 1 : 0;
            const bHasImg = (STATE.localDB.images[`${b.ctx}_${b.item}`]?.length > 0) ? 1 : 0;
            if (aHasImg !== bHasImg) {
                return sortMode === "img_first" ? bHasImg - aHasImg : aHasImg - bHasImg;
            }
            return a.item.localeCompare(b.item, 'zh-CN');
        }
        return 0;
    });

    let activePrompts = [];
    if (STATE.currentActiveWidget && STATE.currentActiveWidget.value) activePrompts = UTILS.parsePromptText(STATE.currentActiveWidget.value).map(p => p.tag);

    allItems.forEach(({ item, ctx }) => {
        const imgKey = `${ctx}_${item}`; const imgList = STATE.localDB.images?.[imgKey] || [];
        const isSelectedInBatch = STATE.batchSelection.has(`${ctx}||${item}`);
        const isInWidget = activePrompts.includes(item);

        const card = document.createElement("div"); card.className = "pm-card pm-selectable-card"; card.dataset.ctx = ctx; card.dataset.item = item;
        if (STATE.isBatchMode && isSelectedInBatch) card.classList.add("batch-selected");
        else if (!STATE.isBatchMode && isInWidget) card.classList.add("in-prompt");

        const imgWrap = document.createElement("div"); imgWrap.className = "pm-card-img-wrap";
        let currentImgIndex = 0;

        if (imgList.length > 0) {
            const imgEl = document.createElement("img"); imgEl.src = imgList[0]; imgEl.style.cursor = "pointer";
            imgEl.onclick = (e) => { if (STATE.isBatchMode) return; e.stopPropagation(); document.getElementById('pm-viewer-img').src = imgList[currentImgIndex]; window.pmShowModal("pm-image-viewer"); };
            imgWrap.appendChild(imgEl);
            
            const delImgBtn = document.createElement("button"); delImgBtn.className = "pm-del-img-btn"; delImgBtn.innerHTML = "×";
            delImgBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm("仅彻底删除当前显示的这张图片？")) {
                    await PromptAPI.deleteFile(imgList[currentImgIndex]); imgList.splice(currentImgIndex, 1);
                    STATE.localDB.images[imgKey] = imgList; await PromptAPI.saveDB(STATE.localDB); renderGrid();
                }
            };
            imgWrap.appendChild(delImgBtn);

            if (imgList.length > 1) {
                const leftArrow = document.createElement("button"); leftArrow.className = "pm-nav-arrow left"; leftArrow.innerText = "◀";
                const rightArrow = document.createElement("button"); rightArrow.className = "pm-nav-arrow right"; rightArrow.innerText = "▶";
                leftArrow.onclick = (e) => { e.stopPropagation(); currentImgIndex = (currentImgIndex - 1 + imgList.length) % imgList.length; imgEl.src = imgList[currentImgIndex]; };
                rightArrow.onclick = (e) => { e.stopPropagation(); currentImgIndex = (currentImgIndex + 1) % imgList.length; imgEl.src = imgList[currentImgIndex]; };
                imgWrap.appendChild(leftArrow); imgWrap.appendChild(rightArrow);
            }
        } else imgWrap.innerHTML = `<div class="pm-no-img">无图 (点传图上传)</div>`;

        const titleDiv = document.createElement("div"); titleDiv.className = "pm-card-title"; titleDiv.innerText = item;
        card.appendChild(imgWrap); card.appendChild(titleDiv);

        if (STATE.searchScope !== "mode") {
            const prefix = STATE.currentModelId + "_";
            const modId = ctx.startsWith(prefix) ? ctx.substring(prefix.length) : ctx.split('_').slice(1).join('_');
            const mName = STATE.localDB.models.main_models[STATE.currentModelId]?.modes[modId]?.name || modId;
            const sourceDiv = document.createElement("div"); sourceDiv.className = "pm-card-source"; sourceDiv.innerText = `[${mName}]`; card.appendChild(sourceDiv);
        }

        const tagsWrap = document.createElement("div"); tagsWrap.className = "pm-card-tags";
        const tags = STATE.localDB.contexts[ctx]?.metadata?.[item]?.tags || [];
        if (tags.length === 0) tagsWrap.innerHTML = '<span style="color:#555; font-style:italic;">暂无标签</span>';
        else tags.forEach(t => { const s = document.createElement("span"); s.className = "pm-tag"; s.innerText = t; tagsWrap.appendChild(s); });
        card.appendChild(tagsWrap);

        const actionsWrap = document.createElement("div"); actionsWrap.className = "pm-card-actions";
        const inGrp = STATE.localDB.contexts[ctx]?.groups?.some(g => g.items.includes(item));
        const favBtn = document.createElement("button"); favBtn.className = `pm-text-btn ${inGrp ? 'warning' : ''}`; favBtn.innerText = inGrp ? "已收藏" : "收藏";
        favBtn.onclick = (e) => { e.stopPropagation(); window.PM_Global.ui.openGroupSelectModal(item, ctx); }; actionsWrap.appendChild(favBtn);

        const appendBtn = document.createElement("button"); appendBtn.className = "pm-text-btn"; appendBtn.innerText = "上传";
        appendBtn.onclick = (e) => { e.stopPropagation(); STATE.currentAppendTarget = { item, ctx }; document.getElementById("pm-hidden-append-img").click(); }; actionsWrap.appendChild(appendBtn);

        const editBtn = document.createElement("button"); editBtn.className = "pm-text-btn"; editBtn.innerText = "编辑";
        editBtn.onclick = (e) => { e.stopPropagation(); window.openEditCardModal(item, ctx); }; actionsWrap.appendChild(editBtn);

        const delCardBtn = document.createElement("button"); delCardBtn.className = "pm-text-btn danger"; delCardBtn.innerText = "删除";
        delCardBtn.onclick = async (e) => { e.stopPropagation(); if (confirm(`彻底删除 [ ${item} ]？`)) await deleteCardDirect(item, ctx); }; actionsWrap.appendChild(delCardBtn);

        card.appendChild(actionsWrap);
        card.onclick = () => {
            if (STATE.isBatchMode) {
                if (window._isDraggingMarquee) return;
                const batchKey = `${ctx}||${item}`;
                if (STATE.batchSelection.has(batchKey)) STATE.batchSelection.delete(batchKey); else STATE.batchSelection.add(batchKey);
                document.getElementById("pm-batch-count").innerText = `已选择: ${STATE.batchSelection.size}`; renderGrid();
            } else {
                if (!STATE.currentActiveWidget) return;
                let p = UTILS.parsePromptText(STATE.currentActiveWidget.value);
                const idx = p.findIndex(x => x.tag === item);
                if (idx !== -1) p.splice(idx, 1); else p.push({ original: item, tag: item, weight: 1.0, enabled: true });
                STATE.currentActiveWidget.value = UTILS.buildPromptText(p); app.graph.setDirtyCanvas(true); renderGrid();
            }
        };
        main.appendChild(card);
    });
}

// === 4. 数据操作与逻辑 ===
async function deleteCardDirect(item, ctx) {
    UI.updateProgress("删除中...", "清理数据与物理文件");
    try {
        if (STATE.localDB.contexts[ctx]) {
            STATE.localDB.contexts[ctx].items = STATE.localDB.contexts[ctx].items.filter(i => i !== item);
            if (STATE.localDB.contexts[ctx].metadata) delete STATE.localDB.contexts[ctx].metadata[item];
            if (STATE.localDB.contexts[ctx].groups) STATE.localDB.contexts[ctx].groups.forEach(g => g.items = g.items.filter(x => x !== item));
        }
        const imgKey = `${ctx}_${item}`;
        if (STATE.localDB.images[imgKey]) { for (const url of STATE.localDB.images[imgKey]) await PromptAPI.deleteFile(url); delete STATE.localDB.images[imgKey]; }
        await PromptAPI.saveDB(STATE.localDB);
    } catch (e) { alert("删除异常！"); } finally { UI.hideProgress(); renderGrid(); }
}

async function handleBatchCreateImages(files) {
    const ctx = `${STATE.currentModelId}_${STATE.currentModeId}`;
    if (!STATE.localDB.contexts[ctx]) STATE.localDB.contexts[ctx] = { items: [], metadata: {} };
    for (let i = 0; i < files.length; i++) {
        if (!files[i].type.match('image.*')) continue;
        let promptName = files[i].name.replace(/\.[^/.]+$/, "").trim(); try { promptName = decodeURIComponent(promptName); } catch(e) {}
        if (!promptName) continue;
        let pct = Math.round(((i + 1) / files.length) * 100); UI.updateProgress("批量上传...", `处理中: ${i+1} / ${files.length}`, pct);
        if (!STATE.localDB.contexts[ctx].items.includes(promptName)) { STATE.localDB.contexts[ctx].items.push(promptName); STATE.localDB.contexts[ctx].metadata[promptName] = { tags: [] }; }
        const imgKey = `${ctx}_${promptName}`; if (!STATE.localDB.images[imgKey]) STATE.localDB.images[imgKey] = [];
        try {
            const base64 = await UTILS.compressImage(files[i], STATE.localDB.settings?.max_width ?? 900, STATE.localDB.settings?.compress_rate ?? 0.85);
            const url = await PromptAPI.uploadImage(base64, `img_${promptName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').substring(0, 15) || 'img'}_${UTILS.cyrb53(base64)}.jpg`, ctx);
            if (url && !STATE.localDB.images[imgKey].includes(url)) STATE.localDB.images[imgKey].push(url);
        } catch(e) {}
    }
    await PromptAPI.saveDB(STATE.localDB); window.pmHideModal("pm-create-modal"); UI.hideProgress(); renderGrid();
}

async function handleCreateTXT(file) {
    const ctx = `${STATE.currentModelId}_${STATE.currentModeId}`;
    if (!STATE.localDB.contexts[ctx]) STATE.localDB.contexts[ctx] = { items: [], metadata: {} };
    const reader = new FileReader();
    reader.onload = async (e) => {
        let addedCount = 0;
        e.target.result.split(/[,\r\n]+/).forEach(p => {
            let val = p.trim(); try { val = decodeURIComponent(val); } catch(e) {}
            if (val && !STATE.localDB.contexts[ctx].items.includes(val)) { STATE.localDB.contexts[ctx].items.push(val); STATE.localDB.contexts[ctx].metadata[val] = { tags: [] }; addedCount++; }
        });
        if (addedCount > 0) { await PromptAPI.saveDB(STATE.localDB); alert(`成功导入 ${addedCount} 个！`); } else alert("未发现新内容。");
        window.pmHideModal("pm-create-modal"); renderGrid();
    };
    reader.readAsText(file);
}

async function executeAppendImages(files, item, ctx) {
    const imgKey = `${ctx}_${item}`; if (!STATE.localDB.images[imgKey]) STATE.localDB.images[imgKey] = [];
    for (let i = 0; i < files.length; i++) {
        UI.updateProgress("追加图片...", `处理中: ${i+1} / ${files.length}`, Math.round(((i + 1) / files.length) * 100));
        try {
            const base64 = await UTILS.compressImage(files[i], STATE.localDB.settings?.max_width ?? 900, STATE.localDB.settings?.compress_rate ?? 0.85);
            const url = await PromptAPI.uploadImage(base64, `img_${item.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').substring(0, 15) || 'img'}_${UTILS.cyrb53(base64)}.jpg`, ctx);
            if (url && !STATE.localDB.images[imgKey].includes(url)) STATE.localDB.images[imgKey].push(url); 
        } catch(err) {}
    }
    await PromptAPI.saveDB(STATE.localDB); UI.hideProgress(); renderGrid();
}

function handleImportFile(file) {
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const data = JSON.parse(ev.target.result); 
            let normalizedData = { contexts: {}, images: {} };
            let sourceMeta = {};

            const extractIds = (ctxStr, dataObj) => {
                let mId = ctxStr.split('_')[0];
                let modId = ctxStr.substring(mId.length + 1);
                if (dataObj.models && dataObj.models.main_models) {
                    for (const key of Object.keys(dataObj.models.main_models)) {
                        if (ctxStr.startsWith(key + '_')) {
                            mId = key;
                            modId = ctxStr.substring(key.length + 1);
                            break;
                        }
                    }
                }
                return { mId, modId };
            };

            if (data.type === 'multi_export' && data.contexts) {
                for (const [ctx, ctxData] of Object.entries(data.contexts)) {
                    normalizedData.contexts[ctx] = { 
                        items: ctxData.items || [], 
                        metadata: ctxData.metadata || {},
                        groups: ctxData.groups || [],
                        combos: ctxData.combinations || [] 
                    };
                    const { mId, modId } = extractIds(ctx, data);
                    sourceMeta[ctx] = {
                        modeName: ctxData.modeInfo?.name || modId,
                        modelName: mId
                    };
                    if (ctxData.images) { 
                        for (const [itemName, imgData] of Object.entries(ctxData.images)) { 
                            normalizedData.images[`${ctx}_${itemName}`] = Array.isArray(imgData) ? imgData : [imgData]; 
                        } 
                    }
                }
            } else if (data.items && data.metadata) {
                const ctx = data.context || `${STATE.currentModelId}_${STATE.currentModeId}`;
                normalizedData.contexts[ctx] = { 
                    items: data.items || [], 
                    metadata: data.metadata || {},
                    groups: data.groups || [],
                    combos: data.combinations || []
                };
                const { mId, modId } = extractIds(ctx, data);
                sourceMeta[ctx] = { modeName: modId, modelName: mId };
                if (data.images) { 
                    for (const [itemName, imgData] of Object.entries(data.images)) { 
                        normalizedData.images[`${ctx}_${itemName}`] = Array.isArray(imgData) ? imgData : [imgData]; 
                    } 
                }
            } else if (data.contexts) {
                normalizedData = data;
                for (const ctx of Object.keys(data.contexts)) {
                    const { mId, modId } = extractIds(ctx, data);
                    const mName = data.models?.main_models?.[mId]?.modes?.[modId]?.name || modId;
                    const modelName = data.models?.main_models?.[mId]?.name || mId;
                    sourceMeta[ctx] = { modeName: mName, modelName: modelName };
                }
            } else throw new Error();
            
            STATE.pendingImportData = normalizedData;
            STATE.pendingImportMeta = sourceMeta;
            document.getElementById("pm-import-ctx-count").innerText = Object.keys(normalizedData.contexts).length;
            window.pmShowModal("pm-import-modal");
        } catch (err) { alert("数据包解析失败！"); }
    };
    reader.readAsText(file);
}

function setupMarquee() {
    const main = document.getElementById("pm-main");
    let isDrawing = false, startX = 0, startY = 0, selectionSnapshot = new Set(); window._isDraggingMarquee = false;
    main.addEventListener("mousedown", (e) => {
        if (!STATE.isBatchMode || e.target.closest('.pm-img-overlay') || e.target.closest('.pm-card-actions')) return;
        e.preventDefault(); 
        isDrawing = true; window._isDraggingMarquee = false;
        const rect = main.getBoundingClientRect(); startX = e.clientX - rect.left + main.scrollLeft; startY = e.clientY - rect.top + main.scrollTop;
        selectionSnapshot = new Set(STATE.batchSelection);
        const marquee = document.getElementById("pm-marquee"); marquee.style.display = "block"; marquee.style.left = startX + "px"; marquee.style.top = startY + "px"; marquee.style.width = "0px"; marquee.style.height = "0px";
    });
    main.addEventListener("mousemove", (e) => {
        if (!isDrawing || !STATE.isBatchMode) return;
        window._isDraggingMarquee = true; const rect = main.getBoundingClientRect();
        const currentX = e.clientX - rect.left + main.scrollLeft, currentY = e.clientY - rect.top + main.scrollTop;
        const left = Math.min(startX, currentX), top = Math.min(startY, currentY), width = Math.abs(currentX - startX), height = Math.abs(currentY - startY);
        const marquee = document.getElementById("pm-marquee"); marquee.style.left = left + "px"; marquee.style.top = top + "px"; marquee.style.width = width + "px"; marquee.style.height = height + "px";
        const marqueeRect = { left, top, right: left + width, bottom: top + height };
        main.querySelectorAll(".pm-selectable-card").forEach(card => {
            const cardRect = { left: card.offsetLeft, top: card.offsetTop, right: card.offsetLeft + card.offsetWidth, bottom: card.offsetTop + card.offsetHeight };
            const isIntersecting = !(marqueeRect.right < cardRect.left || marqueeRect.left > cardRect.right || marqueeRect.bottom < cardRect.top || marqueeRect.top > cardRect.bottom);
            const batchKey = `${card.dataset.ctx}||${card.dataset.item}`;
            if (isIntersecting ? !selectionSnapshot.has(batchKey) : selectionSnapshot.has(batchKey)) { STATE.batchSelection.add(batchKey); card.classList.add("batch-selected"); } 
            else { STATE.batchSelection.delete(batchKey); card.classList.remove("batch-selected"); }
        });
        document.getElementById("pm-batch-count").innerText = `已选择: ${STATE.batchSelection.size}`;
    });
    const stopDrawing = () => { if (isDrawing) { isDrawing = false; document.getElementById("pm-marquee").style.display = "none"; setTimeout(() => { window._isDraggingMarquee = false; }, 50); } };
    main.addEventListener("mouseup", stopDrawing); main.addEventListener("mouseleave", stopDrawing);
}

async function addModel() { const name = prompt("新一级分类名称:"); if (!name) return; const id = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').toLowerCase() + "_" + Date.now(); STATE.localDB.models.main_models[id] = { name: name, categories: [{id:'custom', name:'默认二级分类'}], modes: {} }; await PromptAPI.saveDB(STATE.localDB); STATE.currentModelId = id; STATE.currentModeId = null; renderModelTabs(); UTILS.syncImportNodeWidgets(); }
async function editModel(mId) { const newName = prompt("重命名一级分类:", STATE.localDB.models.main_models[mId].name); if (!newName) return; STATE.localDB.models.main_models[mId].name = newName; await PromptAPI.saveDB(STATE.localDB); renderModelTabs(); UTILS.syncImportNodeWidgets(); }
async function deleteModel(mId) { if (!confirm(`删除该一级分类及其所有数据？`)) return; UI.updateProgress("清理中...", "请稍候"); for (const ctx of Object.keys(STATE.localDB.contexts)) { if (ctx.startsWith(mId + "_")) { await cleanupContextImages(ctx); delete STATE.localDB.contexts[ctx]; } } delete STATE.localDB.models.main_models[mId]; if (STATE.currentModelId === mId) { STATE.currentModelId = null; STATE.currentModeId = null; } await PromptAPI.saveDB(STATE.localDB); UI.hideProgress(); renderModelTabs(); UTILS.syncImportNodeWidgets(); }
async function addCategory() { const name = prompt("新二级分类名称:"); if (!name) return; STATE.localDB.models.main_models[STATE.currentModelId].categories.push({ id: "cat_" + Date.now(), name }); await PromptAPI.saveDB(STATE.localDB); renderSidebar(); UTILS.syncImportNodeWidgets(); }
async function editCategory(cId) { const cat = STATE.localDB.models.main_models[STATE.currentModelId].categories.find(c => c.id === cId); if(!cat) return; const newName = prompt("重命名二级分类:", cat.name); if (!newName) return; cat.name = newName; await PromptAPI.saveDB(STATE.localDB); renderSidebar(); UTILS.syncImportNodeWidgets(); }

async function deleteCategory(cId) { 
    if (!confirm("彻底删除此二级分类？(其下的所有三级分类及数据将被永久清除！)")) return; 
    UI.updateProgress("清理中...", "请稍候");
    const model = STATE.localDB.models.main_models[STATE.currentModelId]; 
    
    const modesToDelete = [];
    for (const [modId, m] of Object.entries(model.modes)) {
        if (m.group === cId) {
            modesToDelete.push(modId);
        }
    }
    
    for (const modId of modesToDelete) {
        const ctx = `${STATE.currentModelId}_${modId}`;
        await cleanupContextImages(ctx);
        delete STATE.localDB.contexts[ctx];
        delete model.modes[modId];
        if (STATE.currentModeId === modId) STATE.currentModeId = null;
    }

    model.categories = model.categories.filter(c => c.id !== cId); 
    
    await PromptAPI.saveDB(STATE.localDB); 
    UI.hideProgress();
    renderSidebar(); 
    UTILS.syncImportNodeWidgets(); 
}

async function addMode(catId) { const name = prompt("新三级分类名称:"); if (!name) return; const id = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').toLowerCase() + "_" + Date.now(); STATE.localDB.models.main_models[STATE.currentModelId].modes[id] = { name: name, group: catId }; await PromptAPI.saveDB(STATE.localDB); STATE.currentModeId = id; renderSidebar(); UTILS.syncImportNodeWidgets(); }
async function editMode(modId) { const newName = prompt("重命名三级分类:", STATE.localDB.models.main_models[STATE.currentModelId].modes[modId].name); if (!newName) return; STATE.localDB.models.main_models[STATE.currentModelId].modes[modId].name = newName; await PromptAPI.saveDB(STATE.localDB); renderSidebar(); UTILS.syncImportNodeWidgets(); }
async function deleteMode(modId) { if (!confirm(`彻底删除该三级分类下的所有数据？`)) return; UI.updateProgress("清理中...", "请稍候"); const ctx = `${STATE.currentModelId}_${modId}`; await cleanupContextImages(ctx); delete STATE.localDB.contexts[ctx]; delete STATE.localDB.models.main_models[STATE.currentModelId].modes[modId]; if (STATE.currentModeId === modId) STATE.currentModeId = null; await PromptAPI.saveDB(STATE.localDB); UI.hideProgress(); renderSidebar(); UTILS.syncImportNodeWidgets(); }
async function cleanupContextImages(ctx) {
    if (!STATE.localDB.contexts[ctx]) return;
    const foldersToWipe = new Set(); foldersToWipe.add(ctx);
    for (const item of STATE.localDB.contexts[ctx].items) {
        const imgKey = `${ctx}_${item}`;
        if (STATE.localDB.images[imgKey]) { 
            for (const url of STATE.localDB.images[imgKey]) { await PromptAPI.deleteFile(url); const m = url.match(/^\/prompt_data\/([^\/]+)\//); if (m) foldersToWipe.add(decodeURIComponent(m[1])); }
            delete STATE.localDB.images[imgKey]; 
        }
    }
    for (const f of foldersToWipe) await PromptAPI.deleteFolder(f);
}

// === 5. 节点注册: PromptBrowserNode ===
app.registerExtension({
    name: "PromptManager.BrowserNode",
    setup() {
        const origQueuePrompt = app.queuePrompt;
        app.queuePrompt = async function(number, batchCount) {
            try {
                let hasAutoRandom = false;
                if (app.graph) {
                    const targetNodes = app.graph._nodes.filter(n => n.type === "PromptBrowserNode" || n.type === "PromptGroupRandomizerNode");
                    hasAutoRandom = targetNodes.some(node => node.widgets?.find(w => w.name === "自动随机抽取")?.value);
                }

                if (hasAutoRandom) {
                    let count = number || 1; 
                    let lastResult;
                    for (let i = 0; i < count; i++) {
                        const targetNodes = app.graph._nodes.filter(n => n.type === "PromptBrowserNode" || n.type === "PromptGroupRandomizerNode");
                        for (const node of targetNodes) {
                            const autoWidget = node.widgets?.find(w => w.name === "自动随机抽取");
                            if (autoWidget && autoWidget.value) {
                                const randomBtn = node.widgets?.find(w => w.name === "random" || w.name === "随机抽取" || w.name === "draw_blind_box" || w.name === "抽取盲盒");
                                if (randomBtn && randomBtn.callback) await randomBtn.callback();
                            }
                        }
                        lastResult = await origQueuePrompt.call(this, 1, batchCount);
                    }
                    return lastResult;
                }
            } catch (e) {
                console.error("[PromptManager] 自动随机抽卡发生错误:", e);
            }
            return await origQueuePrompt.apply(this, arguments);
        };
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "PromptBrowserNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                
                const promptWidget = this.widgets.find(w => w.name === "prompt_text" || w.name === "输入prompt");
                if (!promptWidget) return;

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

                const htmlListWidget = this.addDOMWidget("prompt_list", "HTML", listContainer, { serialize: false, hideOnZoom: false });

                let cachedList = []; let isUpdatingFromList = false;

                const renderList = () => {
                    listBody.innerHTML = '';
                    try {
                        if (!isUpdatingFromList && UTILS && UTILS.parsePromptText) {
                            cachedList = UTILS.parsePromptText(promptWidget.value || "");
                        }
                    } catch (err) {
                        console.error("[PromptManager] 解析 Prompt 失败:", err);
                    }

                    if (!cachedList || cachedList.length === 0) { 
                        listBody.innerHTML = '<div style="color:#555; font-size:11px; text-align:center; padding:10px;">暂无 Prompt</div>'; 
                        return; 
                    }

                    cachedList.forEach((item, index) => {
                        const row = document.createElement("div");
                        row.style.cssText = `display: flex; justify-content: space-between; align-items: center; background: #252525; padding: 4px 6px; border-radius: 4px; transition: 0.2s; ${item.enabled === false ? 'opacity: 0.4;' : ''}`;
                        const tagSpan = document.createElement("span");
                        tagSpan.style.cssText = `color: #ddd; font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; cursor: pointer; user-select: none; ${item.enabled === false ? 'text-decoration: line-through;' : ''}`;
                        tagSpan.innerText = item.tag;

                        tagSpan.ondblclick = (e) => {
                            e.stopPropagation(); isUpdatingFromList = true; item.enabled = item.enabled === false ? true : false;
                            promptWidget.value = UTILS.buildPromptText(cachedList); app.graph.setDirtyCanvas(true); renderList();
                            setTimeout(() => { isUpdatingFromList = false; }, 50);
                        };

                        const rightCtrl = document.createElement("div"); rightCtrl.style.cssText = "display: flex; align-items: center; gap: 6px;";
                        const numInput = document.createElement("input");
                        numInput.type = "number"; numInput.step = "0.1"; numInput.value = item.weight.toFixed(1); numInput.disabled = item.enabled === false;
                        numInput.style.cssText = `width: 45px; background: #111; border: 1px solid #444; color: #ff6b9d; font-size: 12px; font-weight: bold; border-radius: 4px; text-align: center; outline: none; ${item.enabled === false ? 'cursor: not-allowed; opacity: 0.5;' : ''}`;
                        numInput.onchange = (e) => {
                            isUpdatingFromList = true; item.weight = parseFloat(e.target.value) || 1.0;
                            promptWidget.value = UTILS.buildPromptText(cachedList); app.graph.setDirtyCanvas(true); renderList();
                            setTimeout(() => { isUpdatingFromList = false; }, 50);
                        };

                        const delBtn = document.createElement("button"); delBtn.innerHTML = "×";
                        delBtn.style.cssText = "background: #5a1a1a; color: #f44336; border: none; border-radius: 4px; width: 22px; height: 22px; cursor: pointer; font-weight: bold; display: flex; align-items: center; justify-content: center; transition: 0.2s;";
                        delBtn.onclick = (e) => {
                            e.stopPropagation(); isUpdatingFromList = true; cachedList.splice(index, 1);
                            promptWidget.value = UTILS.buildPromptText(cachedList); app.graph.setDirtyCanvas(true); renderList();
                            setTimeout(() => { isUpdatingFromList = false; }, 50);
                        };

                        rightCtrl.appendChild(numInput); rightCtrl.appendChild(delBtn); row.appendChild(tagSpan); row.appendChild(rightCtrl); listBody.appendChild(row);
                    });
                };

                const originalCallback = promptWidget.callback;
                promptWidget.callback = function() { 
                    if (originalCallback) originalCallback.apply(this, arguments); 
                    if (!isUpdatingFromList) renderList(); 
                };
                renderList();

                const btnOpen = this.addWidget("button", "打开 Prompt 浏览器", "open", async () => {
                    STATE.currentActiveWidget = promptWidget;
                    STATE.localDB = await UTILS.getAndMigrateDB();
                    openNativeBrowser();
                });

                const btnRandom = this.addWidget("button", "随机抽取", "random", async () => {
                    if (Object.keys(STATE.localDB.contexts || {}).length === 0) STATE.localDB = await UTILS.getAndMigrateDB();
                    if (!STATE.currentModelId) STATE.currentModelId = Object.keys(STATE.localDB.models?.main_models || {})[0];
                    if (!STATE.currentModeId && STATE.currentModelId) STATE.currentModeId = Object.keys(STATE.localDB.models.main_models[STATE.currentModelId].modes || {})[0];
                    
                    const ctx = `${STATE.currentModelId}_${STATE.currentModeId}`;
                    const dataItems = STATE.localDB.contexts[ctx]?.items || [];
                    if (dataItems.length === 0) return;
                    
                    const countWidget = this.widgets.find(w => w.name === "抽取数量");
                    const desiredCount = countWidget ? countWidget.value : 3;
                    
                    const count = Math.min(dataItems.length, desiredCount);
                    const selected = [...dataItems].sort(() => 0.5 - Math.random()).slice(0, count);
                    
                    const newParsed = selected.map(tag => ({ original: tag, tag: tag, weight: 1.0, enabled: true }));
                    promptWidget.value = UTILS.buildPromptText(newParsed); app.graph.setDirtyCanvas(true); renderList();
                });

                const autoRandomWidget = this.widgets.find(w => w.name === "自动随机抽取");
                const countWidget = this.widgets.find(w => w.name === "抽取数量");

                const desiredOrder = [
                    btnOpen,
                    btnRandom,
                    autoRandomWidget,
                    countWidget,
                    promptWidget,
                    htmlListWidget
                ].filter(Boolean);     

                const otherWidgets = this.widgets.filter(w => !desiredOrder.includes(w));
                this.widgets = [...desiredOrder, ...otherWidgets];
                
                this.setSize([400, 420]);
            };
        }
    }
});