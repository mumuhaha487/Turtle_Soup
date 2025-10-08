// 页面切换
function showPage(page) {
    document.getElementById('page-home').style.display = page === 'home' ? '' : 'none';
    document.getElementById('page-create').style.display = page === 'create' ? '' : 'none';
    document.getElementById('page-join').style.display = page === 'join' ? '' : 'none';
    document.getElementById('page-chat').style.display = page === 'chat' ? '' : 'none';
    if (page === 'chat') {
        document.getElementById('user-input').focus();
    }
}

document.addEventListener('DOMContentLoaded', function() {
// 全局状态
let roomCode = '';
let nickname = '';
let isOwner = false;
let polling = null;
let isUploading = false;
// 当前题目信息缓存
let currentStoryInfo = null;
let isAnswerRevealed = false;
// ========== 无AI群聊相关 ==========
let chatPolling = null;
let onlinePolling = null;
let sendBtn;
let createBtn;
let joinBtn;
// 创建房间
createBtn = document.getElementById('create-room-btn');
createBtn.onclick = async function() {
    const nick = document.getElementById('create-nickname').value.trim();
    // 读取下拉或自定义
    const baseUrlSelect = document.getElementById('create-base-url-select');
    const apiKeySelect = document.getElementById('create-api-key-select');
    const modelSelect = document.getElementById('create-model-select');
    const base_url_custom = document.getElementById('create-base-url').value.trim();
    const api_key_custom = document.getElementById('create-api-key').value.trim();
    const model_custom = document.getElementById('create-model').value.trim();
    const base_url = base_url_custom || (baseUrlSelect && baseUrlSelect.value) || '';
    const api_key = api_key_custom || (apiKeySelect && apiKeySelect.value) || '';
    const model = model_custom || (modelSelect && modelSelect.value) || '';
    if (!nick || !base_url || !api_key || !model) {
        document.getElementById('create-error').textContent = '请填写完整信息';
        return;
    }
    createBtn.disabled = true;
    document.getElementById('create-error').textContent = '';
    try {
        const res = await fetch('/api/create_room', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({nickname: nick, base_url, api_key, model})
        });
        const data = await res.json();
        if (data.code) {
            roomCode = data.code;
            nickname = nick;
            isOwner = true;
            enterChat();
        } else {
            document.getElementById('create-error').textContent = data.error || '创建失败';
        }
    } catch (e) {
        document.getElementById('create-error').textContent = '网络错误';
    }
    createBtn.disabled = false;
};
// 加入房间
joinBtn = document.getElementById('join-room-btn');
joinBtn.onclick = async function() {
    const nick = document.getElementById('join-nickname').value.trim();
    const code = document.getElementById('join-code').value.trim().toUpperCase();
    if (!nick || !code) {
        document.getElementById('join-error').textContent = '请填写完整信息';
        return;
    }
    joinBtn.disabled = true;
    document.getElementById('join-error').textContent = '';
    try {
        const res = await fetch('/api/join_room', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({nickname: nick, code})
        });
        const data = await res.json();
        if (data.success) {
            roomCode = code;
            nickname = nick;
            isOwner = false;
            enterChat(data.room);
        } else {
            document.getElementById('join-error').textContent = data.error || '加入失败';
        }
    } catch (e) {
        document.getElementById('join-error').textContent = '网络错误';
    }
    joinBtn.disabled = false;
};

// 进入群聊页
function enterChat(roomInfo) {
    showPage('chat');
    document.getElementById('invite-code').textContent = roomCode;
    document.getElementById('room-info-text').textContent = roomInfo ? `房主: ${roomInfo.owner} | 模型: ${roomInfo.model}` : '';
    window.roomOwner = roomInfo ? roomInfo.owner : '';
    document.getElementById('delete-room-btn').style.display = isOwner ? '' : 'none';
    document.getElementById('user-input').value = '';
    document.getElementById('chat-box').innerHTML = '';
    document.getElementById('story-ops').style.display = isOwner ? '' : 'none';
    setupUploadBtn(); // 设置上传按钮
    fetchCurrentStory();
    startPolling();
    saveSession();
    pollChatMessages();
    pollOnlineUsers();
    if (chatPolling) clearInterval(chatPolling);
    if (onlinePolling) clearInterval(onlinePolling);
    chatPolling = setInterval(pollChatMessages, 2000);
    onlinePolling = setInterval(pollOnlineUsers, 5000);
    startHeartbeat();
    // 在进入房间时重置弹窗标志
    window._popupPassedFlag = false;
}

// 发送消息
sendBtn = document.getElementById('send-btn');
sendBtn.onclick = async function() {
    const content = document.getElementById('user-input').value.trim();
    if (!content) return;
    sendBtn.disabled = true;
    document.getElementById('user-input').disabled = true;
    try {
        await sendAIMessage(content);
        document.getElementById('user-input').value = '';
    } catch (e) {}
    sendBtn.disabled = false;
    document.getElementById('user-input').disabled = false;
    document.getElementById('user-input').focus();
};

document.getElementById('user-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        sendBtn.click();
    }
});

// 轮询消息
function startPolling() {
    if (polling) clearInterval(polling);
    pollMessages();
    polling = setInterval(pollMessages, 2000);
}
async function pollMessages() {
    if (!roomCode) return;
    try {
        const res = await fetch('/api/get_messages', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({code: roomCode})
        });
        const data = await res.json();
        if (data.messages) {
            renderMessages(data.messages);
        }
        // 新增：全房间弹窗过关
        if (data.passed && !window._popupPassedFlag) {
            window._popupPassedFlag = true;
            showPopup('恭喜过关');
        }
    } catch (e) {}
}
function renderMessages(msgs) {
    const chatBox = document.getElementById('chat-box');
    const isAtBottom = chatBox.scrollTop + chatBox.clientHeight >= chatBox.scrollHeight - 10;
    chatBox.innerHTML = '';
    for (const msg of msgs) {
        if (msg.role === 'system') {
            const div = document.createElement('div');
            div.style = 'text-align:center;color:#94a3b8;font-size:13px;margin:6px 0;';
            div.innerHTML = escapeHtml(msg.content);
            chatBox.appendChild(div);
            continue;
        }
        const div = document.createElement('div');
        div.className = 'bubble ' + (msg.role === 'user' ? 'msg-user' : 'msg-ai');
        div.innerHTML = `<span class=\"msg-nickname\">${msg.nickname}</span>: ${escapeHtml(msg.content)}`;
        chatBox.appendChild(div);
    }
    if (isAtBottom) {
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}
function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, function(c) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    }).replace(/\n/g, '<br>');
}

// 删除房间
const deleteBtn = document.getElementById('delete-room-btn');
deleteBtn.onclick = async function() {
    if (!confirm('确定要删除房间吗？')) return;
    try {
        await fetch('/api/delete_room', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({code: roomCode, nickname})
        });
        alert('房间已删除');
        leaveRoom();
    } catch (e) {}
};

// 退出房间
function leaveRoom() {
    if (polling) clearInterval(polling);
    roomCode = '';
    nickname = '';
    isOwner = false;
    localStorage.removeItem('haigui_room');
    showPage('home');
}

// 新增：上传题目、切换题目、显示当前题面
function renderStory(story) {
    currentStoryInfo = story;
    isAnswerRevealed = !!(story && story.answer && story.answer.length > 0);
    const storyDiv = document.getElementById('current-story');
    let html = '';
    if (!story) {
        html = '<em>暂无题目，请房主上传海龟汤题目</em>';
    } else {
        html += `<div style=\"margin-bottom:8px;\">${escapeHtml(story.surface || '')}</div>`;
        // 删除揭晓答案的显示，只在聊天框中显示
    }
    // 房主操作区
    if (isOwner && story) {
        html += `<div style=\"margin-top:10px;\">`;
        if (!story.answer || story.answer.length === 0) {
            html += `<button class=\"btn\" id=\"reveal-answer-btn\">揭晓答案</button>`;
        }
        html += `</div>`;
    }
    storyDiv.innerHTML = html;
    // 绑定房主操作按钮
    if (isOwner && story) {
        const revealBtn = document.getElementById('reveal-answer-btn');
        if (revealBtn) {
            revealBtn.onclick = async function() {
                if (!confirm('确定要揭晓答案吗？')) return;
                await fetch('/api/reveal_answer', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({code: roomCode, nickname})
                });
                fetchCurrentStory();
            };
        }
    }
}

// 新增：从故事广场加载故事
async function loadStoryFromPlaza(filename) {
    try {
        const response = await fetch('/api/load_story_from_plaza', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({code: roomCode, nickname, filename})
        });
        const data = await response.json();
        if (data.success) {
            alert('故事加载成功');
            fetchCurrentStory();
            fetchStoryList && fetchStoryList();
        } else {
            alert('加载失败：' + (data.error || '未知错误'));
        }
    } catch (error) {
        alert('加载失败：网络错误');
    }
}

// 新增：获取故事广场列表
async function getPlazaStories() {
    try {
        const response = await fetch('/api/get_plaza_stories');
        const data = await response.json();
        return data.stories;
    } catch (error) {
        console.error('获取故事广场失败:', error);
        return [];
    }
}

// 新增：显示故事广场选择窗口（美化弹窗+下拉）
async function showPlazaStorySelector() {
    const stories = await getPlazaStories();
    if (stories.length === 0) {
        alert('故事广场暂无故事');
        return;
    }
    // 构建弹窗
    let modal = document.getElementById('plaza-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'plaza-modal';
        modal.style = 'display:flex;position:fixed;left:0;top:0;width:100vw;height:100vh;background:rgba(0,0,0,0.18);z-index:999;align-items:center;justify-content:center;';
        modal.innerHTML = `
        <div style="background:#fff;padding:32px 24px;border-radius:16px;box-shadow:0 8px 32px 0 rgba(31,38,135,0.15);max-width:340px;width:90vw;">
            <h3 style="color:#3b82f6;text-align:center;margin-bottom:18px;">从故事广场加载</h3>
            <form id="plaza-select-form">
                <div class="form-group">
                    <label>选择故事编号</label>
                    <select id="plaza-story-select" style="width:100%;padding:8px 6px;border-radius:8px;border:1.5px solid #cbd5e1;font-size:15px;background:#f8fafc;">
                        ${stories.map(story => `<option value="${story.filename}">${story.name} ${story.id}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>或直接输入编号</label>
                    <input type="text" id="plaza-story-input" placeholder="如: #00001" style="width:100%;padding:8px 6px;border-radius:8px;border:1.5px solid #cbd5e1;font-size:15px;background:#f8fafc;">
                    <div id="plaza-story-match" style="margin-top:4px;font-size:13px;color:#64748b;"></div>
                </div>
                <button class="btn start-btn" type="submit" style="width:100%;margin-top:10px;">加载</button>
                <button class="btn" type="button" onclick="closePlazaModal()" style="width:100%;background:#e5e7eb;color:#334155;margin-top:8px;">取消</button>
            </form>
            <div id="plaza-select-result" style="margin-top:10px;"></div>
        </div>`;
        document.body.appendChild(modal);
        window.closePlazaModal = function() { modal.style.display = 'none'; };
        
        // 输入编号时自动匹配
        const input = modal.querySelector('#plaza-story-input');
        const matchDiv = modal.querySelector('#plaza-story-match');
        input.addEventListener('input', function() {
            const inputValue = this.value.trim();
            if (inputValue) {
                const matchedStory = stories.find(story => story.id === inputValue);
                if (matchedStory) {
                    matchDiv.innerHTML = `匹配到: ${matchedStory.name}`;
                    matchDiv.style.color = '#10b981';
                } else {
                    matchDiv.innerHTML = '未找到该编号的故事';
                    matchDiv.style.color = '#f87171';
                }
            } else {
                matchDiv.innerHTML = '';
            }
        });
        
        document.getElementById('plaza-select-form').onsubmit = async function(e) {
            e.preventDefault();
            const filename = document.getElementById('plaza-story-select').value;
            const inputValue = document.getElementById('plaza-story-input').value.trim();
            let targetFilename = filename;
            
            // 如果输入了编号，优先使用输入的编号
            if (inputValue) {
                const matchedStory = stories.find(story => story.id === inputValue);
                if (matchedStory) {
                    targetFilename = matchedStory.filename;
                } else {
                    document.getElementById('plaza-select-result').innerHTML = '<div class="error">未找到该编号的故事</div>';
                    return;
                }
            }
            
            if (!targetFilename) return;
            try {
                const response = await fetch('/api/load_story_from_plaza', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({code: roomCode, nickname, filename: targetFilename})
                });
                const data = await response.json();
                if (data.success) {
                    alert('故事加载成功');
                    closePlazaModal();
                    fetchCurrentStory();
                    fetchStoryList && fetchStoryList();
                } else {
                    document.getElementById('plaza-select-result').innerHTML = '<div class="error">' + (data.error || '加载失败') + '</div>';
                }
            } catch (error) {
                document.getElementById('plaza-select-result').innerHTML = '<div class="error">网络错误</div>';
            }
        };
    } else {
        // 刷新下拉选项
        const select = modal.querySelector('#plaza-story-select');
        select.innerHTML = stories.map(story => `<option value="${story.filename}">${story.name} ${story.id}</option>`).join('');
        modal.style.display = 'flex';
    }
    modal.style.display = 'flex';
}

// 修复上传题目按钮
function setupUploadBtn() {
    const storyOps = document.getElementById('story-ops');
    if (!storyOps) return;
    storyOps.innerHTML = `
        <div style="margin-bottom: 12px;">
            <input type="file" id="story-file" accept=".json" multiple style="display:none;">
            <button class="btn" id="upload-story-btn">上传题目 (json)</button>
            <button class="btn" id="load-plaza-btn">从故事广场加载</button>
            <div style="color: #64748b; font-size: 12px; margin-top: 4px;">文件大小不能超过20MB</div>
        </div>
        <div id="story-list" style="margin-bottom: 12px;"></div>
    `;
    document.getElementById('upload-story-btn').onclick = function() {
        document.getElementById('story-file').click();
    };
    document.getElementById('load-plaza-btn').onclick = function() {
        showPlazaStorySelector();
    };
    document.getElementById('story-file').onchange = async function() {
        if (isUploading) return;
        isUploading = true;
        const files = this.files;
        if (files.length === 0) {
            isUploading = false;
            return;
        }
        const formData = new FormData();
        for (let file of files) {
            formData.append('file', file);
        }
        formData.append('code', roomCode);
        formData.append('nickname', nickname);
        try {
            const res = await fetch('/api/upload_story', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                alert(`上传成功，共${data.count}个题目`);
                fetchCurrentStory();
                fetchStoryList && fetchStoryList();
            } else {
                alert('上传失败：' + (data.error || '未知错误'));
            }
        } catch (e) {
            alert('上传失败：网络错误');
        }
        isUploading = false;
        this.value = '';
    };
}

// 获取题库列表并渲染切换下拉框
async function fetchStoryList() {
    if (!roomCode || !isOwner) return;
    try {
        const res = await fetch('/api/get_current_story', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({code: roomCode})
        });
        // 题库数量通过上传后返回的count，前端需维护
        // 这里简化为每次上传/切换后刷新页面即可
    } catch (e) {}
}

// 切换题目
async function setStoryIndex(idx) {
    if (!roomCode || !isOwner) return;
    try {
        const res = await fetch('/api/set_story', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({code: roomCode, nickname, index: idx})
        });
        const data = await res.json();
        if (data.success) {
            await fetchCurrentStory();
            await pollMessages();
            saveSession();
        } else {
            alert(data.error || '切换失败');
        }
    } catch (e) {
        alert('切换失败');
    }
}

// 获取当前故事信息
async function fetchCurrentStory() {
    if (!roomCode) return;
    try {
        const res = await fetch('/api/get_current_story', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({code: roomCode})
        });
        const data = await res.json();
        if (data.surface !== undefined) {
            renderStory({surface: data.surface, victory_condition: data.victory_condition, answer: data.answer});
        } else {
            renderStory(null);
        }
    } catch (e) {
        renderStory(null);
    }
}

// 页面初始化，插入题目上传和切换控件
(function(){
    const chatPage = document.getElementById('page-chat');
    const storyOps = document.createElement('div');
    storyOps.id = 'story-ops';
    storyOps.style = 'margin-bottom:12px;display:none;text-align:center;';
    chatPage.insertBefore(storyOps, chatPage.firstChild);
    // 当前题目展示区
    const storyDiv = document.createElement('div');
    storyDiv.id = 'current-story';
    storyDiv.style = 'background:#f1f5f9;border-radius:10px;padding:12px 10px;margin-bottom:12px;min-height:48px;';
    chatPage.insertBefore(storyDiv, storyOps.nextSibling);
})();

// 保持刷新后页面还在群聊页
function saveSession() {
    if (roomCode && nickname) {
        localStorage.setItem('haigui_room', JSON.stringify({roomCode, nickname, isOwner}));
    }
}
function loadSession() {
    const data = localStorage.getItem('haigui_room');
    if (data) {
        try {
            const obj = JSON.parse(data);
            roomCode = obj.roomCode;
            nickname = obj.nickname;
            isOwner = obj.isOwner;
            enterChat();
        } catch (e) {}
    }
}

// 页面加载时自动恢复
window.addEventListener('DOMContentLoaded', loadSession);

// 默认显示首页
showPage('home');

let leaveRoomBtn;
leaveRoomBtn = document.querySelector('button[onclick="leaveRoom()"]');
if (leaveRoomBtn) {
    leaveRoomBtn.onclick = function() { leaveRoom(); };
}

// 公告侧栏渲染
(async function renderAnnouncements(){
    try {
        const resp = await fetch('/api/get_announcements');
        const data = await resp.json();
        const content = (data && data.content) ? data.content : '';
        // 在左侧创建公告栏
        let left = document.getElementById('announcement-panel');
        if (!left) {
            left = document.createElement('div');
            left.id = 'announcement-panel';
            left.style.background = '#fff';
            left.style.border = '3px solid #000';
            left.style.borderRadius = '0';
            left.style.padding = '10px 12px 10px 12px';
            left.style.marginTop = '48px';
            left.style.maxWidth = '320px';
            left.style.minWidth = '220px';
            left.style.marginRight = '16px';
            left.style.position = 'relative';
            left.style.fontFamily = '"Courier New", monospace';

            // 添加阴影效果
            left.innerHTML = '<div style="position:absolute;top:-3px;left:-3px;right:-3px;bottom:-3px;background:#000;z-index:-1;transform:translate(6px,6px);"></div>';

            // 将公告栏插入到主布局最左侧
            const layout = document.querySelector('.main-layout');
            if (layout) layout.insertBefore(left, layout.firstChild);
        }
        left.innerHTML = '<div style="position:absolute;top:-3px;left:-3px;right:-3px;bottom:-3px;background:#000;z-index:-1;transform:translate(6px,6px);"></div>' +
            '<div style="font-size:15px;color:#000;font-weight:bold;margin-bottom:6px;font-family:\'Courier New\',monospace;">公告</div>' +
            '<div style="white-space:pre-wrap;color:#000;line-height:1.6;font-family:\'Courier New\',monospace;">' + (content ? escapeHtml(content) : '暂无公告') + '</div>';
    } catch (e) {}
})();

// 初始化创建房间下拉选项
(function ensureCreateDropdowns(){
    // 兼容旧模板：如果没有下拉，动态创建
    const makeGroup = (inputId, selectId, labelText) => {
        const input = document.getElementById(inputId);
        if (!input || document.getElementById(selectId)) return; // 已存在或找不到输入框
        const parent = input.parentElement;
        // 创建容器
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.gap = '8px';
        // 创建select
        const select = document.createElement('select');
        select.id = selectId;
        select.style.flex = '1';
        select.style.border = '1.5px solid #cbd5e1';
        select.style.borderRadius = '8px';
        select.style.padding = '8px';
        select.style.background = '#f8fafc';
        // 插入
        parent.insertBefore(wrapper, input);
        wrapper.appendChild(select);
        wrapper.appendChild(input);
        input.style.flex = '1';
    };
    makeGroup('create-base-url', 'create-base-url-select');
    makeGroup('create-api-key', 'create-api-key-select');
    makeGroup('create-model', 'create-model-select');
})();

(async function initCreateOptions(){
    try {
        const resp = await fetch('/api/get_options');
        const data = await resp.json();
        const opt = data.options || {models:[], base_urls:[], api_keys:[]};
        const fill = (id, list)=>{
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = '';
            const def = document.createElement('option');
            def.value = '';
            def.textContent = '请选择';
            el.appendChild(def);
            list.forEach(v=>{
                const o = document.createElement('option');
                o.value = v; o.textContent = v; el.appendChild(o);
            });
            // 默认选中第一个可用项
            if (list && list.length) el.value = list[0];
        };
        fill('create-base-url-select', opt.base_urls || []);
        fill('create-api-key-select', opt.api_keys || []);
        fill('create-model-select', opt.models || ['gpt-5-chat-2025-08-07']);
    } catch (e) {}
})();

function renderChatMessages(msgs) {
    const box = document.getElementById('chat-box-chat');
    box.innerHTML = '';
    for (const msg of msgs) {
        let html = `<span class='msg-nickname' style='color:#3b82f6;'>${escapeHtml(msg.nickname)}</span>: `;
        let content = escapeHtml(msg.content);
        // @高亮
        const users = (currentOnlineUsers || []);
        users.forEach(u => {
            if (u && content.includes('@' + u)) {
                content = content.replaceAll('@' + u, `<span style='background:yellow;color:#d97706;padding:1px 4px;border-radius:4px;'>@${u}</span>`);
            }
        });
        html += content;
        const div = document.createElement('div');
        div.style = 'margin:2px 0;line-height:1.7;';
        div.innerHTML = html;
        box.appendChild(div);
    }
    box.scrollTop = box.scrollHeight;
}

let currentOnlineUsers = [];
function renderOnlineUsers(users) {
    currentOnlineUsers = users;
    // 渲染新用户列表
    const userList = document.getElementById('user-list');
    userList.innerHTML = '';
    users.forEach(u => {
        const div = document.createElement('div');
        div.style = 'display:flex;align-items:center;padding:6px 16px 6px 12px;margin-bottom:2px;border-radius:8px;transition:background 0.2s;cursor:pointer;';
        if (u === nickname) {
            div.style.background = '#dbeafe';
        } else {
            div.onmouseover = () => div.style.background = '#e0e7ff';
            div.onmouseout = () => div.style.background = '';
        }
        // 头像（首字母圆形）
        const avatar = document.createElement('div');
        avatar.textContent = u[0].toUpperCase();
        avatar.style = 'width:32px;height:32px;background:#3b82f6;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:18px;margin-right:10px;box-shadow:0 2px 8px 0 rgba(59,130,246,0.08);';
        div.appendChild(avatar);
        // 昵称
        const nameSpan = document.createElement('span');
        nameSpan.textContent = u;
        nameSpan.style = 'font-size:15px;font-weight:500;color:#334155;';
        div.appendChild(nameSpan);
        // 标签
        const tag = document.createElement('span');
        tag.style = 'margin-left:10px;padding:2px 8px;border-radius:8px;font-size:12px;font-weight:bold;';
        if (u === window.roomOwner) {
            tag.textContent = '房主';
            tag.style.background = '#fef3c7';
            tag.style.color = '#b45309';
        } else {
            tag.textContent = '成员';
            tag.style.background = '#e0e7ff';
            tag.style.color = '#2563eb';
        }
        div.appendChild(tag);
        userList.appendChild(div);
    });
}

async function pollChatMessages() {
    if (!roomCode) return;
    try {
        const res = await fetch('/api/get_chat_messages', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({code: roomCode})
        });
        const data = await res.json();
        if (data.messages) renderChatMessages(data.messages);
    } catch (e) {}
}

async function pollOnlineUsers() {
    if (!roomCode) return;
    try {
        const res = await fetch('/api/get_online_users', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({code: roomCode})
        });
        const data = await res.json();
        if (data.users) renderOnlineUsers(data.users);
    } catch (e) {}
}

// 发送无AI群聊消息
const chatSendBtn = document.getElementById('chat-send-btn');
chatSendBtn.onclick = async function() {
    const input = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content) return;
    chatSendBtn.disabled = true;
    input.disabled = true;
    try {
        await fetch('/api/send_chat_message', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({code: roomCode, nickname, content})
        });
        input.value = '';
        await pollChatMessages();
    } catch (e) {}
    chatSendBtn.disabled = false;
    input.disabled = false;
    input.focus();
};
document.getElementById('chat-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        chatSendBtn.click();
    }
});

// 聊天输入框支持多行
const userInput = document.getElementById('user-input');
if (userInput) {
    userInput.setAttribute('rows', '1');
    userInput.setAttribute('style', 'resize:vertical;min-height:40px;max-height:120px;');
    userInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
}

// 心跳机制
function startHeartbeat() {
    setInterval(async () => {
        if (!roomCode || !nickname) return;
        await fetch('/api/heartbeat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({code: roomCode, nickname})
        });
    }, 30000);
} 

// 弹窗函数
function showPopup(msg) {
    let popup = document.createElement('div');
    popup.style.position = 'fixed';
    popup.style.left = '50%';
    popup.style.top = '30%';
    popup.style.transform = 'translate(-50%, -50%)';
    popup.style.background = 'rgba(255,255,255,0.98)';
    popup.style.fontWeight = 'bold';
    popup.style.fontSize = '2.2rem';
    popup.style.padding = '36px 60px 32px 60px';
    popup.style.borderRadius = '22px';
    popup.style.boxShadow = '0 12px 40px 0 rgba(31,38,135,0.18)';
    popup.style.zIndex = 9999;
    popup.style.display = 'flex';
    popup.style.flexDirection = 'column';
    popup.style.alignItems = 'center';
    // 彩色渐变字体
    popup.style.backgroundClip = 'padding-box';
    let text = document.createElement('div');
    text.textContent = msg;
    text.style.background = 'linear-gradient(90deg, #3b82f6 10%, #a21caf 90%)';
    text.style.webkitBackgroundClip = 'text';
    text.style.webkitTextFillColor = 'transparent';
    text.style.backgroundClip = 'text';
    text.style.textFillColor = 'transparent';
    text.style.fontWeight = 'bold';
    text.style.fontSize = '2.2rem';
    text.style.textAlign = 'center';
    popup.appendChild(text);
    // 关闭按钮
    let closeBtn = document.createElement('span');
    closeBtn.textContent = '×';
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '12px';
    closeBtn.style.right = '24px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '2rem';
    closeBtn.style.color = '#a21caf';
    closeBtn.style.fontWeight = 'bold';
    closeBtn.onclick = function() { popup.remove(); };
    popup.appendChild(closeBtn);
    document.body.appendChild(popup);
}

// 发送AI消息时按钮转圈圈
let sendBtnOriginal = sendBtn.innerHTML;
async function sendAIMessage(content) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="spinner" style="display:inline-block;width:22px;height:22px;border:3px solid #3b82f6;border-top:3px solid #fff;border-radius:50%;animation:spin 1s linear infinite;vertical-align:middle;"></span>';
    let msg_id = null;
    try {
        const res = await fetch('/api/send_message', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({code: roomCode, nickname, content})
        });
        const data = await res.json();
        if (data.msg_id) {
            msg_id = data.msg_id;
        } else if (data.reply) {
            // 兼容老接口
            await pollMessages();
            if (data.popup === '恭喜过关') showPopup('恭喜过关');
            sendBtn.disabled = false;
            sendBtn.innerHTML = sendBtnOriginal;
            return;
        } else {
            alert(data.error || 'AI消息发送失败');
            sendBtn.disabled = false;
            sendBtn.innerHTML = sendBtnOriginal;
            return;
        }
    } catch (e) {
        alert('AI消息发送失败');
        sendBtn.disabled = false;
        sendBtn.innerHTML = sendBtnOriginal;
        return;
    }
    // 轮询AI回复
    let start = Date.now();
    let gotReply = false;
    while (!gotReply && Date.now() - start < 30000) {
        await new Promise(r => setTimeout(r, 800));
        try {
            const res2 = await fetch('/api/get_ai_reply', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({msg_id})
            });
            const data2 = await res2.json();
            if (data2.status === 'pending') continue;
            if (data2.reply) {
                await pollMessages();
                if (data2.popup === '恭喜过关') showPopup('恭喜过关');
                gotReply = true;
                break;
            } else if (data2.error) {
                alert(data2.error);
                break;
            }
        } catch (e) {
            alert('AI回复获取失败');
            break;
        }
    }
    if (!gotReply) {
        alert('AI回复超时，请重试');
    }
    sendBtn.disabled = false;
    sendBtn.innerHTML = sendBtnOriginal;
}
// 加入转圈动画样式
const style = document.createElement('style');
style.innerHTML = `@keyframes spin { 0% { transform: rotate(0deg);} 100% {transform: rotate(360deg);} }`;
document.head.appendChild(style); 
}); 