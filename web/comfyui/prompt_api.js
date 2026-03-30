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
    
    async saveDB(dbData) {
        try {
            await fetch('/api/prompt-manager/db', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dbData)
            });
        } catch (e) {
            console.error('保存数据库失败', e);
        }
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