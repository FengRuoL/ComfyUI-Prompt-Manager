/* =====================================================================
 * [AI System Prompt / Do Not Modify]
 * FILE: prompt_viewers.js
 * DESC: Node visualizer logic for rendering Prompt Viewer and Prompt Preview nodes.
 * ROLE: Intercepts node execution to update DOM widgets on the canvas dynamically. Handles independent image preview overlays.
 * 
 * [User Info / 可由用户自行修改]
 * 文件：prompt_viewers.js
 * 作用：处理画布上那两个“显示器节点”（Prompt展示器、预览图节点）的画面刷新和图片渲染逻辑。
 * ===================================================================== */

// 文件路径：web/comfyui/prompt_viewers.js
import { app } from "../../scripts/app.js";

window.PM_Global = window.PM_Global || { state: {}, utils: {}, ui: {} };
const STATE = window.PM_Global.state;
const UTILS = window.PM_Global.utils;

function findImagesForTagFromDB(tag, db) {
    if (!db.images || !db.contexts) return [];
    const cleanTag = tag.trim().toLowerCase();
    let allImgs = [];
    for (const ctx in db.contexts) {
        const items = db.contexts[ctx].items || [];
        const matchedItem = items.find(i => i.toLowerCase() === cleanTag);
        if (matchedItem) {
            const imgKey = `${ctx}_${matchedItem}`;
            if (db.images[imgKey] && db.images[imgKey].length > 0) allImgs.push(...db.images[imgKey]);
        }
    }
    return [...new Set(allImgs)];
}

async function renderViewerCards(container, textValue, nodeInstance) {
    container.innerHTML = '';
    const parsed = UTILS.parsePromptText(textValue);
    
    if (parsed.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #555; font-size: 12px; padding: 20px;">等待输入连接...</div>`;
        return;
    }

    if (!STATE.localDB || Object.keys(STATE.localDB.contexts || {}).length === 0) {
        STATE.localDB = await UTILS.getAndMigrateDB();
    }

    parsed.forEach(item => {
        const card = document.createElement("div");
        card.style.cssText = "background: #222; border: 1px solid #333; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; transition: 0.2s; align-self: start; height: max-content;";
        
        const images = findImagesForTagFromDB(item.tag, STATE.localDB);
        let currentImgIndex = 0;

        const imgWrap = document.createElement("div");
        imgWrap.style.cssText = "width: 100%; aspect-ratio: 1/1; background: #111; position: relative; overflow: hidden;";
        
        const stopEvent = (e) => { e.stopPropagation(); };
        ['pointerdown','mousedown','mouseup','click','wheel'].forEach(evt => imgWrap.addEventListener(evt, stopEvent));

        if (images.length > 0) {
            const imgEl = document.createElement("img");
            imgEl.src = images[currentImgIndex];
            imgEl.style.cssText = "width: 100%; height: 100%; object-fit: cover; transition: 0.2s; cursor: zoom-in; pointer-events: auto;";
            
            imgEl.addEventListener("pointerup", (e) => {
                e.preventDefault(); e.stopPropagation();
                let viewer = document.getElementById("pm-standalone-viewer");
                if (!viewer) {
                    viewer = document.createElement("div"); viewer.id = "pm-standalone-viewer";
                    viewer.style.cssText = "position: fixed; top:0; left:0; width:100vw; height:100vh; background: rgba(0,0,0,0.85); z-index: 999999; display:none; flex-direction:column; align-items:center; justify-content:center; cursor: zoom-out;";
                    viewer.innerHTML = `<img id="pm-standalone-img" src="" style="max-width: 90%; max-height: 90%; object-fit: contain; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.8);">`;
                    document.body.appendChild(viewer);
                    viewer.addEventListener("pointerup", (ve) => { ve.stopPropagation(); window.pmHideModal("pm-standalone-viewer"); });
                }
                const fullImgEl = document.getElementById("pm-standalone-img");
                if (fullImgEl) { fullImgEl.src = images[currentImgIndex]; window.pmShowModal("pm-standalone-viewer"); }
            });

            imgWrap.appendChild(imgEl);

            if (images.length > 1) {
                const btnStyle = "position: absolute; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.6); color: white; border: none; padding: 4px 6px; cursor: pointer; border-radius: 4px; font-weight: bold; font-size: 9px; z-index: 10; transition: 0.2s;";
                const leftBtn = document.createElement("button"); leftBtn.innerText = "◀"; leftBtn.style.cssText = btnStyle + "left: 4px;";
                const rightBtn = document.createElement("button"); rightBtn.innerText = "▶"; rightBtn.style.cssText = btnStyle + "right: 4px;";
                
                leftBtn.addEventListener("pointerup", (e) => { e.preventDefault(); e.stopPropagation(); currentImgIndex = (currentImgIndex - 1 + images.length) % images.length; imgEl.src = images[currentImgIndex]; });
                rightBtn.addEventListener("pointerup", (e) => { e.preventDefault(); e.stopPropagation(); currentImgIndex = (currentImgIndex + 1) % images.length; imgEl.src = images[currentImgIndex]; });
                
                ['pointerdown','mousedown'].forEach(evt => { leftBtn.addEventListener(evt, stopEvent); rightBtn.addEventListener(evt, stopEvent); });
                imgWrap.appendChild(leftBtn); imgWrap.appendChild(rightBtn);
            }
        } else {
            imgWrap.style.cursor = "default";
            imgWrap.innerHTML = `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #444; font-size: 11px; font-weight: bold;">无图</div>`;
        }

        const tagDiv = document.createElement("div");
        tagDiv.style.cssText = "padding: 6px; font-size: 11px; color: #ddd; text-align: center; word-break: break-all; font-weight: bold; border-top: 1px solid #333;";
        tagDiv.innerText = item.tag;
        
        if (item.weight !== 1.0) {
            const wBadge = document.createElement("div");
            wBadge.style.cssText = "position: absolute; top: 4px; right: 4px; background: rgba(255,107,157,0.8); color: white; font-size: 10px; font-weight: bold; padding: 2px 4px; border-radius: 4px;";
            wBadge.innerText = item.weight;
            imgWrap.appendChild(wBadge);
        }

        card.appendChild(imgWrap); card.appendChild(tagDiv); container.appendChild(card);
    });
    if (nodeInstance) app.graph.setDirtyCanvas(true);
}

app.registerExtension({
    name: "PromptManager.ViewerNode",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "PromptViewerNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                
                // === 主容器布局 ===
                const wrapper = document.createElement("div");
                wrapper.style.cssText = "width: 100%; height: 100%; min-width: 200px; min-height: 100px; display: flex; flex-direction: column; background: #151515; border-radius: 8px; overflow: hidden; box-sizing: border-box;";
                
                wrapper.addEventListener("wheel", (e) => { e.stopPropagation(); }, { passive: false });
                wrapper.addEventListener("pointerdown", (e) => { e.stopPropagation(); });

                // B区：顶部大图区域 (默认隐藏)
                const topImgContainer = document.createElement("div");
                topImgContainer.style.cssText = "width: 100%; display: none; background: #0a0a0a; align-items: center; justify-content: center; flex-shrink: 0; position: relative;";
                
                const imgEl = document.createElement("img");
                imgEl.style.cssText = "max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in; display: none;";
                
                const imgPlaceholder = document.createElement("div");
                imgPlaceholder.style.cssText = "color: #555; font-size: 12px; font-weight: bold;";
                imgPlaceholder.innerText = "等待输入连接...";
                
                topImgContainer.appendChild(imgEl);
                topImgContainer.appendChild(imgPlaceholder);

                // 点击放大图片逻辑
                imgEl.addEventListener("pointerup", (e) => {
                    e.preventDefault(); e.stopPropagation();
                    let viewer = document.getElementById("pm-standalone-viewer");
                    if (!viewer) {
                        viewer = document.createElement("div"); viewer.id = "pm-standalone-viewer";
                        viewer.style.cssText = "position: fixed; top:0; left:0; width:100vw; height:100vh; background: rgba(0,0,0,0.85); z-index: 999999; display:none; flex-direction:column; align-items:center; justify-content:center; cursor: zoom-out;";
                        viewer.innerHTML = `<img id="pm-standalone-img" src="" style="max-width: 90%; max-height: 90%; object-fit: contain; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.8);">`;
                        document.body.appendChild(viewer);
                        viewer.addEventListener("pointerup", (ve) => { ve.stopPropagation(); window.pmHideModal("pm-standalone-viewer"); });
                    }
                    const fullImgEl = document.getElementById("pm-standalone-img");
                    if (fullImgEl) { fullImgEl.src = imgEl.src; window.pmShowModal("pm-standalone-viewer"); }
                });

                // A区：底部碎图网格区域
                const gridContainer = document.createElement("div");
                gridContainer.style.cssText = "flex: 1; width: 100%; overflow-y: auto; padding: 10px; box-sizing: border-box; display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); grid-auto-rows: max-content; align-items: start; gap: 8px;";
                
                wrapper.appendChild(topImgContainer);
                wrapper.appendChild(gridContainer);
                this.addDOMWidget("viewer_wrapper", "HTML", wrapper, { serialize: false, hideOnZoom: false });
                
                this.viewerContainer = gridContainer;
                this.lastPrompt = null;
                this.lastCombo = null;
                this.isDestroyed = false; 
                this.forceRefreshViewer = () => { this.lastPrompt = null; };
                
                const checkUpdate = async () => {
                    if (this.isDestroyed) return; 
                    if (this.flags?.collapsed || !this.graph) { setTimeout(checkUpdate, 500); return; }
                    
                    // 获取当前连线状态
                    const promptInput = this.inputs?.find(inp => inp.name === "prompt_text" || inp.name === "prompt字符串");
                    const imgInput = this.inputs?.find(inp => inp.name === "组合预览图");
                    
                    const hasPromptLink = promptInput && promptInput.link != null;
                    const hasImgLink = imgInput && imgInput.link != null;

                    // === 核心逻辑：智能 UI 空间分配 ===
                    if (hasImgLink && !hasPromptLink) {
                        // 只连了图片(B区)：大图占满 100%，隐藏网格，自由拖拽放大
                        topImgContainer.style.display = "flex";
                        topImgContainer.style.height = "100%";
                        topImgContainer.style.borderBottom = "none";
                        gridContainer.style.display = "none";
                    } else if (hasPromptLink && !hasImgLink) {
                        // 只连了字符串(A区)：隐藏大图，网格占满 100%
                        topImgContainer.style.display = "none";
                        gridContainer.style.display = "grid";
                    } else if (hasImgLink && hasPromptLink) {
                        // 全连了(A区+B区)：上下 50% 均分，放大节点时两者同步变大
                        topImgContainer.style.display = "flex";
                        topImgContainer.style.height = "50%";
                        topImgContainer.style.borderBottom = "1px dashed #444";
                        gridContainer.style.display = "grid";
                    } else {
                        // 都没连：显示默认网格的“等待连接”状态
                        topImgContainer.style.display = "none";
                        gridContainer.style.display = "grid";
                    }

                    // === 任务A：追溯 Prompt 字符串并渲染碎图网格 ===
                    let currentPromptVal = "";
                    if (hasPromptLink) {
                        const link = this.graph.links[promptInput.link];
                        if (link) {
                            const originNode = this.graph.getNodeById(link.origin_id);
                            if (originNode) {
                                const pWidget = originNode.widgets?.find(w => w.name === "prompt_text" || w.name === "输入prompt" || w.name === "combo_prompt");
                                if (pWidget) currentPromptVal = pWidget.value;
                            }
                        }
                    }
                    // 有变化才重绘，保护性能
                    if (currentPromptVal !== this.lastPrompt || (hasPromptLink === false && this.lastPrompt !== null)) {
                        this.lastPrompt = hasPromptLink ? currentPromptVal : null;
                        if (hasPromptLink) {
                            await renderViewerCards(this.viewerContainer, currentPromptVal, this);
                        } else {
                            gridContainer.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #555; font-size: 12px; padding: 20px;">等待输入连接...</div>`;
                        }
                    }

                    // === 任务B：追溯 组合大图 ===
                    let currentComboName = null;
                    if (hasImgLink) {
                        const link = this.graph.links[imgInput.link];
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
                        let imgUrl = null;
                        if (currentComboName && currentComboName !== "无可用组合_请先创建") {
                            if (STATE.localDB.contexts && STATE.localDB.models?.main_models) {
                                const parts = currentComboName.match(/^\[(.*?)\]\s*(.*)$/);
                                if (parts) {
                                    const m_name = parts[1];
                                    const c_name = parts[2];
                                    for (const [mId, mData] of Object.entries(STATE.localDB.models.main_models)) {
                                        let checkName = (mData.name || mId).replace(/\[☁️在线\]\s*/, '').replace(/订阅库-\s*/, '');
                                        if (checkName === m_name) {
                                            const combo = STATE.localDB.contexts[`${mId}_global`]?.combos?.find(c => c.name === c_name);
                                            if (combo && combo.image) { imgUrl = combo.image; break; }
                                        }
                                    }
                                }
                            }
                        }
                        
                        if (imgUrl) { 
                            imgEl.src = imgUrl; // 移除暴力时间戳，拥抱浏览器物理缓存
                            imgEl.style.display = "block";
                            imgPlaceholder.style.display = "none";
                        } else { 
                            imgEl.style.display = "none";
                            imgPlaceholder.style.display = "block";
                            imgPlaceholder.innerText = currentComboName ? "该组合暂无预览图" : "等待输入连接...";
                        }
                    }
                    
                    setTimeout(checkUpdate, 300); // 加快 UI 感知速度
                };
                
                const onRemoved = this.onRemoved;
                this.onRemoved = function() {
                    this.isDestroyed = true;
                    if (onRemoved) onRemoved.apply(this, arguments);
                };

                checkUpdate();
                this.setSize([300, 300]);
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