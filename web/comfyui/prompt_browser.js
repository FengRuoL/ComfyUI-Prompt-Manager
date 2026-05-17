/* =====================================================================
 * [AI System Prompt / Do Not Modify]
 * FILE: prompt_browser.js
 * DESC: Main UI controller and DOM renderer for the Prompt Manager browser.
 * ROLE: Handles native browser window creation, drag-and-drop, event listeners, and grid rendering.
 * 
 * [User Info / 可由用户自行修改]
 * 文件：prompt_browser.js
 * 作用：插件前端的“核心 UI 引擎”。主要负责生成、控制、渲染弹出的大型管理界面（包括左侧分类与侧边栏、右侧卡片瀑布流以及所有的操作弹窗）。
 * ===================================================================== */

import { app } from "../../scripts/app.js";
import { PromptAPI } from "./prompt_api.js";

// === 1. 初始化全局引用 ===
window.PM_Global = window.PM_Global || { state: {}, utils: {}, ui: {} };
const STATE = window.PM_Global.state;
const UTILS = window.PM_Global.utils;
const UI = window.PM_Global.ui;

// Shared HTML escaping utility - prevents XSS when interpolating user data into innerHTML
UTILS.escapeHTML = function(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', "'": '&#39;', '"': '&quot;'}[tag] || tag));
};

window.PM_Global.ui.openNativeBrowser = openNativeBrowser;
window.PM_Global.ui.renderGrid = renderGrid;

window.switchCreateTab = function(tab) {
    document.querySelectorAll('.pm-ct-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('[id^="ct-content-"]').forEach(c => c.style.display = 'none');
    document.getElementById(`ct-btn-${tab}`).classList.add('active');
    document.getElementById(`ct-content-${tab}`).style.display = 'block';
};

window.createSinglePrompt = async function() {
    let val = document.getElementById("pm-create-single-input").value.trim();
    val = window.PM_Global.utils.normalizePromptName(val);
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
    let newVal = document.getElementById("pm-edit-card-input").value.trim();
    newVal = window.PM_Global.utils.normalizePromptName(newVal);
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

window.PM_Global.ui.openGroupSelectModal = async function(item, ctx) { // 注意这里加了 async
    // === 核心改造：精确匹配所属一级分类 ===
    let sourceModelId = ctx.split('_')[0];
    for (const key of Object.keys(STATE.localDB.models.main_models)) {
        if (ctx.startsWith(key + '_')) { sourceModelId = key; break; }
    }
    
    let targetModelId = await window.PM_Global.utils.getLocalTwinModelId(sourceModelId);
    
    if (!targetModelId) {
        for (const key of Object.keys(STATE.localDB.models.main_models)) {
            if (!key.startsWith('cloud_') && !key.startsWith('fav_cloud_')) { targetModelId = key; break; }
        }
    }
    
    const globalCtx = `${targetModelId}_global`;
    if (!STATE.localDB.contexts[globalCtx]) STATE.localDB.contexts[globalCtx] = { items: [], metadata: {}, groups: [], combos: [] };
    const d = STATE.localDB.contexts[globalCtx];
    if(!d.groups) d.groups = [];
    
    // 下面的 UI 渲染代码保持不变...
    let modal = document.getElementById("pm-group-select-modal");
// ... 保持原有代码直到函数结束
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
        // 核心保护：对 item 进行 URL 编码，避免单引号切断 onclick
        const safeItemForEvent = encodeURIComponent(item);
        const safeGroupName = UTILS.escapeHTML(g.name);
        div.innerHTML = `
            <label style="cursor:pointer; display:flex; align-items:center; gap:10px;">
                <input type="checkbox" ${has?'checked':''} onchange="PM_Global.ui.toggleGroupItem(${idx}, decodeURIComponent('${safeItemForEvent}'), '${globalCtx}', this.checked)">
                <span style="color:#ccc; font-weight:bold;">${safeGroupName}</span>
            </label>
            <span style="color:#666; font-size:12px;">${g.items.length} 项</span>
        `;
        list.appendChild(div);
    });
    window.pmShowModal("pm-group-select-modal");
};

window.PM_Global.ui.toggleGroupItem = async function(gIdx, item, globalCtx, isChecked) {
    const d = STATE.localDB.contexts[globalCtx]; const g = d.groups[gIdx];
    if (isChecked && !g.items.includes(item)) g.items.push(item);
    else if (!isChecked && g.items.includes(item)) g.items = g.items.filter(x => x !== item);
    await PromptAPI.saveDB(STATE.localDB); renderGrid(); 
};

window.executeImportFinal = async function() {
    window.pmHideModal('pm-import-modal');
    const targetStrategy = document.querySelector('input[name="pm-import-target"]:checked').value;
    
    // === 修复拦截逻辑：精确区分不同的导入策略需求 ===
    if (targetStrategy === 'current_mode' && (!STATE.currentModelId || !STATE.currentModeId)) {
        alert("导入失败：当前没有选中的【三级分类】！\n请先在左侧选择或创建一个三级分类。");
        return;
    }
    if (targetStrategy === 'current_tab' && !STATE.currentModelId) {
        alert("导入失败：当前没有任何【一级分类】环境！\n请先创建一个一级分类，或选择【原路严格恢复】。");
        return;
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
    
    const globalCtx = `${STATE.currentModelId}_global`;
    const groups = STATE.localDB.contexts[globalCtx]?.groups || [];
    
    if (groups.length === 0) {
        sel.innerHTML = '<option value="">(当前一级分类下暂无收藏分组)</option>';
    } else {
        groups.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.name; opt.innerText = g.name; sel.appendChild(opt);
        });
    }

    // 构建迁移目标列表 (屏蔽云端库)
    const migSel = document.getElementById('pm-batch-migrate-select');
    migSel.innerHTML = '';
    const models = STATE.localDB.models.main_models;
    let hasTarget = false;
    for (const [mId, mData] of Object.entries(models)) {
        if (mId.startsWith('cloud_') || mId.startsWith('fav_cloud_')) continue;
        const mName = mData.name || mId;
        const cats = {};
        (mData.categories || []).forEach(c => cats[c.id] = c.name);
        for (const [modId, modData] of Object.entries(mData.modes || {})) {
            const cName = cats[modData.group || "custom"] || "未分类";
            const opt = document.createElement('option');
            opt.value = `${mId}_${modId}`;
            opt.innerText = `[${mName}] ${cName} = ${modData.name || modId}`;
            migSel.appendChild(opt);
            hasTarget = true;
        }
    }
    if (!hasTarget) migSel.innerHTML = '<option value="">(没有任何可用的本地三级分类)</option>';

    window.pmShowModal('pm-batch-edit-modal');
};

window.PM_Global.ui.onBatchActionChange = function(val) {
    document.getElementById('pm-batch-tag-div').style.display = val.includes('tags') ? 'block' : 'none';
    document.getElementById('pm-batch-group-div').style.display = val.includes('group') ? 'block' : 'none';
    document.getElementById('pm-batch-migrate-div').style.display = (val === 'migrate') ? 'block' : 'none';
};

window.PM_Global.ui.executeBatchEdit = async function() {
    const act = document.getElementById('pm-batch-action-select').value;
    
    if (act === 'migrate') {
        const targetCtx = document.getElementById('pm-batch-migrate-select').value;
        if (!targetCtx) return alert("没有有效的迁移目标！");

        UI.updateProgress("正在迁移数据...", "移动属性与物理图片文件");
        let processed = 0;
        const total = STATE.batchSelection.size;

        try {
            for (const batchKey of STATE.batchSelection) {
                const [oldCtx, item] = batchKey.split('||');
                if (oldCtx === targetCtx) continue; 
                if (!STATE.localDB.contexts[oldCtx]) continue;

                processed++;
                UI.updateProgress("正在迁移数据...", `处理中: ${processed} / ${total} (${item})`, Math.round((processed/total)*100));

                const oldData = STATE.localDB.contexts[oldCtx];
                if (!STATE.localDB.contexts[targetCtx]) STATE.localDB.contexts[targetCtx] = { items: [], metadata: {} };
                const targetData = STATE.localDB.contexts[targetCtx];

                // 1. 迁移元数据和文本属性
                if (!targetData.items.includes(item)) targetData.items.push(item);
                targetData.metadata[item] = oldData.metadata[item] || { tags: [] };
                
                oldData.items = oldData.items.filter(x => x !== item);
                delete oldData.metadata[item];

                // 2. 深度物理搬运图库 (安全抽出后重组)
                const oldImgKey = `${oldCtx}_${item}`;
                const newImgKey = `${targetCtx}_${item}`;
                if (STATE.localDB.images[oldImgKey] && STATE.localDB.images[oldImgKey].length > 0) {
                    if (!STATE.localDB.images[newImgKey]) STATE.localDB.images[newImgKey] = [];
                    for (let i = 0; i < STATE.localDB.images[oldImgKey].length; i++) {
                        const oldUrl = STATE.localDB.images[oldImgKey][i];
                        try {
                            const b64 = await UTILS.urlToBase64(oldUrl);
                            const safeName = "mig_" + UTILS.cyrb53(b64) + ".jpg";
                            const newUrl = await PromptAPI.uploadImage(b64, safeName, targetCtx);
                            if (newUrl) {
                                STATE.localDB.images[newImgKey].push(newUrl);
                                await PromptAPI.deleteFile(oldUrl); // 安全删除旧文件
                            } else {
                                STATE.localDB.images[newImgKey].push(oldUrl); // 备用防丢
                            }
                        } catch(e) {
                            STATE.localDB.images[newImgKey].push(oldUrl); // 备用防丢
                        }
                    }
                    delete STATE.localDB.images[oldImgKey];
                }

                // 3. 跨一级分类(跨模型)时，自动剥离失效的旧收藏夹分组关联
                const oldModelId = oldCtx.split('_')[0];
                const newModelId = targetCtx.split('_')[0];
                if (oldModelId !== newModelId) {
                    const globalCtx = `${oldModelId}_global`;
                    const groups = STATE.localDB.contexts[globalCtx]?.groups || [];
                    groups.forEach(g => { g.items = g.items.filter(x => x !== item); });
                }
            }
        } catch(e) {
            alert("迁移过程中遇到部分异常，可能未完全执行完成。");
        } finally {
            UI.hideProgress();
        }

    } else if (act === 'add-tags' || act === 'remove-tags') {
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
        if (!gName) return alert("没有可用的收藏分组！");
        
        const globalCtx = `${STATE.currentModelId}_global`;
        const g = STATE.localDB.contexts[globalCtx]?.groups?.find(x => x.name === gName);
        if (g) {
            STATE.batchSelection.forEach(batchKey => {
                const [ctx, item] = batchKey.split('||');
                if (act === 'add-to-group' && !g.items.includes(item)) g.items.push(item);
                else if (act === 'remove-from-group') g.items = g.items.filter(x => x !== item);
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
        // 核心修复：导出时强制剥离云端订阅库，防止污染本地备份
        for (let mId in exportData.models.main_models) {
            if (mId.startsWith('cloud_')) delete exportData.models.main_models[mId];
        }
        exportData.settings = STATE.localDB.settings;
        // 核心修复：不导出云端的上下文
        targetCtxs = Object.keys(STATE.localDB.contexts || {}).filter(ctx => !ctx.startsWith('cloud_')); 
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
window.PM_Global.ui.toggleSidebarSection = function(id, el) {
    const content = document.getElementById(id);
    const arrow = el.querySelector('span:nth-child(2)');
    if (content.style.display === 'none') {
        content.style.display = 'block';
        if(arrow) arrow.style.transform = 'rotate(0deg)';
    } else {
        content.style.display = 'none';
        if(arrow) arrow.style.transform = 'rotate(-90deg)';
    }
};

function openNativeBrowser() {
    let container = document.getElementById("pm-native-modal");

    if (!container) {
        // 1. 动态挂载外部 CSS 样式表
        if (!document.getElementById("pm-native-style")) {
            const link = document.createElement("link");
            link.id = "pm-native-style"; link.rel = "stylesheet"; link.type = "text/css";
            link.href = new URL("./prompt_manager.css", import.meta.url).href;
            document.head.appendChild(link);
        }

        // 动态注入云端只读模式的隐藏样式
        if (!document.getElementById("pm-cloud-style")) {
            const cloudStyle = document.createElement("style");
            cloudStyle.id = "pm-cloud-style";
            cloudStyle.innerHTML = `
                /* 1. 隐藏所有破坏数据的按钮（新增隐藏图片上的删除小叉号） */
                .is-cloud-mode .pm-ctrl-group, 
                .is-cloud-mode .pm-add-btn, 
                .is-cloud-mode [data-action="upload"], 
                .is-cloud-mode [data-action="edit"], 
                .is-cloud-mode [data-action="delete"], 
                .is-cloud-mode .pm-del-img-btn, 
                .is-cloud-mode #pm-btn-add-card, 
                .is-cloud-mode #pm-btn-batch { 
                    display: none !important; 
                }
                
                /* 1.1 新增：控制专属更新按钮的显示与隐藏 */
                #sect-cloud-ops { display: none; }
                .is-cloud-mode #sect-cloud-ops { display: block; margin-top: 15px; border-top: 1px dashed rgba(255,107,157,0.3); padding-top: 15px; }
                
                /* 2. 禁止侧边栏分类的拖拽行为 */
                .is-cloud-mode .pm-cat-wrap,
                .is-cloud-mode .pm-mode-wrap { pointer-events: none; } 
                
                /* 3. 释放分类按钮的点击事件，否则无法切换三级分类 */
                .is-cloud-mode .pm-cat-header,
                .is-cloud-mode .pm-mode-btn { pointer-events: auto; }

                /* 4. 隐藏侧边栏的本地管理专属功能 */
                .is-cloud-mode #sect-backup,
                .is-cloud-mode #sect-settings,
                .is-cloud-mode .pm-sidebar-group:nth-child(2),
                .is-cloud-mode .pm-sidebar-group:nth-child(3) { 
                    display: none !important; 
                }
            `;
            document.head.appendChild(cloudStyle); // <-- 修复1：加上了这一行挂载到页面
        } // <-- 修复2：加上了这个极其关键的右大括号！

        // 2. 独立构建所有隐藏的弹窗模态框 (解耦分离)
        buildAllModals();

        // 3. 构建主面板结构
        container = buildMainContainer();
        document.body.appendChild(container);

        // 4. 绑定所有全局事件与交互
        bindBrowserEvents(container);

        // 5. 初始化附加组件
        setupMarquee();
        setupShortcuts();
    } else {
        container.style.display = "flex";
        window.exitBatchMode();
    }
    
    renderModelTabs();
}

// ==========================================
// UI 模块 1：构建所有附属弹窗
// ==========================================
function buildAllModals() {
    if (document.getElementById("pm-create-modal")) return;

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

    const backupModal = document.createElement("div"); backupModal.className = "pm-modal-overlay"; backupModal.id = "pm-backup-modal"; backupModal.style.zIndex = "20002";
    backupModal.innerHTML = `
        <div class="pm-create-box" style="width: 500px;">
            <div class="pm-create-header"><b style="color:#ff6b9d;">系统备份与恢复</b><button class="pm-close-btn" onclick="pmHideModal('pm-backup-modal')">关闭</button></div>
            <div class="pm-create-content" style="padding: 20px;">
                <button class="pm-action-btn primary" style="width:100%; padding:12px; margin-bottom:15px; font-size:14px;" onclick="PM_Global.ui.createBackup()">+ 创建新备份 (包含图片及全部数据)</button>
                <div style="color:#ccc; font-weight:bold; margin-bottom:10px;">可用备份列表:</div>
                <div id="pm-backup-list" style="max-height:300px; overflow-y:auto; background:#111; border:1px solid #333; border-radius:8px; padding:10px;"></div>
            </div>
        </div>
    `;
    document.body.appendChild(backupModal);

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
                    <option value="migrate">批量迁移卡片</option>
                </select>
                <div id="pm-batch-tag-div">
                    <input type="text" id="pm-batch-tag-input" class="pm-search-input" style="width:100%; margin-bottom:15px;" placeholder="输入标签，用逗号分隔">
                </div>
                <div id="pm-batch-group-div" style="display:none; margin-bottom:15px;">
                    <select id="pm-batch-group-select" class="pm-scope-select" style="width:100%;"></select>
                </div>
                <div id="pm-batch-migrate-div" style="display:none; margin-bottom:15px;">
                    <p style="font-size:12px; color:#ff6b9d; margin-bottom:8px;">请选择目标三级分类：</p>
                    <select id="pm-batch-migrate-select" class="pm-scope-select" style="width:100%;"></select>
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

// ==========================================
// UI 模块 2：构建主应用视图
// ==========================================
function buildMainContainer() {
    const container = document.createElement("div"); 
    container.id = "pm-native-modal";
    
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
                        <div class="pm-sidebar-label" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;" onclick="PM_Global.ui.toggleSidebarSection('sect-workspace', this)">
                            <span>工作区与操作</span><span style="transition:0.2s; transform:rotate(0deg); font-size:10px; color:#ff6b9d;">▼</span>
                        </div>
                        <div id="sect-workspace">
                            <div class="pm-btn-row">
                                <button class="pm-action-btn" style="flex:1; color:#f8961e; border-color:#835213;" onclick="PM_Global.ui.openGroupsModal()">收藏管理</button>
                                <button class="pm-action-btn" style="flex:1; color:#a78bfa; border-color:#534383;" onclick="PM_Global.ui.openCombosModal()">组合管理</button>
                            </div>
                            <div class="pm-btn-row">
                                <button class="pm-action-btn primary" style="flex:1;" id="pm-btn-add-card">新建卡片</button>
                                <button class="pm-action-btn" style="flex:1;" id="pm-btn-batch">批量操作</button>
                            </div>
                        </div>
                    </div>
                    <div class="pm-sidebar-group">
                        <div class="pm-sidebar-label" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;" onclick="PM_Global.ui.toggleSidebarSection('sect-backup', this)">
                            <span>数据与备份</span><span style="transition:0.2s; transform:rotate(-90deg); font-size:10px; color:#ff6b9d;">▼</span>
                        </div>
                        <div id="sect-backup" style="display:none;">
                            <div class="pm-btn-row">
                                <button class="pm-action-btn" style="flex:1;" id="pm-btn-import">导入配置</button>
                                <button class="pm-action-btn" style="flex:1;" id="pm-btn-export">导出配置</button>
                            </div>
                            <div class="pm-btn-row">
                                <button class="pm-action-btn primary" style="flex:1; border-color:#ff6b9d;" id="pm-btn-backup">管理系统备份</button>
                            </div>
                        </div>
                    </div>
                    <div class="pm-sidebar-group" style="border-bottom:none; margin-bottom:0; padding-bottom:0;">
                        <div class="pm-sidebar-label" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;" onclick="PM_Global.ui.toggleSidebarSection('sect-settings', this)">
                            <span>图片压缩设置</span><span style="transition:0.2s; transform:rotate(-90deg); font-size:10px; color:#ff6b9d;">▼</span>
                        </div>
                        <div id="sect-settings" style="display:none;">
                            <div class="pm-sidebar-label" style="display:flex; justify-content:space-between; margin-bottom:5px;"><span>压缩率</span> <span id="pm-comp-val" style="color:#ff6b9d;">${initCompPct}%</span></div>
                            <input type="range" id="pm-comp-slider" min="10" max="100" value="${initCompPct}" style="width:100%; cursor:pointer;">
                            <div class="pm-sidebar-label" style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; margin-bottom:5px;">
                                <span>最大宽度</span>
                                <div style="display:flex; align-items:center; gap:4px; color:#aaa; font-size:12px; font-weight:normal;">
                                    <input type="number" id="pm-width-input" value="${initMaxWidth}" min="100" max="4096" style="width:55px; background:#111; border:1px solid #444; color:#ff6b9d; border-radius:4px; text-align:center;"> px
                                </div>
                            </div>
                            <input type="range" id="pm-width-slider" min="100" max="4096" step="10" value="${initMaxWidth}" style="width:100%; cursor:pointer;">
                        </div>
                    </div>
                    
                    <!-- 新增：订阅库专属的更新操作区 -->
                    <div id="sect-cloud-ops">
                        <div class="pm-sidebar-label">订阅库操作</div>
                        <button class="pm-action-btn primary" style="width:100%; font-weight:bold; border-color:#ff6b9d;" onclick="PM_Global.ui.forceUpdateCloud()">强制拉取最新云端库</button>
                        <p style="font-size:10px; color:#888; margin-top:8px; line-height:1.4;">提示：这会无视缓存立即下载最新数据，请勿频繁恶意点击以免被 GitHub 官方风控拉黑。</p>
                    </div>

                    <input type="file" id="pm-hidden-import" accept=".json" style="display:none;">
                    <input type="file" id="pm-hidden-append-img" multiple accept="image/*" style="display:none;">
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
    return container;
}

// ==========================================
// UI 模块 3：绑定所有面板与全局事件
// ==========================================
function bindBrowserEvents(container) {
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
    
    // 窗口拖拽逻辑
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

    // 侧边栏各种按钮事件
    document.getElementById("pm-btn-batch").onclick = () => { 
        STATE.isBatchMode = true; 
        STATE.batchSelection.clear(); 
        document.getElementById("pm-batch-bar").classList.add("active"); 
        document.getElementById("pm-main").classList.add("batch-active");
        renderGrid(); 
    };
    document.getElementById("pm-btn-export").onclick = () => window.pmShowModal("pm-export-modal");
    document.getElementById("pm-btn-backup").onclick = () => PM_Global.ui.openBackupModal();

    window.PM_Global.ui.openBackupModal = async function() {
        window.pmShowModal("pm-backup-modal");
        const list = document.getElementById("pm-backup-list");
        list.innerHTML = "<div style='color:#666; text-align:center;'>加载中...</div>";
        try {
            const res = await fetch("/api/prompt-manager/backup/list");
            const data = await res.json();
            if (data.success) {
                list.innerHTML = "";
                if (data.backups.length === 0) list.innerHTML = "<div style='color:#666; text-align:center;'>暂无备份</div>";
data.backups.forEach(b => {
                    const dateStr = new Date(b.time * 1000).toLocaleString();
                    const safeBName = UTILS.escapeHTML(b.name);
                    const safeBNameForEvent = encodeURIComponent(b.name);
                    const item = document.createElement("div"); item.className = "pm-list-item"; item.style.padding = "10px";
                    item.innerHTML = `
                        <div>
                            <div style="color:#ddd; font-weight:bold;">${safeBName}</div>
                            <div style="color:#888; font-size:11px;">大小: ${b.size} MB | 时间: ${dateStr}</div>
                        </div>
                        <button class="pm-text-btn danger" onclick="PM_Global.ui.restoreBackup(decodeURIComponent('${safeBNameForEvent}'))">恢复此备份</button>
                    `;
                    list.appendChild(item);
                });
            }
        } catch(e) { list.innerHTML = "<div style='color:#f44336; text-align:center;'>加载失败</div>"; }
    };

    window.PM_Global.ui.createBackup = async function() {
        const name = prompt("请输入备份名称 (留空则默认按当前时间命名):");
        if (name === null) return;
        UI.updateProgress("正在创建备份...", "打包图片与配置，这可能需要一点时间");
        try {
            const res = await fetch("/api/prompt-manager/backup/create", { method: 'POST', body: JSON.stringify({name: name || undefined}) });
            const data = await res.json();
            UI.hideProgress();
            if (data.success) { alert("备份成功！文件已存入 backup 文件夹。"); PM_Global.ui.openBackupModal(); }
            else alert("备份失败: " + data.error);
        } catch(e) { UI.hideProgress(); alert("请求失败"); }
    };

    window.PM_Global.ui.restoreBackup = async function(filename) {
        if (!confirm("⚠ 危险操作警告 ⚠\n确定要恢复此备份吗？\n当前的【所有图片和提示词配置】将被格式化并彻底覆盖！")) return;
        UI.updateProgress("正在恢复备份...", "正在解压文件，请绝对不要关闭窗口！");
        try {
            const res = await fetch("/api/prompt-manager/backup/restore", { method: 'POST', body: JSON.stringify({filename}) });
            const data = await res.json();
            UI.hideProgress();
            if (data.success) { alert("恢复成功！ComfyUI 页面即将刷新加载新数据。"); location.reload(); } 
            else { alert("恢复失败: " + data.error); }
        } catch(e) { UI.hideProgress(); alert("请求失败"); }
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
}

window.exitBatchMode = function() {
    STATE.isBatchMode = false; STATE.batchSelection.clear();
    const bb = document.getElementById("pm-batch-bar"); if (bb) bb.classList.remove("active");
    const main = document.getElementById("pm-main"); if (main) main.classList.remove("batch-active");
    renderGrid();
};

// === 新增：强制突破缓存的独立云端更新逻辑 (已适配新型分包架构) ===
window.PM_Global.ui.forceUpdateCloud = async function() {
    if (!confirm("确定要强制连接并更新订阅库吗？\n（若网络较差可能需要几秒钟时间，期间请勿操作）")) return;
    UI.updateProgress("正在连接云端...", "穿透缓存获取最新数据，请耐心等待");
    
    try {
        const CLOUD_BASE_URL = "https://fengruol.github.io/ComfyUI-Prompt-CloudDB";
        const t = Date.now(); // 用时间戳强行穿透 GitHub Pages 缓存
        
        // 1. 获取基础架构 system.json
        const sysRes = await fetch(`${CLOUD_BASE_URL}/data/system.json?t=${t}`);
        if (!sysRes.ok) throw new Error("无法连接到云端 system.json");
        const sysText = await sysRes.text();
        const sysJson = JSON.parse(sysText.replace(/\/prompt_data\//g, `${CLOUD_BASE_URL}/data/`));
        
        let cloudModels = sysJson.models || { main_models: {} };
        let cloudContexts = {};
        let cloudImages = {};

        // 2. 收集需要拉取的分包
        let ctxFilesToFetch = [];
        for (let mId in cloudModels.main_models) {
            let mData = cloudModels.main_models[mId];
            if (mData.modes) {
                for (let modId in mData.modes) {
                    ctxFilesToFetch.push(`${mId}_${modId}`);
                }
            }
        }

        // 3. 并发下载分包数据
        const fetchCtx = async (ctxId) => {
            try {
                const res = await fetch(`${CLOUD_BASE_URL}/data/contexts_db/${ctxId}.json?t=${t}`);
                if (res.ok) {
                    const text = await res.text();
                    return { id: ctxId, data: JSON.parse(text.replace(/\/prompt_data\//g, `${CLOUD_BASE_URL}/data/`)) };
                }
            } catch(err) {}
            return null;
        };

        const ctxResults = await Promise.all(ctxFilesToFetch.map(id => fetchCtx(id)));
        ctxResults.forEach(result => {
            if (result && result.data) {
                if (result.data.context) cloudContexts[result.id] = result.data.context;
                if (result.data.images) Object.assign(cloudImages, result.data.images);
            }
        });

        // 4. 无情清理旧的云端数据残留
        for (let mId in STATE.localDB.models.main_models) { if (mId.startsWith('cloud_')) delete STATE.localDB.models.main_models[mId]; }
        for (let ctx in STATE.localDB.contexts) { if (ctx.startsWith('cloud_')) delete STATE.localDB.contexts[ctx]; }
        for (let imgKey in STATE.localDB.images) { if (imgKey.startsWith('cloud_')) delete STATE.localDB.images[imgKey]; }
        
        // 5. 重新注入新鲜拉取的云端数据
        for (let mId in cloudModels.main_models) {
            let cloudModelId = `cloud_${mId}`;
            let mData = cloudModels.main_models[mId];
            mData.name = `[☁️在线] ${mData.name}`;
            mData.isCloud = true;
            STATE.localDB.models.main_models[cloudModelId] = mData;
        }
        for (let ctx in cloudContexts) { STATE.localDB.contexts[`cloud_${ctx}`] = cloudContexts[ctx]; }
        for (let imgKey in cloudImages) { STATE.localDB.images[`cloud_${imgKey}`] = cloudImages[imgKey]; }
        
        UI.hideProgress();
        alert("云端数据强制更新成功！");
        renderModelTabs(); // 立刻刷新左侧栏与页面
    } catch (e) {
        UI.hideProgress();
        alert("更新失败，请检查网络设置或稍后再试！\n报错信息：" + e.message);
    }
};

window.toggleSelectAll = function() {
    const main = document.getElementById("pm-main");
    const cards = main.querySelectorAll(".pm-selectable-card");
    if (cards.length === 0) return;
    
    let visibleSelected = 0;
    cards.forEach(c => { 
        // 修复 Bug 2：全选时必须解码
        const item = decodeURIComponent(c.dataset.item);
        if (STATE.batchSelection.has(`${c.dataset.ctx}||${item}`)) visibleSelected++; 
    });

    if (visibleSelected === cards.length) {
        cards.forEach(c => {
            const item = decodeURIComponent(c.dataset.item);
            STATE.batchSelection.delete(`${c.dataset.ctx}||${item}`);
            c.classList.remove("batch-selected"); // 直接操作 DOM，避免重绘闪烁
        });
    } else {
        cards.forEach(c => {
            const item = decodeURIComponent(c.dataset.item);
            STATE.batchSelection.add(`${c.dataset.ctx}||${item}`);
            c.classList.add("batch-selected");
        });
    }
    document.getElementById("pm-batch-count").innerText = `已选择: ${STATE.batchSelection.size}`;
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
    
    if (!STATE.localDB) STATE.localDB = {};
    if (!STATE.localDB.models) STATE.localDB.models = { main_models: {} };
    if (!STATE.localDB.models.main_models) STATE.localDB.models.main_models = {};

    const models = STATE.localDB.models.main_models;
    
    // === 核心改造：将本地模型和在线模型分开 (并处理云端数据丢失后的遗产打捞) ===
    const localModels = [];
    const cloudModels = [];
    
    for (const [mId, mData] of Object.entries(models)) {
        if (mId.startsWith('cloud_')) {
            cloudModels.push({ id: mId, data: mData });
        } else if (mId.startsWith('fav_cloud_')) {
            // 核心修复：检查它是不是孤儿（原云端库已被开发者删除或改名）
            const originalCloudId = mId.replace('fav_', '');
            if (!models[originalCloudId]) {
                // 这是一个被开发者抛弃的遗留订阅库！将其临时转正为本地库，让用户可以抢救或清理遗产
                let orphanData = JSON.parse(JSON.stringify(mData));
                orphanData.name = orphanData.name.replace('订阅库-', '⚠️[已失效] ');
                localModels.push({ id: mId, data: orphanData });
            }
        } else {
            localModels.push({ id: mId, data: mData });
        }
    }

    if (Object.keys(models).length === 0) {
        tabsContainer.innerHTML = '<span style="color:#666; padding:12px; font-size:12px;">没有任何分类</span>';
    } else {
        if (!STATE.currentModelId || !models[STATE.currentModelId]) {
            STATE.currentModelId = localModels.length > 0 ? localModels[0].id : (cloudModels.length > 0 ? cloudModels[0].id : null);
        }

        // 渲染本地库
        if (localModels.length > 0) {
            const localLabel = document.createElement("span");
            localLabel.style.cssText = "color:#aaa; font-size:12px; margin-right:5px; align-self:center;";
            localLabel.innerText = "💻 本地库:";
            tabsContainer.appendChild(localLabel);

            localModels.forEach(m => createTabElement(m.id, m.data, tabsContainer, true));
        }

        // 添加新建本地一级分类按钮
        const addBtn = document.createElement("button"); 
        addBtn.className = "pm-ctrl-btn"; 
        addBtn.style.display = "block"; addBtn.style.marginLeft = "5px"; addBtn.innerText = "+ 新建";
        addBtn.onclick = () => addModel(); 
        tabsContainer.appendChild(addBtn);

        // 渲染分隔符和云端库
        if (cloudModels.length > 0) {
            const divider = document.createElement("div");
            divider.style.cssText = "width:2px; height:20px; background:#444; margin: 0 15px; align-self:center;";
            tabsContainer.appendChild(divider);

            const cloudLabel = document.createElement("span");
            cloudLabel.style.cssText = "color:#ff6b9d; font-size:12px; margin-right:5px; align-self:center;";
            cloudLabel.innerText = "☁️ 订阅库:";
            tabsContainer.appendChild(cloudLabel);

            cloudModels.forEach(m => createTabElement(m.id, m.data, tabsContainer, false));
        }
    }

    // === UI 净化逻辑 ===
    const container = document.getElementById("pm-native-modal");
    if (container) {
        if (STATE.currentModelId && STATE.currentModelId.startsWith("cloud_")) {
            container.classList.add("is-cloud-mode");
            // 云端模式下，禁止拖拽分类
            container.classList.add("disable-drag");
        } else {
            container.classList.remove("is-cloud-mode");
            container.classList.remove("disable-drag");
        }
    }
    
    renderSidebar();
}

// 辅助函数：创建单个 Tab 元素
function createTabElement(mId, mData, tabsContainer, isLocal) {
    const wrap = document.createElement("div"); 
    wrap.className = `pm-tab-wrap ${mId === STATE.currentModelId ? 'active' : ''}`;
    
    // 只有本地分类允许拖拽排序
    if (isLocal) {
        wrap.draggable = true;
        wrap.ondragstart = (e) => { e.dataTransfer.setData("text/plain", "model_"+mId); e.stopPropagation(); };
        wrap.ondragover = (e) => { e.preventDefault(); wrap.classList.add('pm-drag-over-tab'); };
        wrap.ondragleave = () => { wrap.classList.remove('pm-drag-over-tab'); };
        wrap.ondrop = async (e) => {
            e.preventDefault(); e.stopPropagation(); wrap.classList.remove('pm-drag-over-tab');
            const type_id = e.dataTransfer.getData("text/plain");
            if (type_id.startsWith("model_")) {
                const srcId = type_id.replace("model_", "");
                STATE.localDB.models.main_models = window.PM_Global.utils.reorderObjectKeys(STATE.localDB.models.main_models, srcId, mId);
                await PromptAPI.saveDB(STATE.localDB); renderModelTabs(); window.PM_Global.utils.syncImportNodeWidgets();
            }
        };
    }

    const btn = document.createElement("button"); 
    btn.className = "pm-tab-btn"; 
    // 云端名字里已经自带了 [☁️在线]，所以直接用
    btn.innerText = mData.name || mId;
    btn.onclick = () => { STATE.currentModelId = mId; STATE.currentModeId = null; renderModelTabs(); };
    
    wrap.appendChild(btn);

    // 只有本地分类才显示设置和删除按钮
    if (isLocal) {
        const ctrlGroup = document.createElement("div"); ctrlGroup.className = "pm-ctrl-group";
        const editBtn = document.createElement("button"); editBtn.className = "pm-ctrl-btn"; editBtn.innerText = "设置"; editBtn.onclick = (e) => { e.stopPropagation(); editModel(mId); };
        const delBtn = document.createElement("button"); delBtn.className = "pm-ctrl-btn del"; delBtn.innerText = "删除"; delBtn.onclick = (e) => { e.stopPropagation(); deleteModel(mId); };
        ctrlGroup.appendChild(editBtn); ctrlGroup.appendChild(delBtn);
        wrap.appendChild(ctrlGroup);
    }
    
    tabsContainer.appendChild(wrap);
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

/* =====================================================================
 * UI 模块 4：高性能视图渲染 (Virtual Templating & Event Delegation)
 * ===================================================================== */
function renderGrid() {
    const main = document.getElementById("pm-main");
    const zoomSize = document.getElementById("pm-zoom-slider") ? document.getElementById("pm-zoom-slider").value : 180;
    
    // 初始化 Grid 样式与基础元素
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

    if (allItems.length === 0) {
        main.innerHTML = '<div id="pm-marquee"></div><div style="color:#555; grid-column: 1 / -1; margin-top:10px;">空空如也。</div>';
        return;
    }

    // 排序逻辑
    const sortMode = STATE.sortMode || "name_asc";
    allItems.sort((a, b) => {
        if (sortMode === "name_asc") return a.item.localeCompare(b.item, 'zh-CN');
        if (sortMode === "name_desc") return b.item.localeCompare(a.item, 'zh-CN');
        if (sortMode === "img_first" || sortMode === "img_last") {
            const aHasImg = (STATE.localDB.images[`${a.ctx}_${a.item}`]?.length > 0) ? 1 : 0;
            const bHasImg = (STATE.localDB.images[`${b.ctx}_${b.item}`]?.length > 0) ? 1 : 0;
            if (aHasImg !== bHasImg) return sortMode === "img_first" ? bHasImg - aHasImg : aHasImg - bHasImg;
            return a.item.localeCompare(b.item, 'zh-CN');
        }
        return 0;
    });

    let activePrompts = [];
    if (STATE.currentActiveWidget && STATE.currentActiveWidget.value) {
        activePrompts = UTILS.parsePromptText(STATE.currentActiveWidget.value).map(p => p.tag);
    }

    // [核心优化]：使用大块 HTML 模板字符串，彻底消除逐个创建 DOM 节点的性能损耗
    let htmlChunks = ['<div id="pm-marquee"></div>'];

    allItems.forEach(({ item, ctx }) => {
        const imgKey = `${ctx}_${item}`;
        const imgList = STATE.localDB.images?.[imgKey] || [];
        const isSelectedInBatch = STATE.batchSelection.has(`${ctx}||${item}`);
        const isInWidget = activePrompts.includes(item);
        
        let cardClasses = "pm-card pm-selectable-card";
        if (STATE.isBatchMode && isSelectedInBatch) cardClasses += " batch-selected";
        else if (!STATE.isBatchMode && isInWidget) cardClasses += " in-prompt";

        // 获取真实的 sourceModelId 判断收藏状态
        let sourceModelId = ctx.split('_')[0];
        for (const key of Object.keys(STATE.localDB.models.main_models)) {
            if (ctx.startsWith(key + '_')) { sourceModelId = key; break; }
        }
        
        let localTargetModelId = null;
        if (sourceModelId.startsWith('cloud_')) {
            // 云端卡片直接去它的专属隐形收藏库找状态
            localTargetModelId = "fav_" + sourceModelId;
        } else {
            // 本地卡片就用自己
            localTargetModelId = sourceModelId;
        }
        
        const globalCtxForCard = localTargetModelId ? `${localTargetModelId}_global` : null;
        const inGrp = globalCtxForCard && STATE.localDB.contexts[globalCtxForCard]?.groups?.some(g => g.items.includes(item));

        // 1. 构建图片区域 HTML
        let imgWrapHtml = '';
if (imgList.length > 0) {
            const firstImg = imgList[0];
            const safeFirstImg = UTILS.escapeHTML(firstImg);
            imgWrapHtml = `
                <img src="${safeFirstImg}" loading="lazy" class="pm-action-target" data-action="view-img" style="cursor:zoom-in;">
                <button class="pm-del-img-btn pm-action-target" data-action="del-img" title="删除当前图片">×</button>
            `;
            if (imgList.length > 1) {
                imgWrapHtml += `
                    <button class="pm-nav-arrow left pm-action-target" data-action="prev-img">◀</button>
                    <button class="pm-nav-arrow right pm-action-target" data-action="next-img">▶</button>
                `;
            }
        } else {
            imgWrapHtml = `<div class="pm-no-img">无图 (点上传)</div>`;
        }

        // 2. 构建标签区域 HTML
        const tags = STATE.localDB.contexts[ctx]?.metadata?.[item]?.tags || [];
        let tagsHtml = tags.length === 0 
            ? '<span style="color:#555; font-style:italic;">暂无标签</span>'
            : tags.map(t => `<span class="pm-tag">${UTILS.escapeHTML(t)}</span>`).join('');

        // 3. 构建来源显示 HTML
        let sourceHtml = '';
        if (STATE.searchScope !== "mode") {
            const prefix = STATE.currentModelId + "_";
            const modId = ctx.startsWith(prefix) ? ctx.substring(prefix.length) : ctx.split('_').slice(1).join('_');
            const mName = STATE.localDB.models.main_models[STATE.currentModelId]?.modes[modId]?.name || modId;
            sourceHtml = `<div class="pm-card-source">[${UTILS.escapeHTML(mName)}]</div>`;
        }

// 注入安全字符转义，防止名字中有双引号破坏 HTML 结构
        const safeItem = encodeURIComponent(item);

        htmlChunks.push(`
            <div class="${cardClasses}" data-ctx="${ctx}" data-item="${safeItem}">
                <div class="pm-card-img-wrap" data-img-idx="0">${imgWrapHtml}</div>
                <div class="pm-card-title">${UTILS.escapeHTML(item)}</div>
                ${sourceHtml}
                <div class="pm-card-tags">${tagsHtml}</div>
                <div class="pm-card-actions">
                    <button class="pm-text-btn pm-action-target ${inGrp ? 'warning' : ''}" data-action="fav">${inGrp ? "已收藏" : "收藏"}</button>
                    <button class="pm-text-btn pm-action-target" data-action="upload">上传</button>
                    <button class="pm-text-btn pm-action-target" data-action="edit">编辑</button>
                    <button class="pm-text-btn danger pm-action-target" data-action="delete">删除</button>
                </div>
            </div>
        `);
    });

    // 一次性渲染到页面中 (避免无数次重排回流)
    main.innerHTML = htmlChunks.join('');
    
    // [核心优化]：绑定唯一的事件委托监听器 (代替原来每个卡片绑定 5 个 onClick 的灾难设计)
    if (!main.dataset.delegated) {
        main.dataset.delegated = "true";
        main.addEventListener('click', handleGridClick);
    }
}

/* =====================================================================
 * 辅助模块：事件委托中心 (捕获网格区的所有点击事件)
 * ===================================================================== */
async function handleGridClick(e) {
    // 1. 如果点击的是卡片内的某个功能按钮/图片
    const actionTarget = e.target.closest('.pm-action-target');
    if (actionTarget) {
        e.stopPropagation();
        const action = actionTarget.dataset.action;
        const card = actionTarget.closest('.pm-selectable-card');
        if (!card) return;

        const ctx = card.dataset.ctx;
        const item = decodeURIComponent(card.dataset.item);
        const imgKey = `${ctx}_${item}`;
        const imgList = STATE.localDB.images?.[imgKey] || [];
        const imgWrap = card.querySelector('.pm-card-img-wrap');
        let currentImgIdx = imgWrap ? parseInt(imgWrap.dataset.imgIdx || "0") : 0;

        if (action === 'view-img' && !STATE.isBatchMode) {
            document.getElementById('pm-viewer-img').src = imgList[currentImgIdx];
            window.pmShowModal("pm-image-viewer");
        } else if (action === 'del-img') {
            if (confirm("仅彻底删除当前显示的这张图片？")) {
                await PromptAPI.deleteFile(imgList[currentImgIdx]); 
                imgList.splice(currentImgIdx, 1);
                STATE.localDB.images[imgKey] = imgList; 
                await PromptAPI.saveDB(STATE.localDB); 
                renderGrid();
            }
        } else if (action === 'prev-img' || action === 'next-img') {
            currentImgIdx = action === 'prev-img' 
                ? (currentImgIdx - 1 + imgList.length) % imgList.length 
                : (currentImgIdx + 1) % imgList.length;
            imgWrap.dataset.imgIdx = currentImgIdx;
            imgWrap.querySelector('img').src = imgList[currentImgIdx];
        } else if (action === 'fav') {
            window.PM_Global.ui.openGroupSelectModal(item, ctx);
        } else if (action === 'upload') {
            STATE.currentAppendTarget = { item, ctx }; 
            document.getElementById("pm-hidden-append-img").click();
        } else if (action === 'edit') {
            window.openEditCardModal(item, ctx);
        } else if (action === 'delete') {
            if (confirm(`彻底删除 [ ${item} ]？`)) await deleteCardDirect(item, ctx);
        }
        return; // 处理完按钮事件后退出，不再触发外层卡片逻辑
    }

    // 2. 如果点击的是卡片本体空白区域 (添加词条 / 批量选中)
    const card = e.target.closest('.pm-selectable-card');
    if (card) {
        const ctx = card.dataset.ctx;
        const item = decodeURIComponent(card.dataset.item);
        
        if (STATE.isBatchMode) {
            if (window._isDraggingMarquee) return;
            const batchKey = `${ctx}||${item}`;
            if (STATE.batchSelection.has(batchKey)) {
                STATE.batchSelection.delete(batchKey);
                card.classList.remove("batch-selected");
            } else {
                STATE.batchSelection.add(batchKey);
                card.classList.add("batch-selected");
            }
            document.getElementById("pm-batch-count").innerText = `已选择: ${STATE.batchSelection.size}`;
        } else {
            if (!STATE.currentActiveWidget) return;
            let p = UTILS.parsePromptText(STATE.currentActiveWidget.value);
            const idx = p.findIndex(x => x.tag === item);
            if (idx !== -1) {
                p.splice(idx, 1);
                card.classList.remove("in-prompt");
            } else {
                p.push({ original: item, tag: item, weight: 1.0, enabled: true });
                card.classList.add("in-prompt");
            }
            STATE.currentActiveWidget.value = UTILS.buildPromptText(p); 
            app.graph.setDirtyCanvas(true);
        }
    }
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
        let promptName = files[i].name.replace(/\.[^/.]+$/, "").trim(); 
        try { promptName = decodeURIComponent(promptName); } catch(e) {}
        promptName = window.PM_Global.utils.normalizePromptName(promptName);
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
            val = window.PM_Global.utils.normalizePromptName(val);
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
            // 修复 Bug 1：框选时强制解码，杜绝 %20 乱码写入数据库
            const decodedItem = decodeURIComponent(card.dataset.item);
            const batchKey = `${card.dataset.ctx}||${decodedItem}`;
            
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
                    // 修复：仅抽取一次盲盒，不再强行拦截拆分批次队列
                    const targetNodes = app.graph._nodes.filter(n => n.type === "PromptBrowserNode" || n.type === "PromptGroupRandomizerNode");
                    for (const node of targetNodes) {
                        const autoWidget = node.widgets?.find(w => w.name === "自动随机抽取");
                        if (autoWidget && autoWidget.value) {
                            const randomBtn = node.widgets?.find(w => w.name === "random" || w.name === "随机抽取" || w.name === "draw_blind_box" || w.name === "抽取盲盒");
                            if (randomBtn && randomBtn.callback) await randomBtn.callback();
                        }
                    }
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
                    const selected = UTILS.pmShuffle(dataItems).slice(0, count);
                    
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