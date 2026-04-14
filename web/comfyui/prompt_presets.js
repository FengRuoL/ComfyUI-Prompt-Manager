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

// ==========================================
// 1. 收藏夹分组管理 API
// ==========================================
// === 附加排序逻辑 ===
window.PM_Global.ui.openGroupsModal = function() {
    const ctx = `${STATE.currentModelId}_global`;
    STATE.currentManageCtx = ctx; 
    const d = getCtxData(ctx);
    
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
                            <button class="pm-action-btn primary" onclick="PM_Global.ui.createNewGroup('${ctx}')">新建分组</button>
                            <button class="pm-action-btn" onclick="PM_Global.ui.exportGroups()">导出配置</button>
                            <button class="pm-action-btn" onclick="document.getElementById('pm-import-groups-file').click()">导入配置</button>
                            <button class="pm-action-btn" style="color:#f8961e; border-color:#835213;" title="将旧版本存放收藏/管理的存储方式转换为新版本。若收藏/管理无法显示，或导入了旧版本数据时，请点击此按键。" onclick="PM_Global.utils.manualMigrateData()">格式迁移</button>
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
    if (d.groups.length === 0) content.innerHTML = `<div style="color:#555; text-align:center; padding:50px;">当前模型下没有收藏分组。</div>`;
    else content.innerHTML = '';

    d.groups.forEach((g, idx) => {
        const div = document.createElement("div"); 
        div.className = "pm-list-item";
        div.style.transition = "border 0.2s";
        
        // 增加拖拽排序逻辑
        div.draggable = true;
        div.ondragstart = (e) => { e.dataTransfer.setData("text/plain", idx); e.stopPropagation(); };
        div.ondragover = (e) => { 
            e.preventDefault(); 
            div.style.borderColor = "#ff6b9d"; 
        };
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
                <b style="color:#ff6b9d; font-size:16px;">${g.name}</b>
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

window.PM_Global.ui.createNewGroup = async function(ctx) {
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
        
        let imgHtml = imgList.length > 0 ? `<img src="${imgList[0]}">` : `<div class="pm-no-img">暂无图片</div>`;
        card.innerHTML = `
            <div class="pm-card-img-wrap" style="cursor:pointer;">
                ${imgHtml}
            </div>
            <div class="pm-card-title">${item}</div>
            <div class="pm-card-actions" style="justify-content:center; padding-top:6px;">
                <button class="pm-text-btn danger" onclick="event.stopPropagation(); PM_Global.ui.removeCardFromGroup(${idx}, '${item}', '${ctx}')">移出该分组</button>
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
window.PM_Global.ui.openCombosModal = function() {
    const ctx = `${STATE.currentModelId}_global`;
    STATE.currentManageCtx = ctx; 
    const d = getCtxData(ctx);
    
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
                    <div style="padding:15px; border-bottom:1px solid #333; background:#1a1a1a; display:flex; gap:10px;">
                        <button class="pm-action-btn primary" style="flex:1;" onclick="PM_Global.ui.createNewCombo('${ctx}')">创建新组合</button>
                        <button class="pm-action-btn" onclick="PM_Global.ui.exportCombos()">导出配置(含图)</button>
                        <button class="pm-action-btn" onclick="document.getElementById('pm-import-combos-file').click()">导入配置</button>
                        <button class="pm-action-btn" style="color:#f8961e; border-color:#835213;" title="将旧版本存放收藏/管理的存储方式转换为新版本。若收藏/管理无法显示，或导入了旧版本数据时，请点击此按键。" onclick="PM_Global.utils.manualMigrateData()">格式迁移</button>
                        <input type="file" id="pm-import-combos-file" accept=".json" style="display:none;" onchange="PM_Global.ui.importCombos(event)">
                    </div>
                    <!-- 修复 Bug 2：增加 padding-bottom 和 box-sizing，防止底部被遮挡 -->
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
                        // 移除丢失的查重函数，改为安全删除
                        if (STATE.tempCombo.image) { try { await PromptAPI.deleteFile(STATE.tempCombo.image); } catch(err){} }
                        STATE.tempCombo.image = url;
                        window.PM_Global.ui.openComboEditModal(-1, currentCtx);
                    } else {
                        const cbs = STATE.localDB.contexts[currentCtx].combos;
                        const oldImg = cbs[STATE.currentComboEditIdx].image;
                        // 移除丢失的查重函数，改为安全删除
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
        div.ondragover = (e) => { 
            e.preventDefault(); 
            div.style.borderColor = "#ff6b9d"; 
        };
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

        const imgUrl = c.image ? `${c.image}?t=${Date.now()}` : '';
        const imgHtml = c.image ? `<img src="${imgUrl}" style="width:100px; height:100px; object-fit:cover; border-radius:8px; cursor:pointer;" onclick="document.getElementById('pm-viewer-img').src='${imgUrl}'; pmShowModal('pm-image-viewer');">` : `<div style="width:100px; height:100px; background:#222; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#444; font-size:12px;">无预览图</div>`;
        const promptStr = c.elements.map(e => e.weight != 1 ? `(${e.tag}:${e.weight})` : e.tag).join(', ');

        div.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:center; padding-right:5px; color:#555; cursor:grab; font-size:18px;" title="拖拽排序">☰</div>
            ${imgHtml}
            <div style="flex:1; display:flex; flex-direction:column; justify-content:center;">
                <b style="color:#ff6b9d; font-size:16px; margin-bottom:5px;">${c.name}</b>
                <div style="color:#888; font-size:12px; line-height:1.4; max-height:40px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${promptStr || '暂无标签...'}</div>
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

window.PM_Global.ui.createNewCombo = async function(ctx) {
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
            <b style="color:#ff6b9d;">编辑组合: ${c.name}</b>
            <button class="pm-close-btn" onclick="pmHideModal('pm-combo-edit-modal')">返回</button>
        `;
    }

    const imgUrl = c.image ? `${c.image}?t=${Date.now()}` : '';
    let imgArea = c.image ? `<img src="${imgUrl}" style="width:100%; height:200px; object-fit:contain; border-radius:8px; cursor:pointer;" onclick="document.getElementById('pm-hidden-combo-img').click()">` : `<div style="width:100%; height:200px; background:#111; border:1px dashed #444; border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:#777;" onclick="document.getElementById('pm-hidden-combo-img').click()">点击上传预览图</div>`;

    document.getElementById("pm-cedit-content").innerHTML = `
        <input type="text" class="pm-search-input" style="width:100%; margin-bottom:15px; font-weight:bold; font-size:14px;" value="${c.name}" onchange="PM_Global.ui.updateComboName(${idx}, '${ctx}', this.value)">
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
        elDiv.innerHTML = `
            <input type="text" class="pm-search-input" style="flex:3; padding:6px 10px;" value="${el.tag}" onchange="PM_Global.ui.updateComboEl(${idx}, ${elIdx}, 'tag', this.value, '${ctx}')">
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
                    
                    const parts = currentGroupWidget.value.match(/^\[(.*?)\]\s*(.*)$/);
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
                    const shuffled = [...targetGroup.items].sort(() => 0.5 - Math.random());
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
// 4. 注册：Prompt组合预设加载器节点前端拦截
// ==========================================
app.registerExtension({
    name: "PromptManager.ComboLoaderNode",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "PromptComboLoaderNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                
                const comboWidget = this.widgets?.find(w => w.name === "选择组合");
                if (comboWidget) {
                    // 1. 拦截下拉列表选项的写入（免疫任何外部同步脚本的格式破坏）
                    if (comboWidget.options) {
                        let realValues = comboWidget.options.values || [];
                        Object.defineProperty(comboWidget.options, 'values', {
                            get: function() { return realValues; },
                            set: function(newVals) {
                                if (!newVals || !Array.isArray(newVals)) {
                                    realValues = newVals;
                                    return;
                                }
                                const db = window.PM_Global?.state?.localDB;
                                const models = db?.models?.main_models || {};
                                
                                // 清洗并强行修正所有灌入选项，确保有 [模型名] 前缀
                                realValues = newVals.map(v => {
                                    if (typeof v === 'string' && !v.startsWith('[')) {
                                        const rawName = v.includes('|') ? v.split('|').pop().trim() : v.trim();
                                        if (db && db.contexts) {
                                            for (const ctx of Object.keys(db.contexts)) {
                                                if (db.contexts[ctx].combos?.some(c => c.name === rawName)) {
                                                    const mId = ctx.split('_')[0];
                                                    const mName = models[mId]?.name || mId;
                                                    return `[${mName}] ${rawName}`;
                                                }
                                            }
                                        }
                                    }
                                    return v;
                                });
                                // 剔除重复项
                                realValues = [...new Set(realValues)];
                            },
                            configurable: true
                        });
                    }

                    // 2. 拦截当前选择值的写入与读取（兼容历史旧版节点和脏数据复原）
                    let realValue = comboWidget.value;
                    Object.defineProperty(comboWidget, 'value', {
                        get: function() { return realValue; },
                        set: function(v) {
                            if (typeof v === 'string' && !v.startsWith('[')) {
                                const rawName = v.includes('|') ? v.split('|').pop().trim() : v.trim();
                                if (comboWidget.options && comboWidget.options.values) {
                                    const matched = comboWidget.options.values.find(opt => opt.endsWith(`] ${rawName}`));
                                    if (matched) {
                                        realValue = matched;
                                        return;
                                    }
                                }
                            }
                            realValue = v;
                        },
                        configurable: true
                    });

                    // 强制触发一次清洗，立刻洗掉加载时现存的脏数据
                    if (comboWidget.options && comboWidget.options.values) comboWidget.options.values = comboWidget.options.values;
                    if (comboWidget.value) comboWidget.value = comboWidget.value;
                }
            };
        }
    }
});