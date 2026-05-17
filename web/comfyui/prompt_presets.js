/* =====================================================================
 * [AI System Prompt / Do Not Modify]
 * FILE: prompt_presets.js
 * DESC: Handles Collections (Groups), Combo Presets, and their UI/Logic.
 * ROLE: Manages specialized modals and drag-and-drop ordering for groups and combos. Registers the Randomizer and Combo Loader node behaviors.
 * 
 * [User Info / 可由用户自行修改]
 * 文件：prompt_presets.js
 * 作用：“收藏夹分组”与“组合预设”的专用管理模块。包含这两个功能的界面渲染、数据增删改、排序逻辑，以及对应的两个自定义节点的拦截器。
 * ===================================================================== */

import { app } from "../../scripts/app.js";
import { PromptAPI } from "./prompt_api.js";

window.PM_Global = window.PM_Global || { state: {}, utils: {}, ui: {} };
const STATE = window.PM_Global.state;
const UTILS = window.PM_Global.utils;
const UI = window.PM_Global.ui;

function getCtxData(ctx) {
    if (!STATE.localDB.contexts[ctx]) STATE.localDB.contexts[ctx] = { items: [], metadata: {}, cart: [], groups: [], combos: [] };
    if (!STATE.localDB.contexts[ctx].groups) STATE.localDB.contexts[ctx].groups = [];
    if (!STATE.localDB.contexts[ctx].combos) STATE.localDB.contexts[ctx].combos = [];
    return STATE.localDB.contexts[ctx];
}

// === 核心改造：独立隐藏的订阅库专属容器 ===
// 作用：为每个订阅库创建独立的本地存储容器（以 fav_ 开头），实现互不干扰。并且利用特殊ID在前端UI中隐身。
async function getLocalTwinModelId(currentModelId) {
    if (!currentModelId) return null;
    if (!currentModelId.startsWith('cloud_')) return currentModelId;

    const favId = "fav_" + currentModelId; // 专属隐形容器ID，例如 fav_cloud_A

    if (!STATE.localDB.models.main_models[favId]) {
        const cloudModelName = STATE.localDB.models.main_models[currentModelId]?.name.replace('[☁️在线] ', '').trim() || "未知订阅库";
        // 修复：后台注册名字绝不能包含方括号，否则会破坏节点正则匹配
        STATE.localDB.models.main_models[favId] = { 
            name: `订阅库-${cloudModelName}`, 
            categories: [], 
            modes: {} 
        };
        await PromptAPI.saveDB(STATE.localDB);
    }
    return favId;
}

window.PM_Global.utils.getLocalTwinModelId = getLocalTwinModelId;

// ==========================================
// 1. 收藏夹分组管理 API
// ==========================================
// === 附加排序逻辑 ===
window.PM_Global.ui.openGroupsModal = async function() {
    // 使用同名映射逻辑
    let targetModelId = await getLocalTwinModelId(STATE.currentModelId);
    
    if (!targetModelId) {
        // 如果当前没有任何选中项的兜底方案
        for (const key of Object.keys(STATE.localDB.models.main_models)) {
            if (!key.startsWith('cloud_')) { targetModelId = key; break; }
        }
        if (!targetModelId) return alert("请先在本地新建一个一级分类！");
    }

    const ctx = `${targetModelId}_global`;
    STATE.currentManageCtx = ctx; 
    const d = getCtxData(ctx);

    let modal = document.getElementById("pm-groups-modal");
    if (!modal) {
        modal = document.createElement("div"); modal.id = "pm-groups-modal"; modal.className = "pm-modal-overlay"; 
        modal.innerHTML = `
            <div class="pm-create-box" style="width: 750px; height: 80vh;">
                <div class="pm-create-header">
                    <b style="color:#eee;">收藏夹管理 (本地存储)</b>
                    <button class="pm-close-btn" onclick="pmHideModal('pm-groups-modal')">关闭</button>
                </div>
                <div class="pm-create-content" style="display:flex; flex-direction:column; height: 100%; padding:0;">
                    <div style="padding:15px; border-bottom:1px solid #333; background:#1a1a1a;">
                        <div style="display:flex; gap:10px;">
                            <input type="text" id="pm-new-grp-name" class="pm-search-input" placeholder="输入新分组名称...">
                            <button class="pm-action-btn primary" onclick="PM_Global.ui.createNewGroup()">新建分组</button>
                            <button class="pm-action-btn" onclick="PM_Global.ui.exportGroups()">导出配置</button>
                            <button class="pm-action-btn" onclick="document.getElementById('pm-import-groups-file').click()">导入配置</button>
                        </div>
                        <input type="file" id="pm-import-groups-file" accept=".json" style="display:none;" onchange="PM_Global.ui.importGroups(event)">
                    </div>
                    <div id="pm-groups-content" style="flex:1; overflow-y:auto; padding:15px; background:#111;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal); 
    }
    
    const content = document.getElementById("pm-groups-content");
    if (d.groups.length === 0) content.innerHTML = `<div style="color:#555; text-align:center; padding:50px;">当前本地模型下没有收藏分组。</div>`;
    else content.innerHTML = '';

    d.groups.forEach((g, idx) => {
        const div = document.createElement("div"); 
        div.className = "pm-list-item";
        div.style.transition = "border 0.2s";
        
        // 增加拖拽排序逻辑
        div.draggable = true;
        div.ondragstart = (e) => { e.dataTransfer.setData("text/plain", idx); e.stopPropagation(); };
        div.ondragover = (e) => { e.preventDefault(); div.style.borderColor = "#ff6b9d"; };
        div.ondragleave = (e) => { div.style.borderColor = "#333"; };
        div.ondrop = async (e) => {
            e.preventDefault(); e.stopPropagation(); div.style.borderColor = "#333";
            const srcIdx = parseInt(e.dataTransfer.getData("text/plain"));
            if (srcIdx !== idx && !isNaN(srcIdx)) {
                const arr = getCtxData(ctx).groups;
                const [moved] = arr.splice(srcIdx, 1);
                arr.splice(idx, 0, moved);
                await PromptAPI.saveDB(STATE.localDB);
                window.PM_Global.ui.openGroupsModal();
                UTILS.syncImportNodeWidgets();
            }
        };

        div.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:center; padding-right:15px; color:#555; cursor:grab; font-size:18px;" title="拖拽排序">☰</div>
            <div style="flex:1;">
                <b style="color:#ff6b9d; font-size:16px;">${UTILS.escapeHTML(g.name)}</b>
                <div style="color:#888; font-size:12px; margin-top:5px;">包含 ${g.items.length} 张卡片</div>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="pm-action-btn" style="color:#4caf50; border-color:#1e3e1e;" onclick="PM_Global.ui.openGroupDetail(${idx}, '${ctx}')">查看内页</button>
                <button class="pm-text-btn danger" onclick="PM_Global.ui.deleteGroup(${idx}, '${ctx}')">删除</button>
            </div>
        `;
        content.appendChild(div);
    });
    window.pmShowModal("pm-groups-modal");
};

window.PM_Global.ui.createNewGroup = async function() {
    const ctx = STATE.currentManageCtx; // 动态获取当前激活的全局上下文
    const val = document.getElementById("pm-new-grp-name").value.trim();
    if (!val) return alert("请输入名称！");
    getCtxData(ctx).groups.unshift({ name: val, items: [] });
    await PromptAPI.saveDB(STATE.localDB); window.PM_Global.ui.openGroupsModal();
};

window.PM_Global.ui.deleteGroup = async function(idx, ctx) {
    if (confirm("删除此分组？(组内的卡片将保留在总库中)")) {
        getCtxData(ctx).groups.splice(idx, 1); await PromptAPI.saveDB(STATE.localDB); 
        window.PM_Global.ui.openGroupsModal(); 
        if (window.PM_Global.ui.renderGrid) window.PM_Global.ui.renderGrid();
    }
};

window.PM_Global.ui.openGroupDetail = function(idx, ctx) {
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
    
    let activePrompts = [];
    if (STATE.currentActiveWidget && STATE.currentActiveWidget.value) {
        activePrompts = UTILS.parsePromptText(STATE.currentActiveWidget.value).map(p => p.tag);
    }
    
    g.items.forEach(item => {
        // 核心修复：图片存在于原卡片的三级分类里，而不是 global 里，需要全局检索此卡片的图片
        let imgList = [];
        for (const realCtx of Object.keys(STATE.localDB.contexts)) {
            if (realCtx.endsWith('_global')) continue;
            const possibleImgKey = `${realCtx}_${item}`;
            if (STATE.localDB.images[possibleImgKey] && STATE.localDB.images[possibleImgKey].length > 0) {
                imgList = STATE.localDB.images[possibleImgKey];
                break; // 找到对应的图就立刻停止搜索
            }
        }

        const card = document.createElement("div"); card.className = "pm-card pm-selectable-card";
        
        if (activePrompts.includes(item)) {
            card.classList.add("in-prompt");
        }
        
let imgHtml = imgList.length > 0 ? `<img src="${UTILS.escapeHTML(imgList[0])}">` : `<div class="pm-no-img">暂无图片</div>`;
        const safeItem = UTILS.escapeHTML(item);
        const safeItemForEvent = encodeURIComponent(item);
        card.innerHTML = `
            <div class="pm-card-img-wrap" style="cursor:pointer;">
                ${imgHtml}
            </div>
            <div class="pm-card-title">${safeItem}</div>
            <div class="pm-card-actions" style="justify-content:center; padding-top:6px;">
                <button class="pm-text-btn danger" onclick="event.stopPropagation(); PM_Global.ui.removeCardFromGroup(${idx}, decodeURIComponent('${safeItemForEvent}'), '${ctx}')">移出该分组</button>
            </div>
        `;
        
        if (imgList.length > 0) {
            const imgEl = card.querySelector('img');
            imgEl.onclick = (e) => {
                e.stopPropagation();
                document.getElementById('pm-viewer-img').src = imgList[0];
                window.pmShowModal('pm-image-viewer');
            };
        }

        card.onclick = () => {
            if (!STATE.currentActiveWidget) return alert("当前未绑定激活的 Prompt 浏览器节点！请先打开某个节点的浏览器。");
            let p = UTILS.parsePromptText(STATE.currentActiveWidget.value);
            const pIdx = p.findIndex(x => x.tag === item);
            if (pIdx !== -1) {
                p.splice(pIdx, 1);
                card.classList.remove("in-prompt");
            } else {
                p.push({ original: item, tag: item, weight: 1.0, enabled: true });
                card.classList.add("in-prompt");
            }
            STATE.currentActiveWidget.value = UTILS.buildPromptText(p);
            app.graph.setDirtyCanvas(true);
            if (window.PM_Global.ui.renderGrid) window.PM_Global.ui.renderGrid();
        };

        grid.appendChild(card);
    });
    window.pmShowModal("pm-group-detail-modal");
};

window.PM_Global.ui.removeCardFromGroup = async function(gIdx, item, ctx) {
    const g = getCtxData(ctx).groups[gIdx];
    g.items = g.items.filter(x => x !== item);
    await PromptAPI.saveDB(STATE.localDB);
    window.PM_Global.ui.openGroupDetail(gIdx, ctx); 
    if (window.PM_Global.ui.renderGrid) window.PM_Global.ui.renderGrid();
};

window.PM_Global.ui.exportGroups = function() {
    const ctx = STATE.currentManageCtx;
    const groups = getCtxData(ctx).groups || [];
    if(groups.length === 0) return alert("无分组可导出！");
    const data = { type: "pm_groups", data: groups };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `Prompt_Groups_${ctx}_${Date.now()}.json`; a.click();
};

window.PM_Global.ui.importGroups = function(e) {
    const ctx = STATE.currentManageCtx;
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const json = JSON.parse(ev.target.result);
            if(json.type !== "pm_groups" || !Array.isArray(json.data)) throw new Error("无效的分组文件格式");
            const targetGroups = getCtxData(ctx).groups;
            json.data.forEach(g => {
                const existing = targetGroups.find(x => x.name === g.name);
                if(existing) existing.items = [...new Set([...existing.items, ...g.items])]; else targetGroups.push(g);
            });
            await PromptAPI.saveDB(STATE.localDB); window.PM_Global.ui.openGroupsModal(); alert(`导入 ${json.data.length} 个收藏分组成功！`);
        } catch(err) { alert("导入失败：" + err.message); }
        e.target.value = '';
    };
    reader.readAsText(file);
};

// ==========================================
// 2. 组合预设管理 API
// ==========================================
// === 附加排序逻辑 ===
window.PM_Global.ui.openCombosModal = async function() {
    // 使用同名映射逻辑
    let targetModelId = await getLocalTwinModelId(STATE.currentModelId);
    
    if (!targetModelId) {
        // 如果当前没有任何选中项的兜底方案
        for (const key of Object.keys(STATE.localDB.models.main_models)) {
            if (!key.startsWith('cloud_')) { targetModelId = key; break; }
        }
        if (!targetModelId) return alert("请先在本地新建一个一级分类！");
    }

    const ctx = `${targetModelId}_global`;
    STATE.currentManageCtx = ctx; 
    const d = getCtxData(ctx);

    let modal = document.getElementById("pm-combos-modal");
    if (!modal) {
        modal = document.createElement("div"); modal.id = "pm-combos-modal"; modal.className = "pm-modal-overlay"; 
        modal.innerHTML = `
            <div class="pm-create-box" style="width: 800px; height: 80vh;">
                <div class="pm-create-header">
                    <b style="color:#eee;">组合预设管理 (本地存储)</b>
                    <button class="pm-close-btn" onclick="pmHideModal('pm-combos-modal')">关闭</button>
                </div>
                <div class="pm-create-content" style="display:flex; flex-direction:column; height: 100%; padding:0;">
                    <div style="padding:15px; border-bottom:1px solid #333; background:#1a1a1a; display:flex; gap:10px;">
                        <button class="pm-action-btn primary" style="flex:1;" onclick="PM_Global.ui.createNewCombo()">创建新组合</button>
                        <button class="pm-action-btn" onclick="PM_Global.ui.exportCombos()">导出配置(含图)</button>
                        <button class="pm-action-btn" onclick="document.getElementById('pm-import-combos-file').click()">导入配置</button>
                        <input type="file" id="pm-import-combos-file" accept=".json" style="display:none;" onchange="PM_Global.ui.importCombos(event)">
                    </div>
                    <div id="pm-combos-content" style="flex:1; overflow-y:auto; padding:15px; padding-bottom: 80px; background:#111; box-sizing: border-box;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.id = "pm-hidden-combo-img"; fileInput.accept = "image/*"; fileInput.style.display = "none";
        document.body.appendChild(fileInput);
        fileInput.onchange = async (e) => {
            if (e.target.files.length > 0 && STATE.currentComboEditIdx !== null) {
                UI.updateProgress("上传组合预览图...", "请稍候");
                const currentCtx = STATE.currentManageCtx;
                const compRate = STATE.localDB.settings?.compress_rate ?? 0.85;
                const maxWidth = STATE.localDB.settings?.max_width ?? 900;
                const base64 = await UTILS.compressImage(e.target.files[0], maxWidth, compRate);
                const hash = UTILS.cyrb53(base64);
                const url = await PromptAPI.uploadImage(base64, `combo_${hash}.jpg`, currentCtx);
                
                if (url) {
                    if (STATE.currentComboEditIdx === -1) {
                        if (STATE.tempCombo.image) { try { await PromptAPI.deleteFile(STATE.tempCombo.image); } catch(err){} }
                        STATE.tempCombo.image = url;
                        window.PM_Global.ui.openComboEditModal(-1, currentCtx);
                    } else {
                        const cbs = STATE.localDB.contexts[currentCtx].combos;
                        const oldImg = cbs[STATE.currentComboEditIdx].image;
                        if (oldImg) { try { await PromptAPI.deleteFile(oldImg); } catch(err){} }
                        cbs[STATE.currentComboEditIdx].image = url;
                        await PromptAPI.saveDB(STATE.localDB); 
                        window.PM_Global.ui.openComboEditModal(STATE.currentComboEditIdx, currentCtx); 
                        window.PM_Global.ui.openCombosModal();
                    }
                }
                UI.hideProgress();
            }
            e.target.value = '';
        };
    }
    
    const content = document.getElementById("pm-combos-content");
    if (d.combos.length === 0) content.innerHTML = `<div style="color:#555; text-align:center; padding:50px;">暂无组合预设。</div>`;
    else content.innerHTML = '';

    d.combos.forEach((c, idx) => {
        const div = document.createElement("div"); 
        div.className = "pm-combo-card";
        div.style.transition = "border 0.2s";
        
        div.draggable = true;
        div.ondragstart = (e) => { e.dataTransfer.setData("text/plain", idx); e.stopPropagation(); };
        div.ondragover = (e) => { e.preventDefault(); div.style.borderColor = "#ff6b9d"; };
        div.ondragleave = (e) => { div.style.borderColor = "#333"; };
        div.ondrop = async (e) => {
            e.preventDefault(); e.stopPropagation(); div.style.borderColor = "#333";
            const srcIdx = parseInt(e.dataTransfer.getData("text/plain"));
            if (srcIdx !== idx && !isNaN(srcIdx)) {
                const arr = getCtxData(ctx).combos;
                const [moved] = arr.splice(srcIdx, 1);
                arr.splice(idx, 0, moved);
                await PromptAPI.saveDB(STATE.localDB);
                window.PM_Global.ui.openCombosModal();
                UTILS.syncImportNodeWidgets();
            }
        };

const imgUrl = c.image ? c.image : ''; // 移除时间戳
        const safeImgUrl = UTILS.escapeHTML(imgUrl);
        const safeImgUrlForEvent = encodeURIComponent(imgUrl);
        const imgHtml = c.image ? `<img src="${safeImgUrl}" style="width:100px; height:100px; object-fit:cover; border-radius:8px; cursor:pointer;" onclick="document.getElementById('pm-viewer-img').src=decodeURIComponent('${safeImgUrlForEvent}'); pmShowModal('pm-image-viewer');">` : `<div style="width:100px; height:100px; background:#222; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#444; font-size:12px;">无预览图</div>`;
        const promptStr = c.elements.map(e => e.weight != 1 ? `(${e.tag}:${e.weight})` : e.tag).join(', ');

        div.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:center; padding-right:5px; color:#555; cursor:grab; font-size:18px;" title="拖拽排序">☰</div>
            ${imgHtml}
            <div style="flex:1; display:flex; flex-direction:column; justify-content:center;">
                <b style="color:#ff6b9d; font-size:16px; margin-bottom:5px;">${UTILS.escapeHTML(c.name)}</b>
                <div style="color:#888; font-size:12px; line-height:1.4; max-height:40px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${UTILS.escapeHTML(promptStr) || '暂无标签...'}</div>
            </div>
            <div style="display:flex; flex-direction:column; justify-content:center; gap:8px; min-width:110px;">
                <button class="pm-action-btn" style="color:#fff; padding:6px 10px; font-size:12px;" onclick="PM_Global.ui.exportComboToBrowser(${idx}, '${ctx}')">导至节点</button>
                <button class="pm-action-btn" style="padding:6px 10px; font-size:12px;" onclick="PM_Global.ui.openComboEditModal(${idx}, '${ctx}')">编辑</button>
                <button class="pm-action-btn" style="color:#f44336; border-color:#5a1a1a; padding:6px 10px; font-size:12px;" onclick="PM_Global.ui.deleteCombo(${idx}, '${ctx}')">删除</button>
            </div>
        `;
        content.appendChild(div);
    });
    window.pmShowModal("pm-combos-modal");
};

window.PM_Global.ui.createNewCombo = async function() {
    const ctx = STATE.currentManageCtx; // 动态获取当前激活的全局上下文
    STATE.currentComboEditIdx = -1; 
    STATE.tempCombo = { name: "新组合预设_" + Date.now(), elements: [], image: null };
    window.PM_Global.ui.openComboEditModal(-1, ctx);
};

// 修复：处理点击取消时的清理垃圾文件逻辑（移除丢失的引用函数）
window.PM_Global.ui.cancelComboEdit = async function() {
    if (STATE.currentComboEditIdx === -1 && STATE.tempCombo && STATE.tempCombo.image) {
        try { await PromptAPI.deleteFile(STATE.tempCombo.image); } catch(e) { console.warn(e); }
    }
    STATE.tempCombo = null;
    window.pmHideModal('pm-combo-edit-modal');
};

window.PM_Global.ui.openComboEditModal = function(idx, ctx) {
    const c = idx === -1 ? STATE.tempCombo : getCtxData(ctx).combos[idx]; 
    STATE.currentComboEditIdx = idx;
    let modal = document.getElementById("pm-combo-edit-modal");
    if (!modal) { 
        modal = document.createElement("div"); modal.id = "pm-combo-edit-modal"; modal.className = "pm-modal-overlay"; modal.style.zIndex="20002"; 
        modal.innerHTML = `
            <div class="pm-create-box" style="width: 500px;">
                <div class="pm-create-header" id="pm-cedit-header"></div>
                <div class="pm-create-content" id="pm-cedit-content"></div>
            </div>
        `;
        document.body.appendChild(modal); 
    }
    
    const header = document.getElementById("pm-cedit-header");
    if (idx === -1) {
        header.innerHTML = `
            <b style="color:#ff6b9d;">创建新组合</b>
            <div style="display:flex; gap:10px;">
                <button class="pm-action-btn primary" style="padding:4px 12px;" onclick="PM_Global.ui.confirmCreateCombo('${ctx}')">确定并创建</button>
                <button class="pm-close-btn" onclick="PM_Global.ui.cancelComboEdit()">取消</button>
            </div>
        `;
    } else {
        header.innerHTML = `
            <b style="color:#ff6b9d;">编辑组合: ${UTILS.escapeHTML(c.name)}</b>
            <button class="pm-close-btn" onclick="pmHideModal('pm-combo-edit-modal')">返回</button>
        `;
    }

    const imgUrl = c.image ? c.image : ''; // 移除时间戳
    let imgArea = c.image ? `<img src="${UTILS.escapeHTML(imgUrl)}" style="width:100%; height:200px; object-fit:contain; border-radius:8px; cursor:pointer;" onclick="document.getElementById('pm-hidden-combo-img').click()">` : `<div style="width:100%; height:200px; background:#111; border:1px dashed #444; border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:#777;" onclick="document.getElementById('pm-hidden-combo-img').click()">点击上传预览图</div>`;

    // 核心保护：把特殊字符转义防止切断 HTML 属性
    const safeName = UTILS.escapeHTML(c.name);
    document.getElementById("pm-cedit-content").innerHTML = `
        <input type="text" class="pm-search-input" style="width:100%; margin-bottom:15px; font-weight:bold; font-size:14px;" value="${safeName}" onchange="PM_Global.ui.updateComboName(${idx}, '${ctx}', this.value)">
        ${imgArea}
        <div style="margin: 15px 0 5px 0; color:#888; font-size:12px; display:flex; justify-content:space-between; align-items:center;">
            <span>组合标签列表：</span>
            <button class="pm-action-btn" style="padding:4px 8px; font-size:11px;" onclick="PM_Global.ui.importNodeToCombo(${idx}, '${ctx}')">从节点列表导入</button>
        </div>
        <div id="pm-combo-edit-elements" style="background:#111; padding:10px; border-radius:8px; border:1px solid #333; max-height:200px; overflow-y:auto;"></div>
        <button class="pm-add-btn" style="width:100%; margin-top:10px;" onclick="PM_Global.ui.addComboElement(${idx}, '${ctx}')">新增一行标签</button>
    `;

    const elContainer = document.getElementById("pm-combo-edit-elements");
    if (c.elements.length === 0) elContainer.innerHTML = `<div style="color:#555; text-align:center;">暂无标签，请添加。</div>`;
    c.elements.forEach((el, elIdx) => {
        const elDiv = document.createElement("div"); elDiv.style.display = "flex"; elDiv.style.gap = "8px"; elDiv.style.marginBottom = "8px";
        const safeTag = UTILS.escapeHTML(el.tag);
        elDiv.innerHTML = `
            <input type="text" class="pm-search-input" style="flex:3; padding:6px 10px;" value="${safeTag}" onchange="PM_Global.ui.updateComboEl(${idx}, ${elIdx}, 'tag', this.value, '${ctx}')">
            <input type="number" step="0.1" class="pm-search-input" style="flex:1; padding:6px 10px;" value="${el.weight || 1}" onchange="PM_Global.ui.updateComboEl(${idx}, ${elIdx}, 'weight', this.value, '${ctx}')">
            <button class="pm-text-btn danger" onclick="PM_Global.ui.removeComboEl(${idx}, ${elIdx}, '${ctx}')">删除</button>
        `;
        elContainer.appendChild(elDiv);
    });
    window.pmShowModal("pm-combo-edit-modal");
};

window.PM_Global.ui.confirmCreateCombo = async function(ctx) {
    if (!STATE.tempCombo.name.trim()) return alert("名称不能为空！");
    STATE.localDB.contexts[ctx].combos.unshift(STATE.tempCombo);
    STATE.tempCombo = null;
    await PromptAPI.saveDB(STATE.localDB);
    window.pmHideModal('pm-combo-edit-modal');
    window.PM_Global.ui.openCombosModal();
};

window.PM_Global.ui.updateComboName = async function(idx, ctx, val) { 
    if (idx === -1) { STATE.tempCombo.name = val; return; }
    STATE.localDB.contexts[ctx].combos[idx].name = val; 
    await PromptAPI.saveDB(STATE.localDB); window.PM_Global.ui.openCombosModal(); 
};
window.PM_Global.ui.addComboElement = async function(idx, ctx) { 
    if (idx === -1) { STATE.tempCombo.elements.push({ tag: "新标签", weight: 1 }); window.PM_Global.ui.openComboEditModal(idx, ctx); return; }
    STATE.localDB.contexts[ctx].combos[idx].elements.push({ tag: "新标签", weight: 1 }); 
    await PromptAPI.saveDB(STATE.localDB); window.PM_Global.ui.openComboEditModal(idx, ctx); window.PM_Global.ui.openCombosModal(); 
};
window.PM_Global.ui.updateComboEl = async function(cIdx, eIdx, field, val, ctx) { 
    if (cIdx === -1) { STATE.tempCombo.elements[eIdx][field] = val; return; }
    STATE.localDB.contexts[ctx].combos[cIdx].elements[eIdx][field] = val; 
    await PromptAPI.saveDB(STATE.localDB); window.PM_Global.ui.openCombosModal(); 
};
window.PM_Global.ui.removeComboEl = async function(cIdx, eIdx, ctx) { 
    if (cIdx === -1) { STATE.tempCombo.elements.splice(eIdx, 1); window.PM_Global.ui.openComboEditModal(cIdx, ctx); return; }
    STATE.localDB.contexts[ctx].combos[cIdx].elements.splice(eIdx, 1); 
    await PromptAPI.saveDB(STATE.localDB); window.PM_Global.ui.openComboEditModal(cIdx, ctx); window.PM_Global.ui.openCombosModal(); 
};
window.PM_Global.ui.importNodeToCombo = async function(idx, ctx) {
    let textToImport = "";
    if (STATE.currentActiveWidget && STATE.currentActiveWidget.value) textToImport = STATE.currentActiveWidget.value;
    else {
        const browserNode = app.graph._nodes.find(n => n.type === "PromptBrowserNode");
        if (browserNode) { const w = browserNode.widgets?.find(w => w.name === "prompt_text" || w.name === "输入prompt"); if (w) textToImport = w.value; }
    }
    if (!textToImport.trim()) return alert("节点列表中暂无 Prompt，请先在节点中添加！");
    const parsed = UTILS.parsePromptText(textToImport);
    const combo = idx === -1 ? STATE.tempCombo : STATE.localDB.contexts[ctx].combos[idx];
    let addedCount = 0;
    parsed.forEach(p => { if (!combo.elements.some(e => e.tag === p.tag)) { combo.elements.push({ tag: p.tag, weight: p.weight }); addedCount++; } });
    if (addedCount > 0) { 
        if (idx !== -1) { await PromptAPI.saveDB(STATE.localDB); window.PM_Global.ui.openCombosModal(); }
        window.PM_Global.ui.openComboEditModal(idx, ctx); 
    } 
    else alert("节点列表中的标签已全部存在于当前组合中！");
};
window.PM_Global.ui.deleteCombo = async function(idx, ctx) {
    if (confirm("彻底删除这个组合预设吗？")) {
        const c = STATE.localDB.contexts[ctx].combos[idx];
        if (c.image) await PromptAPI.deleteFile(c.image);
        STATE.localDB.contexts[ctx].combos.splice(idx, 1); await PromptAPI.saveDB(STATE.localDB); window.PM_Global.ui.openCombosModal();
    }
};

// （已删除导致冲突的重复定义代码块）

window.PM_Global.ui.exportComboToBrowser = function(idx, ctx) {
    const c = STATE.localDB.contexts[ctx].combos[idx];
    const promptStr = c.elements.map(e => e.weight != 1 ? `(${e.tag}:${e.weight})` : e.tag).join(', ');
    if (!promptStr) return alert("组合为空！");
    let targetWidget = STATE.currentActiveWidget;
    if (!targetWidget) {
        const browserNode = app.graph._nodes.find(n => n.type === "PromptBrowserNode");
        if (browserNode) targetWidget = browserNode.widgets?.find(w => w.name === "prompt_text" || w.name === "输入prompt");
    }
    if (targetWidget) {
        let currentVal = targetWidget.value || "";
        if (currentVal && !currentVal.endsWith(",") && !currentVal.endsWith(", ")) currentVal += ", ";
        targetWidget.value = currentVal + promptStr;
        app.graph.setDirtyCanvas(true); alert("成功导出组合到 Prompt 浏览器节点中！");
    } else alert("找不到 Prompt 浏览器节点！请先在画布上创建一个。");
};

window.PM_Global.ui.exportCombos = async function() {
    const ctx = STATE.currentManageCtx;
    const combos = getCtxData(ctx).combos || [];
    if(combos.length === 0) return alert("当前无组合可导出！");
    UI.updateProgress("打包数据...", "处理图片...");
    let exportList = [];
    for(const c of combos) {
        let imgData = null;
        if(c.image && c.image.startsWith("/prompt_data/")) { try { imgData = await UTILS.urlToBase64(c.image); } catch(err) {} }
        exportList.push({ name: c.name, elements: c.elements, image: imgData });
    }
    const data = { type: "pm_combos", data: exportList };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `Prompt_Combos_${ctx}_${Date.now()}.json`; a.click();
    UI.hideProgress();
};

window.PM_Global.ui.importCombos = function(e) {
    const ctx = STATE.currentManageCtx;
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const json = JSON.parse(ev.target.result);
            if(json.type !== "pm_combos" || !Array.isArray(json.data)) throw new Error("无效的组合文件格式");
            UI.updateProgress("导入组合...", "还原图片...");
            const targetCombos = getCtxData(ctx).combos;
            for(const c of json.data) {
                let finalImg = null;
                if(c.image && c.image.startsWith("data:image/")) {
                    const safeName = "cb_img_" + UTILS.cyrb53(c.image) + "_" + Date.now();
                    finalImg = await PromptAPI.uploadImage(c.image, `${safeName}.jpg`, ctx);
                }
                const existing = targetCombos.find(x => x.name === c.name);
                if(existing) { existing.elements = c.elements; if(finalImg) existing.image = finalImg; } 
                else targetCombos.push({ name: c.name, elements: c.elements, image: finalImg });
            }
            await PromptAPI.saveDB(STATE.localDB); window.PM_Global.ui.openCombosModal(); UI.hideProgress(); alert(`导入 ${json.data.length} 个组合成功！`);
        } catch(err) { UI.hideProgress(); alert("导入失败：" + err.message); }
        e.target.value = '';
    };
    reader.readAsText(file);
};

// ==========================================
// 3. 注册：Prompt收藏夹盲盒节点
// ==========================================
app.registerExtension({
    name: "PromptManager.GroupRandomizerNode",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "PromptGroupRandomizerNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                const promptWidget = this.widgets.find(w => w.name === "prompt_text" || w.name === "输入prompt");
                if (promptWidget && promptWidget.inputEl) { promptWidget.inputEl.style.display = "none"; promptWidget.computeSize = () => [0, -4]; }

                const listContainer = document.createElement("div");
                listContainer.style.cssText = "width: 100%; min-height: 50px; max-height: 180px; overflow-y: auto; background: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 5px; box-sizing: border-box; display: flex; flex-direction: column; gap: 4px; font-family: sans-serif;";
                listContainer.addEventListener("wheel", (e) => e.stopPropagation(), { passive: false });
                listContainer.addEventListener("pointerdown", (e) => e.stopPropagation());

                const header = document.createElement("div");
                header.style.cssText = "display: flex; justify-content: space-between; font-size: 11px; color: #ff6b9d; font-weight: bold; padding: 0 5px 4px 5px; border-bottom: 1px dashed rgba(255,107,157,0.4); margin-bottom: 4px;";
                header.innerHTML = `<span>&lt;盲盒结果区&gt;</span><span style="padding-right:38px;">&lt;权重&gt;</span>`;
                
                const listBody = document.createElement("div");
                listBody.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
                listContainer.appendChild(header); listContainer.appendChild(listBody);
                this.addDOMWidget("prompt_list", "HTML", listContainer, { serialize: false, hideOnZoom: false });

                let cachedList = []; let isUpdatingFromList = false;

                const renderList = () => {
                    listBody.innerHTML = '';
                    if (!isUpdatingFromList && UTILS && UTILS.parsePromptText) {
                        cachedList = UTILS.parsePromptText(promptWidget.value || "");
                    }
                    if (cachedList.length === 0) { listBody.innerHTML = '<div style="color:#555; font-size:11px; text-align:center; padding:10px;">点击按钮抽取盲盒</div>'; return; }

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

                        rightCtrl.appendChild(numInput); rightCtrl.appendChild(delBtn);
                        row.appendChild(tagSpan); row.appendChild(rightCtrl); listBody.appendChild(row);
                    });
                };

                const originalCallback = promptWidget.callback;
                promptWidget.callback = function() { if (originalCallback) originalCallback.apply(this, arguments); if (!isUpdatingFromList) renderList(); };
                renderList();

                // === 拦截器注入：强制锁定前缀，防止被 ComfyUI 或旧数据重置 ===
                const groupWidget = this.widgets.find(w => w.name === "选择分组");
                if (groupWidget) {
                    // 安全自动修复：防止用户旧存档的单纯 "分组名" 报错，自动补全 "[模型名] 分组名"
                    const checkMigrate = () => {
                        if (groupWidget.value && groupWidget.options?.values) {
                            if (!groupWidget.value.startsWith("[")) {
                                const val = groupWidget.value.split('|').pop();
                                const matched = groupWidget.options.values.find(opt => opt.endsWith(`] ${val}`));
                                if (matched) { groupWidget.value = matched; app.graph.setDirtyCanvas(true); }
                            }
                        }
                    };
                    setTimeout(checkMigrate, 500);
                }

                let autoRandomWidget = this.widgets.find(w => w.name === "自动随机抽取");
                if (!autoRandomWidget) {
                    autoRandomWidget = this.addWidget("toggle", "自动随机抽取", false, () => {});
                }

                const btnDraw = this.addWidget("button", "抽取盲盒", "draw_blind_box", async () => {
                    if (Object.keys(STATE.localDB.contexts || {}).length === 0) STATE.localDB = await UTILS.getAndMigrateDB();
                    const currentGroupWidget = this.widgets.find(w => w.name === "选择分组");
                    const countWidget = this.widgets.find(w => w.name === "抽取数量");
                    
                    if (!currentGroupWidget || !countWidget || currentGroupWidget.value === "无可用分组_请先创建") return alert("请先创建收藏分组并选择！");
                    
                    // 修复：同步将 .*? 改为 .* 贪婪匹配，防止用户模型名字自带括号导致切片失败
                    const parts = currentGroupWidget.value.match(/^\[(.*)\]\s*(.*)$/);
                    if (!parts) return alert("分组格式无法识别！请尝试重新下拉选择该分组刷新数据。");
                    
                    const m_name = parts[1];
                    const g_name = parts[2];
                    let targetGroup = null;
                    
                    const models = STATE.localDB.models?.main_models || {};
                    for (const [modelId, modelData] of Object.entries(models)) {
                        const modelName = modelData.name || modelId;
                        if (modelName === m_name) {
                            const globalCtx = `${modelId}_global`;
                            const groups = STATE.localDB.contexts[globalCtx]?.groups || [];
                            targetGroup = groups.find(g => g.name === g_name);
                            if (targetGroup) break;
                        }
                    }

                    if (!targetGroup || !targetGroup.items || targetGroup.items.length === 0) return alert(`分组 [${g_name}] 内没有任何卡片，无法抽取！`);

const count = Math.min(targetGroup.items.length, countWidget.value);
                    const shuffled = UTILS.pmShuffle(targetGroup.items);
                    const selected = shuffled.slice(0, count);

                    const newParsed = selected.map(tag => ({ original: tag, tag: tag, weight: 1.0, enabled: true }));
                    promptWidget.value = UTILS.buildPromptText(newParsed); app.graph.setDirtyCanvas(true); renderList();
                });
                
                // === 修复 3: 重新对节点的 Widgets 排序 ===
                const groupWidgetRef = this.widgets.find(w => w.name === "选择分组");
                const countWidgetRef = this.widgets.find(w => w.name === "抽取数量");
                const promptTextWidgetRef = this.widgets.find(w => w.name === "prompt_text" || w.name === "输入prompt");
                const htmlListWidgetRef = this.widgets.find(w => w.type === "HTML" && w.name === "prompt_list");

                const desiredOrder = [
                    groupWidgetRef,
                    btnDraw,             // 抽取盲盒 挪到上面
                    autoRandomWidget,    // 自动随机抽取 挪到下面
                    countWidgetRef,
                    promptTextWidgetRef,
                    htmlListWidgetRef
                ].filter(Boolean);

                const otherWidgets = this.widgets.filter(w => !desiredOrder.includes(w));
                this.widgets = [...desiredOrder, ...otherWidgets];
                
                this.setSize([400, 260]);
            };
        }
    }
});

// ==========================================
// 4. 注册：Prompt组合预设加载器节点前端拦截 (全新双栏 UI)
// ==========================================
app.registerExtension({
    name: "PromptManager.ComboLoaderNode",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "PromptComboLoaderNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);

                // 强制隐藏后端的三个底层文本输入框
                setTimeout(() => {
                    const wName = this.widgets?.find(w => w.name === "选择组合");
                    const wPrompt = this.widgets?.find(w => w.name === "combo_prompt");
                    const wImage = this.widgets?.find(w => w.name === "combo_image");
                    
                    if (wName) { wName.hidden = true; wName.computeSize = () => [0,0]; }
                    if (wPrompt) { wPrompt.hidden = true; wPrompt.computeSize = () => [0,0]; }
                    if (wImage) { wImage.hidden = true; wImage.computeSize = () => [0,0]; }
                    this.setSize([500, 320]);
                }, 10);

                // 构建主容器
                const container = document.createElement("div");
                // 【核心修复】：增加 pointer-events: auto 强制开启鼠标事件响应
                container.style.cssText = "width: 100%; height: 260px; display: flex; gap: 8px; font-family: sans-serif; padding: 4px; box-sizing: border-box; pointer-events: auto;";
                
                // 【终极事件护盾】：彻底隔绝 LiteGraph 对鼠标的所有劫持
                const stopPropagation = (e) => { e.stopPropagation(); };
                ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'dblclick', 'wheel'].forEach(evt => {
                    container.addEventListener(evt, stopPropagation, { passive: false });
                });

                // 左侧栏：本地组合 (绿色系)
                const leftCol = document.createElement("div");
                leftCol.style.cssText = "flex: 1; min-height: 50px; max-height: 280px; overflow-y: auto; background: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 5px; box-sizing: border-box; display: flex; flex-direction: column; gap: 4px;";
                const leftHeader = document.createElement("div");
                leftHeader.style.cssText = "display: flex; justify-content: space-between; font-size: 11px; color: #4caf50; font-weight: bold; padding: 0 5px 4px 5px; border-bottom: 1px dashed rgba(76,175,80,0.4); margin-bottom: 4px;";
                leftHeader.innerHTML = `<span>&lt;本地组合库&gt;</span>`;
                const leftList = document.createElement("div");
                leftList.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
                leftCol.appendChild(leftHeader); leftCol.appendChild(leftList);

                // 右侧栏：云端组合 (粉色系)
                const rightCol = document.createElement("div");
                rightCol.style.cssText = "flex: 1; min-height: 50px; max-height: 280px; overflow-y: auto; background: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 5px; box-sizing: border-box; display: flex; flex-direction: column; gap: 4px;";
                const rightHeader = document.createElement("div");
                rightHeader.style.cssText = "display: flex; justify-content: space-between; font-size: 11px; color: #ff6b9d; font-weight: bold; padding: 0 5px 4px 5px; border-bottom: 1px dashed rgba(255,107,157,0.4); margin-bottom: 4px;";
                rightHeader.innerHTML = `<span>&lt;订阅云端库&gt;</span>`;
                const rightList = document.createElement("div");
                rightList.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
                rightCol.appendChild(rightHeader); rightCol.appendChild(rightList);

                container.appendChild(leftCol);
                container.appendChild(rightCol);
                this.addDOMWidget("combo_ui", "HTML", container, { serialize: false, hideOnZoom: false });

                this.isDestroyed = false;
                this.lastComboStateStr = ""; 
                const onRemoved = this.onRemoved;
                this.onRemoved = function() { this.isDestroyed = true; clearInterval(this.refreshInterval); if(onRemoved) onRemoved.apply(this, arguments); };

                // 核心渲染函数
                const renderItem = (c, isCloud) => {
                    const wName = this.widgets?.find(w => w.name === "选择组合");
                    const isSelected = wName && wName.value === c.identifier;
                    
                    const itemDiv = document.createElement("div");
                    const bgColor = isSelected ? (isCloud ? '#5a1a3a' : '#1e3e1e') : '#252525';
                    const borderColor = isSelected ? (isCloud ? '#ff6b9d' : '#4caf50') : 'transparent';
                    
                    itemDiv.style.cssText = `display: flex; justify-content: space-between; align-items: center; background: ${bgColor}; padding: 4px 6px; border-radius: 4px; transition: 0.2s; cursor: pointer; border: 1px solid ${borderColor};`;
                    itemDiv.innerHTML = `<span style="color: #ddd; font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; user-select: none;" title="${c.displayName}"><span style="color:${isCloud?'#ff6b9d':'#4caf50'};">[${c.modelName}]</span> ${c.displayName}</span>`;

                    // 【核心修复】：改用原生 onclick，结合上方的拦截护盾，确保 100% 点击成功
                    itemDiv.onclick = (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (wName) wName.value = c.identifier;
                        
                        const wPrompt = this.widgets?.find(w => w.name === "combo_prompt");
                        const wImage = this.widgets?.find(w => w.name === "combo_image");
                        if (wPrompt) wPrompt.value = c.promptStr;
                        if (wImage) wImage.value = c.image || "";
                        
                        app.graph.setDirtyCanvas(true);
                        this.updateComboLists(true);
                    };
                    return itemDiv;
                };

                // 轮询与更新逻辑
                this.updateComboLists = (forceUpdate = false) => {
                    if (this.isDestroyed || !window.PM_Global?.state?.localDB) return;
                    const db = window.PM_Global.state.localDB;
                    const models = db.models?.main_models || {};
                    const wName = this.widgets?.find(w => w.name === "选择组合");

                    let localCombos = [];
                    let cloudCombos = [];

                    for (const [mId, mData] of Object.entries(models)) {
                        const globalCtx = `${mId}_global`;
                        const cbs = db.contexts?.[globalCtx]?.combos || [];
                        if (cbs.length === 0) continue;

                        let isCloud = false;
                        let mName = mData.name || mId;

                        if (mId.startsWith('cloud_')) {
                            isCloud = true;
                            mName = mName.replace(/\[☁️在线\]\s*/, '');
                        } else if (mId.startsWith('fav_cloud_')) {
                            // 让订阅库的个人补充预设，也作为“云端数据”展示在右侧粉色列表中
                            isCloud = true; 
                            mName = mName.replace(/订阅库-\s*/, '');
                        }

                        cbs.forEach(c => {
                            const promptStr = c.elements.map(e => e.weight != 1 ? `(${e.tag}:${e.weight})` : e.tag).join(', ');
                            const comboObj = {
                                identifier: `[${mData.name || mId}] ${c.name}`,
                                modelName: mName,
                                displayName: c.name,
                                promptStr: promptStr,
                                image: c.image
                            };
                            if (isCloud) cloudCombos.push(comboObj);
                            else localCombos.push(comboObj);
                        });
                    }

                    // 状态对比：如果数据和选中项都没变，就不重绘DOM（保护滚动条位置）
                    const currentState = JSON.stringify({ local: localCombos, cloud: cloudCombos, selected: wName ? wName.value : null });
                    if (!forceUpdate && this.lastComboStateStr === currentState) return;
                    this.lastComboStateStr = currentState;

                    // 渲染本地列表
                    leftList.innerHTML = '';
                    if (localCombos.length === 0) leftList.innerHTML = '<div style="color:#555; text-align:center; padding:15px; font-size:11px;">无本地组合</div>';
                    else localCombos.forEach(c => leftList.appendChild(renderItem(c, false)));

                    // 渲染云端列表
                    rightList.innerHTML = '';
                    if (cloudCombos.length === 0) rightList.innerHTML = '<div style="color:#555; text-align:center; padding:15px; font-size:11px;">无云端组合</div>';
                    else cloudCombos.forEach(c => rightList.appendChild(renderItem(c, true)));
                    
                    // 向下兼容：自动补充旧节点缺失的隐形文本数据
                    const wPrompt = this.widgets?.find(w => w.name === "combo_prompt");
                    const wImage = this.widgets?.find(w => w.name === "combo_image");
                    if (wName && wName.value) {
                        const selected = [...localCombos, ...cloudCombos].find(c => c.identifier === wName.value);
                        if (selected) {
                            if (wPrompt && !wPrompt.value) wPrompt.value = selected.promptStr;
                            if (wImage && !wImage.value) wImage.value = selected.image || "";
                        }
                    }
                };

                setTimeout(() => this.updateComboLists(true), 500);
                this.refreshInterval = setInterval(() => this.updateComboLists(), 1500); // 加快轮询频率
                this.setSize([500, 320]);
            };
        }
    }
});

// ==========================================
// 5. 注册：Prompt批量读取器节点前端拦截 (全新三栏自适应 UI)
// ==========================================
app.registerExtension({
    name: "PromptManager.BatchReaderNode",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "PromptBatchReaderNode") {
            
            // 拦截执行结果，接收 Python 端传来的进度
            const onExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function(message) {
                if (onExecuted) onExecuted.apply(this, arguments);
                if (message && message.progress) {
                    const currentIdx = message.progress[0];
                    if (this.highlightProgress) this.highlightProgress(currentIdx);
                }
            };

            // 【新增】：修复刷新页面/加载工作流时，数据丢失的问题
            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function(info) {
                if (onConfigure) onConfigure.apply(this, arguments);
                // 工作流加载完成后，强制将原生 widget 的真实值同步给我们的自定义 UI
                if (this.uiRefs) {
                    const wList = this.widgets.find(w => w.name === "批量列表_每行一个");
                    const wPrefix = this.widgets.find(w => w.name === "固定前缀");
                    const wSuffix = this.widgets.find(w => w.name === "固定后缀");
                    
                    if (wPrefix) this.uiRefs.taPrefix.value = wPrefix.value;
                    if (wSuffix) this.uiRefs.taSuffix.value = wSuffix.value;
                    if (wList) {
                        this.uiRefs.taList.value = wList.value;
                        this.uiRefs.renderStrips(); // 重新渲染列表条目
                    }
                }
            };

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);

                // 创建一个对象来存储 DOM 引用，方便其他生命周期函数调用
                this.uiRefs = {};

                // 1. 找到原生节点并“完美隐身化”
                const wList = this.widgets.find(w => w.name === "批量列表_每行一个");
                const wPrefix = this.widgets.find(w => w.name === "固定前缀");
                const wSuffix = this.widgets.find(w => w.name === "固定后缀");
                const wReset = this.widgets.find(w => w.name === "reset_timestamp");

                [wList, wPrefix, wSuffix, wReset].forEach(w => {
                    if (w) {
                        // 1. 告诉 ComfyUI/LiteGraph 这是一个被隐藏的自定义控件
                        w.type = "custom_hidden";
                        w.hidden = true; 
                        
                        // 2. 强制宽高占位为 0
                        w.computeSize = () => [0, 0];
                        
                        // 3. 【终极杀招】劫持它的 Canvas 绘制函数，让它什么都不画！
                        w.draw = function(ctx, node, widget_width, y, widget_height) { 
                            // 留空，阻断 LiteGraph 的默认灰色底框渲染
                        };
                        
                        // 4. 隐藏原生的 HTML 输入框（如果有的话）
                        if (w.inputEl) {
                            w.inputEl.style.display = "none";
                            w.inputEl.style.visibility = "hidden";
                        }
                    }
                });

                // 2. 构建三栏 Flex 容器
                const container = document.createElement("div");
                container.style.cssText = "display: flex; width: 100%; height: 260px; gap: 8px; padding: 4px; box-sizing: border-box; background: #151515; border-radius: 6px; pointer-events: auto; font-family: sans-serif;";

                const stopProp = (e) => e.stopPropagation();
                ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'keydown', 'keyup'].forEach(evt => {
                    container.addEventListener(evt, stopProp, { passive: false });
                });

                // --- 左栏：固定前缀 ---
                const col1 = document.createElement("div");
                col1.style.cssText = "flex: 1; display: flex; flex-direction: column; background: #1e1e1e; border: 1px solid #333; border-radius: 4px; overflow: hidden;";
                col1.innerHTML = `<div style="font-size: 11px; color: #ff6b9d; padding: 6px; border-bottom: 1px dashed rgba(255,107,157,0.4); font-weight: bold; text-align: center;">&lt;固定前缀&gt;</div>`;
                const taPrefix = document.createElement("textarea");
                taPrefix.style.cssText = "flex: 1; background: transparent; border: none; color: #ccc; padding: 8px; font-size: 12px; resize: none; outline: none; line-height: 1.5;";
                taPrefix.value = wPrefix ? wPrefix.value : "";
                taPrefix.oninput = () => { if (wPrefix) wPrefix.value = taPrefix.value; app.graph.setDirtyCanvas(true); };
                col1.appendChild(taPrefix);
                this.uiRefs.taPrefix = taPrefix;

                // --- 右栏：固定后缀 ---
                const col3 = document.createElement("div");
                col3.style.cssText = "flex: 1; display: flex; flex-direction: column; background: #1e1e1e; border: 1px solid #333; border-radius: 4px; overflow: hidden;";
                col3.innerHTML = `<div style="font-size: 11px; color: #ff6b9d; padding: 6px; border-bottom: 1px dashed rgba(255,107,157,0.4); font-weight: bold; text-align: center;">&lt;固定后缀&gt;</div>`;
                const taSuffix = document.createElement("textarea");
                taSuffix.style.cssText = "flex: 1; background: transparent; border: none; color: #ccc; padding: 8px; font-size: 12px; resize: none; outline: none; line-height: 1.5;";
                taSuffix.value = wSuffix ? wSuffix.value : "";
                taSuffix.oninput = () => { if (wSuffix) wSuffix.value = taSuffix.value; app.graph.setDirtyCanvas(true); };
                col3.appendChild(taSuffix);
                this.uiRefs.taSuffix = taSuffix;

                // --- 中栏：核心画师列表 ---
                const col2 = document.createElement("div");
                col2.style.cssText = "flex: 3; display: flex; flex-direction: column; background: #1a1a1a; border: 1px solid #4caf50; border-radius: 4px; overflow: hidden;";
                
                const listHeader = document.createElement("div");
                listHeader.style.cssText = "display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #4caf50; padding: 4px 8px; border-bottom: 1px solid #333; font-weight: bold; background: #111;";
                listHeader.innerHTML = `<span>核心队列 (<span id="pm-batch-count">0</span>) - 进度: <span id="pm-run-progress" style="color:#ff9800;">等待开始</span></span> 
                <div style="display:flex; gap:6px;">
                    <button id="pm-reset-btn" style="background:#ff9800; border:none; color:#fff; border-radius:3px; cursor:pointer; font-size:10px; padding: 2px 6px; font-weight:bold; transition: 0.2s;" title="重置执行进度回到第1个">↺ 从头开始</button>
                    <button id="pm-batch-edit-btn" style="background:none; border:1px solid #4caf50; color:#4caf50; border-radius:3px; cursor:pointer; font-size:10px; padding: 2px 6px; transition: 0.2s;">批量编辑</button>
                </div>`;
                
                const listBody = document.createElement("div");
                listBody.style.cssText = "flex: 1; position: relative;";

                const taList = document.createElement("textarea");
                taList.style.cssText = "position: absolute; top:0; left:0; width: 100%; height: 100%; background: #0f190f; border: none; color: #eee; padding: 8px; font-size: 12px; resize: none; outline: none; display: none; box-sizing: border-box; line-height: 1.5;";
                taList.placeholder = "在此粘贴长串名单，一行一个，点击【完成】即可转换...";
                this.uiRefs.taList = taList;

                const stripContainer = document.createElement("div");
                stripContainer.style.cssText = "position: absolute; top:0; left:0; width: 100%; height: 100%; overflow-y: auto; padding: 6px; box-sizing: border-box; display: flex; flex-direction: column; gap: 4px; scroll-behavior: smooth;";

                listBody.appendChild(stripContainer);
                listBody.appendChild(taList);
                col2.appendChild(listHeader);
                col2.appendChild(listBody);

                container.appendChild(col1);
                container.appendChild(col2);
                container.appendChild(col3);

                this.addDOMWidget("batch_reader_ui", "HTML", container, { serialize: false, hideOnZoom: false });

                let isEditing = false;
                const editBtn = listHeader.querySelector("#pm-batch-edit-btn");
                const resetBtn = listHeader.querySelector("#pm-reset-btn");
                const countSpan = listHeader.querySelector("#pm-batch-count");
                const progressSpan = listHeader.querySelector("#pm-run-progress");

                resetBtn.onclick = () => {
                    if (wReset) {
                        wReset.value = Date.now().toString(); 
                        app.graph.setDirtyCanvas(true);
                        progressSpan.innerText = "已重置到 0";
                        progressSpan.style.color = "#ff9800";
                        const allStrips = stripContainer.querySelectorAll('.pm-batch-strip');
                        allStrips.forEach(s => {
                            s.style.background = "#252a25";
                            s.classList.remove("active");
                        });
                        resetBtn.style.background = "#fff";
                        setTimeout(() => resetBtn.style.background = "#ff9800", 200);
                    }
                };

                const renderStrips = () => {
                    stripContainer.innerHTML = "";
                    const val = wList ? wList.value : "";
                    const items = val.split('\n').map(s => s.trim()).filter(s => s);
                    countSpan.innerText = items.length;

                    if (items.length === 0) {
                        stripContainer.innerHTML = '<div style="color:#555; text-align:center; padding-top:40px; font-size:12px;">队列为空<br><br>请点击右上角【批量编辑】粘贴数据</div>';
                        return;
                    }

                    items.forEach((item, idx) => {
                        const strip = document.createElement("div");
                        strip.className = "pm-batch-strip"; 
                        strip.id = `pm-strip-${idx + 1}`;
                        strip.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: #252a25; border-left: 3px solid #4caf50; padding: 4px 8px; border-radius: 2px; transition: 0.2s;";
                        
                        strip.onmouseover = () => { strip.style.background = "#2e3a2e"; };
                        strip.onmouseout = () => { strip.style.background = strip.classList.contains("active") ? "#4caf50" : "#252a25"; };
                        
                        const textWrap = document.createElement("div");
                        textWrap.style.cssText = "display: flex; align-items: center; gap: 8px; overflow: hidden;";

                        const numSpan = document.createElement("span");
                        numSpan.style.cssText = "background: #111; color: #888; font-size: 10px; padding: 2px 5px; border-radius: 4px; font-family: monospace; min-width: 24px; text-align: center;";
                        numSpan.innerText = idx + 1;
                        
                        const textSpan = document.createElement("span");
                        textSpan.style.cssText = "color: #eee; font-size: 12px; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
                        textSpan.innerText = item;

                        textWrap.appendChild(numSpan);
                        textWrap.appendChild(textSpan);

                        const delBtn = document.createElement("button");
                        delBtn.innerText = "×";
                        delBtn.style.cssText = "background: transparent; color: #f44336; border: none; cursor: pointer; font-weight: bold; font-size: 14px; padding: 0 4px;";
                        delBtn.onclick = (e) => {
                            e.stopPropagation();
                            items.splice(idx, 1);
                            if (wList) wList.value = items.join('\n');
                            app.graph.setDirtyCanvas(true);
                            renderStrips(); 
                        };

                        strip.appendChild(textWrap);
                        strip.appendChild(delBtn);
                        stripContainer.appendChild(strip);
                    });
                };
                
                // 挂载到实例上，供 onConfigure 使用
                this.uiRefs.renderStrips = renderStrips;

                this.highlightProgress = (currentIdx) => {
                    progressSpan.innerText = `第 ${currentIdx} 个`;
                    progressSpan.style.color = "#00e5ff";
                    
                    const allStrips = stripContainer.querySelectorAll('.pm-batch-strip');
                    allStrips.forEach(s => {
                        s.style.background = "#252a25";
                        s.classList.remove("active");
                    });
                    
                    const targetStrip = stripContainer.querySelector(`#pm-strip-${currentIdx}`);
                    if (targetStrip) {
                        targetStrip.style.background = "#4caf50";
                        targetStrip.classList.add("active");
                        
                        const stripRect = targetStrip.getBoundingClientRect();
                        const containerRect = stripContainer.getBoundingClientRect();
                        if (stripRect.top < containerRect.top || stripRect.bottom > containerRect.bottom) {
                            targetStrip.scrollIntoView({ behavior: "smooth", block: "center" });
                        }
                    }
                };

                const toggleEdit = () => {
                    isEditing = !isEditing;
                    if (isEditing) {
                        taList.value = wList ? wList.value : "";
                        taList.style.display = "block";
                        stripContainer.style.display = "none";
                        editBtn.innerText = "✓ 完成";
                        editBtn.style.color = "#fff";
                        editBtn.style.background = "#4caf50";
                        taList.focus();
                    } else {
                        if (wList) wList.value = taList.value;
                        app.graph.setDirtyCanvas(true);
                        taList.style.display = "none";
                        stripContainer.style.display = "flex";
                        editBtn.innerText = "批量编辑";
                        editBtn.style.color = "#4caf50";
                        editBtn.style.background = "none";
                        renderStrips();
                    }
                };

                editBtn.onclick = toggleEdit;
                renderStrips();

                const htmlWidgetRef = this.widgets.find(w => w.type === "HTML" && w.name === "batch_reader_ui");

                const desiredOrder = [
                    htmlWidgetRef, 
                    wList,      
                    wPrefix,    
                    wSuffix,
                    wReset
                ].filter(Boolean);

                const otherWidgets = this.widgets.filter(w => !desiredOrder.includes(w));
                this.widgets = [...desiredOrder, ...otherWidgets];
                this.widgets = this.widgets.filter(w => w.name !== "重置进度从头开始");

                this.setSize([700, 320]);
            };
        }
    }
});