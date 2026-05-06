// 文件路径：web/comfyui/top_prompt_icon.js
import { app } from "../../scripts/app.js";

class TopPromptIconManager {
    constructor() {
        this.iconId = "lm-top-prompt-icon";
        this.isInitialized = false;
        // 定制样式：粉色背景 + 白色实心框 + 圆润大写P
        this.customStyle = {
            bgColor: "#ff6b9d",       
            boxBg: "#ffffff",         
            textColor: "#ff6b9d",     
            hoverBg: "rgba(255, 107, 157, 0.8)", 
            font: "'Microsoft YaHei', '思源黑体', Arial, sans-serif" 
        };
    }

    initialize() {
        if (this.isInitialized) return;

        // 等待顶栏容器加载
        const checkContainer = setInterval(() => {
            const settingsGroup = app?.menu?.settingsGroup;
            if (settingsGroup?.element?.parentElement) {
                clearInterval(checkContainer);
                this.createPromptIcon(settingsGroup);
                this.bindClickEvent();
                this.isInitialized = true;
                return;
            }
        }, 200);

        // 兜底超时。修复：大幅延长超时时间，照顾老爷机和重度插件用户
        setTimeout(() => {
            clearInterval(checkContainer);
        }, 15000);
    }

    createPromptIcon(settingsGroup) {
        if (document.getElementById(this.iconId)) return;

        const promptIcon = document.createElement("button");
        promptIcon.id = this.iconId;
        promptIcon.style.cssText = `
            width: auto; height: auto; border-radius: 4px;
            background: ${this.customStyle.bgColor}; border: none; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            position: relative; margin-left: 8px; transition: background 0.2s ease;
            padding: 6px; box-sizing: border-box; overflow: visible; flex-shrink: 0;
        `;
        
        promptIcon.onmouseover = () => { promptIcon.style.background = this.customStyle.hoverBg; };
        promptIcon.onmouseout = () => { promptIcon.style.background = this.customStyle.bgColor; };
        
        promptIcon.innerHTML = `
            <span style="
                display: flex; align-items: center; justify-content: center;
                width: 20px; height: 20px; background: ${this.customStyle.boxBg};
                border-radius: 3px; font-family: ${this.customStyle.font};
                font-size: 12px; font-weight: 700; color: ${this.customStyle.textColor};
                text-transform: uppercase; line-height: 1;
            ">P</span>
        `;
        promptIcon.title = "打开 Prompt 浏览器";
        
        // 插入到设置按钮组之前
        settingsGroup.element.before(promptIcon);
    }

    bindClickEvent() {
        const icon = document.getElementById(this.iconId);
        if (!icon) return;

        icon.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // 校验核心框架是否就绪
            if (window.PM_Global && window.PM_Global.ui && window.PM_Global.ui.openNativeBrowser) {
                if (window.PM_Global.utils && window.PM_Global.utils.getAndMigrateDB) {
                    window.PM_Global.state.localDB = await window.PM_Global.utils.getAndMigrateDB();
                }
                
                // 如果没有记住激活的节点，自动去画板上找第一个浏览器节点帮它绑定
                if (!window.PM_Global.state.currentActiveWidget) {
                    const browserNodes = app.graph._nodes.filter(n => n.type === "PromptBrowserNode");
                    if (browserNodes.length > 0) {
                        window.PM_Global.state.currentActiveWidget = browserNodes[0].widgets?.find(w => w.name === "输入prompt" || w.name === "prompt_text");
                    }
                }
                
                window.PM_Global.ui.openNativeBrowser();
            } else {
                alert("请先在画板上添加至少一个【Prompt浏览器】节点！");
            }
        });
    }
}

app.registerExtension({
    name: "PromptManager.TopIcon",
    setup() {
        const iconManager = new TopPromptIconManager();
        setTimeout(() => { iconManager.initialize(); }, 1000);
    }
});