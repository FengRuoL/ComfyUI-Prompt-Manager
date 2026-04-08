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

// 注册: PromptViewerNode
app.registerExtension({
    name: "PromptManager.ViewerNode",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "PromptViewerNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                const container = document.createElement("div");
                container.style.cssText = "width: 100%; min-width: 200px; min-height: 100px; height: 100%; overflow-y: auto; background: #151515; border-radius: 8px; padding: 10px; box-sizing: border-box; display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); grid-auto-rows: max-content; align-items: start; gap: 8px;";
                
                // 拦截鼠标滚轮和点击事件，防止穿透到底层 ComfyUI 画布导致误触缩放或拖拽
                container.addEventListener("wheel", (e) => { e.stopPropagation(); }, { passive: false });
                container.addEventListener("pointerdown", (e) => { e.stopPropagation(); });
                
                this.addDOMWidget("viewer_grid", "HTML", container, { serialize: false, hideOnZoom: false });
                
                this.viewerContainer = container;
                this.lastPrompt = null;
                this.forceRefreshViewer = () => { this.lastPrompt = null; };
                
                const checkUpdate = async () => {
                    if (this.flags?.collapsed || !this.graph) { setTimeout(checkUpdate, 500); return; }
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

// 注册: PromptPreviewNode
app.registerExtension({
    name: "PromptManager.PreviewNode",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "PromptPreviewNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                const container = document.createElement("div");
                container.style.cssText = "width: 100%; height: 100%; min-height: 200px; display: flex; align-items: center; justify-content: center; background: #111; border-radius: 8px; overflow: hidden; border: 1px dashed #444;";
                
                const img = document.createElement("img");
                img.style.cssText = "max-width: 100%; max-height: 100%; object-fit: contain; display: none; cursor: zoom-in;";
                
                const placeholder = document.createElement("div");
                placeholder.style.cssText = "color: #555; font-size: 12px; font-weight: bold; text-align: center;";
                placeholder.innerHTML = "等待连接到<br><span style='color:#ff6b9d'>[组合预设加载器]</span>";

                // 新增：图片加载成功回调
                img.onload = () => {
                    img.style.display = "block";
                    placeholder.style.display = "none";
                };

                // 新增：图片加载失败（死链/404）回调
                img.onerror = () => {
                    img.style.display = "none";
                    placeholder.style.display = "block";
                    placeholder.innerHTML = "预览图读取失败<br><span style='color:#f44336; font-size:10px;'>原图可能已被删除或移动</span>";
                };

                img.addEventListener("pointerup", (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (img.src && img.style.display === "block") { // 仅在图片正常显示时允许点击放大
                        let viewer = document.getElementById("pm-standalone-viewer");
                        const fullImgEl = document.getElementById("pm-standalone-img");
                        if (viewer && fullImgEl) { fullImgEl.src = img.src; window.pmShowModal("pm-standalone-viewer"); }
                    }
                });
                
                container.appendChild(img); container.appendChild(placeholder);
                this.addDOMWidget("preview_img", "HTML", container, { serialize: false, hideOnZoom: false });
                
                this.lastCombo = null;
                const checkUpdate = () => {
                    if (!this.graph || this.flags?.collapsed) { setTimeout(checkUpdate, 500); return; }
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
                            img.style.display = "none"; placeholder.style.display = "block";
                            placeholder.innerHTML = "等待连接到<br><span style='color:#ff6b9d'>[组合预设加载器]</span>";
                        } else {
                            let imgUrl = null;
                            if (STATE.localDB.contexts) {
                                let actualComboName = currentComboName;
                                // 提取真实的组合名（剥离 "[模型名] " 前缀）
                                const parts = currentComboName.match(/^\[(.*?)\]\s*(.*)$/);
                                if (parts) actualComboName = parts[2];
                                
                                for (const ctx of Object.values(STATE.localDB.contexts)) {
                                    const combo = (ctx.combos || []).find(c => c.name === actualComboName);
                                    if (combo && combo.image) { imgUrl = combo.image; break; }
                                }
                            }
                            if (imgUrl) { 
                                // 添加时间戳，彻底打破各种浏览器的强制缓存机制
                                img.src = imgUrl + "?t=" + new Date().getTime(); 
                            }
                            else { 
                                img.style.display = "none"; placeholder.style.display = "block"; placeholder.innerText = "该组合尚未上传预览图"; 
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