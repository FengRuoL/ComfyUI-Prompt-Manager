// 静态托管链接
const CLOUD_BASE_URL = "https://fengruol.github.io/ComfyUI-Prompt-CloudDB";

export const PromptAPI = {
    async getDB() {
        try {
            // 1. 瞬间读取本地数据库
            const localRes = await fetch('/api/prompt-manager/db');
            let localData = await localRes.json();
            if (Object.keys(localData).length === 0) localData = { models: { main_models: {} }, settings: {}, contexts: {}, images: {} };

            // 2. 尝试拉取云端分包数据库 (8秒超时)
            let cloudData = { models: { main_models: {} }, settings: {}, contexts: {}, images: {} };
            let fetchCloudSuccess = false;

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000); 
                
                // 2.1 获取基础架构 system.json
                const sysRes = await fetch(`${CLOUD_BASE_URL}/data/system.json`, { signal: controller.signal });
                if (!sysRes.ok) throw new Error(`system.json HTTP error! status: ${sysRes.status}`);
                const sysText = await sysRes.text();
                // 替换图片路径为 CDN
                const sysJson = JSON.parse(sysText.replace(/\/prompt_data\//g, `${CLOUD_BASE_URL}/data/`));
                
                cloudData.models = sysJson.models || { main_models: {} };
                cloudData.settings = sysJson.settings || {};

                // 2.2 收集需要下载的分包文件名列表
                let ctxFilesToFetch = [];
                for (let mId in cloudData.models.main_models) {
                    let mData = cloudData.models.main_models[mId];
                    if (mData.modes) {
                        for (let modId in mData.modes) {
                            ctxFilesToFetch.push(`${mId}_${modId}`); // 每个三级分类对应的小包
                        }
                    }
                }

                // 2.3 并发下载所有模式的分包数据
                const fetchCtx = async (ctxId) => {
                    try {
                        const res = await fetch(`${CLOUD_BASE_URL}/data/contexts_db/${ctxId}.json`, { signal: controller.signal });
                        if (res.ok) {
                            const text = await res.text();
                            const replacedText = text.replace(/\/prompt_data\//g, `${CLOUD_BASE_URL}/data/`);
                            return { id: ctxId, data: JSON.parse(replacedText) };
                        }
                    } catch(err) { /* 忽略单个分包下载失败 */ }
                    return null;
                };

                // 使用 Promise.all 并发请求，速度极快
                const ctxResults = await Promise.all(ctxFilesToFetch.map(id => fetchCtx(id)));
                
                ctxResults.forEach(result => {
                    if (result && result.data) {
                        const { id, data } = result;
                        if (data.context) cloudData.contexts[id] = data.context;
                        if (data.images) {
                            for (let imgKey in data.images) {
                                cloudData.images[imgKey] = data.images[imgKey];
                            }
                        }
                    }
                });

                clearTimeout(timeoutId);
                fetchCloudSuccess = true;
            } catch (e) {
                console.warn("[Prompt Manager] 在线图库加载超时或失败，当前仅显示本地数据。真实报错:", e.message || e);
            }

            // 3. 将云端数据“安全合并”到本地数据中展示 (打上 cloud_ 标签)
            if (fetchCloudSuccess && cloudData.models && cloudData.models.main_models) {
                for (let mId in cloudData.models.main_models) {
                    let cloudModelId = `cloud_${mId}`;
                    let mData = cloudData.models.main_models[mId];
                    mData.name = `[☁️在线] ${mData.name}`; // 给一级分类加上在线标识
                    mData.isCloud = true;
                    localData.models.main_models[cloudModelId] = mData;
                }
                for (let ctx in cloudData.contexts) { localData.contexts[`cloud_${ctx}`] = cloudData.contexts[ctx]; }
                for (let imgKey in cloudData.images) { localData.images[`cloud_${imgKey}`] = cloudData.images[imgKey]; }
            }
            return localData;
        } catch (e) {
            console.error("数据库初始化失败", e);
            return { models: {main_models:{}}, settings: {}, contexts: {}, images: {} };
        }
    },
    
    saveTimer: null,
    async saveDB(dbData) {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        return new Promise((resolve) => {
            this.saveTimer = setTimeout(async () => {
                try {
                    // 核心：保存前，剥离所有云端数据，防止把几百MB的云端数据塞进用户本地硬盘
                    let dataToSave = JSON.parse(JSON.stringify(dbData));
                    for (let mId in dataToSave.models.main_models) { if (mId.startsWith('cloud_')) delete dataToSave.models.main_models[mId]; }
                    for (let ctx in dataToSave.contexts) { if (ctx.startsWith('cloud_')) delete dataToSave.contexts[ctx]; }
                    for (let imgKey in dataToSave.images) { if (imgKey.startsWith('cloud_')) delete dataToSave.images[imgKey]; }

                    await fetch('/api/prompt-manager/db', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(dataToSave)
                    });
                    resolve();
                } catch (e) { console.error('保存本地数据库失败', e); resolve(); }
            }, 500);
        });
    },

    async uploadImage(base64Data, filename, subfolder) {
        if (subfolder && subfolder.startsWith('cloud_')) { alert("在线图库不可上传图片！"); return null; }
        try {
            const res = await fetch('/api/prompt-manager/upload', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Data, filename, subfolder })
            });
            const json = await res.json();
            return json.success ? json.url : null;
        } catch (e) { return null; }
    },

    async deleteFile(url) {
        if (!url || url.includes('github.io')) return; // 拦截云端链接
        try { await fetch('/api/prompt-manager/delete_file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url }) }); } catch(e) {}
    },

    async deleteFolder(folder) {
        if (!folder || folder.startsWith('cloud_')) return;
        try { await fetch('/api/prompt-manager/delete_folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: folder }) }); } catch(e) {}
    }
};