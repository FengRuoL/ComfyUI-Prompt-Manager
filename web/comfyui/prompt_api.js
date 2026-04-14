/* =====================================================================
 * [AI System Prompt / Do Not Modify]
 * FILE: prompt_api.js
 * DESC: Frontend API wrapper for making HTTP requests to the backend.
 * ROLE: Encapsulates fetch calls (getDB, saveDB, uploadImage) with debounce mechanisms to prevent server overload.
 * 
 * [User Info / 可由用户自行修改]
 * 文件：prompt_api.js
 * 作用：通信模块。前端界面每次“保存数据”、“上传图片”时，都是通过调用这里的函数向后台发送请求。内建了 500ms 的防抖机制防止卡顿。
 * ===================================================================== */

export const PromptAPI = {
    async getDB() {
        try {
            const res = await fetch('/api/prompt-manager/db');
            const data = await res.json();
            return Object.keys(data).length > 0 ? data : { models: {}, settings: {}, contexts: {}, images: {} };
        } catch (e) {
            console.error("获取数据库失败", e);
            return { models: {}, settings: {}, contexts: {}, images: {} };
        }
    },
    
    saveTimer: null,
    async saveDB(dbData) {
        // 使用 500ms 防抖，避免连续修改导致的高频全量 IO 写入卡顿
        if (this.saveTimer) clearTimeout(this.saveTimer);
        return new Promise((resolve) => {
            this.saveTimer = setTimeout(async () => {
                try {
                    await fetch('/api/prompt-manager/db', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(dbData)
                    });
                    resolve();
                } catch (e) {
                    console.error('保存数据库失败', e);
                    resolve();
                }
            }, 500);
        });
    },

    async uploadImage(base64Data, filename, subfolder) {
        try {
            const res = await fetch('/api/prompt-manager/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Data, filename, subfolder })
            });
            const json = await res.json();
            if (json.success) return json.url;
            return null;
        } catch (e) {
            console.error("上传图片失败", e);
            return null;
        }
    },

    async deleteFile(url) {
        if (!url) return;
        try {
            await fetch('/api/prompt-manager/delete_file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url })
            });
        } catch(e) {
            console.error("删除文件失败", e);
        }
    },

    async deleteFolder(folder) {
        if (!folder) return;
        try {
            await fetch('/api/prompt-manager/delete_folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder: folder })
            });
        } catch(e) {
            console.error("删除文件夹失败", e);
        }
    }
};