// 移动端侧栏切换
function toggleMobileSidebar() {
    var inner = document.querySelector('.mobile-sidebar-inner');
    var btn = document.querySelector('.mobile-sidebar-toggle');
    if (!inner.classList.contains('open')) {
        inner.classList.add('open');
        btn.innerHTML = '<span class="iconify" data-icon="lucide:chevrons-right"></span> 收起侧栏';
    } else {
        inner.classList.remove('open');
        btn.innerHTML = '<span class="iconify" data-icon="lucide:chevrons-left"></span> 展开侧栏';
    }
}
function showPage(page) {
    document.getElementById('page-home').style.display = page === 'home' ? '' : 'none';
    document.getElementById('page-create').style.display = page === 'create' ? '' : 'none';
    document.getElementById('page-join').style.display = page === 'join' ? '' : 'none';
    document.getElementById('page-chat').style.display = page === 'chat' ? '' : 'none';
    if (page === 'chat') {
        document.getElementById('user-input').focus();
    }
}

let socket = null;

// API 模式切换（全局函数，供 onchange 调用）
function toggleApiMode() {
    const isDefault = document.querySelector('input[name="api-mode"]:checked').value === 'default';
    document.getElementById('api-default-group').style.display = isDefault ? '' : 'none';
    document.getElementById('api-custom-group').style.display = isDefault ? 'none' : '';
}

// 故事还原功能（全局函数，供 HTML onclick 调用）
function openRestoreModal() {
    document.getElementById('restore-input').value = '';
    document.getElementById('restore-modal').style.display = 'flex';
    document.getElementById('restore-input').focus();
}
function closeRestoreModal() {
    document.getElementById('restore-modal').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', function() {
// 全局状态
let roomCode = '';
let nickname = '';
let isOwner = false;
let isUploading = false;
// 当前题目信息缓存
let currentStoryInfo = null;
let isAnswerRevealed = false;
// ========== 无AI群聊相关 ==========
let sendBtn;
let createBtn;
let joinBtn;
// ===== 站内模态工具，替代原生 alert/confirm =====
function uiBuildModal({title = '提示', message = '', showCancel = false, confirmText = '确定', cancelText = '取消'}) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45);
      display: flex; align-items: center; justify-content: center; z-index: 9999;
      backdrop-filter: blur(4px);
    `;
    const panel = document.createElement('div');
    panel.style.cssText = `
      width: 92vw; max-width: 420px; background: #fff; border-radius: 16px;
      box-shadow: 0 20px 60px rgba(2, 6, 23, .18); padding: 20px 20px 16px 20px;
      color: #0f172a; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
      transform: translateY(8px); opacity: 0; transition: all .18s ease-out;
    `;
    panel.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:6px;">
        <div style="font-weight:700; font-size:18px;">${title}</div>
        <button id="ui-close" style="border:none;background:none;cursor:pointer;font-size:22px;line-height:1;color:#64748b;">×</button>
      </div>
      <div style="font-size:14px; color:#334155; line-height:1.7; white-space:pre-wrap; margin: 8px 0 16px 0;">${message}</div>
      <div style="display:flex; gap:10px; justify-content:flex-end;">
        ${showCancel ? `<button id="ui-cancel" style="padding:10px 14px;border-radius:10px;border:1px solid #e5e7eb;background:#fff;color:#0f172a;cursor:pointer;font-weight:600;">${cancelText}</button>` : ``}
        <button id="ui-ok" style="padding:10px 14px;border-radius:10px;border:none;background:#059669;color:#fff;cursor:pointer;font-weight:700;">${confirmText}</button>
      </div>
    `;
    overlay.appendChild(panel);
    requestAnimationFrame(() => {
        panel.style.transform = 'translateY(0)';
        panel.style.opacity = '1';
    });
    return {overlay, panel};
}
function uiAlert(message, title = '提示') {
    return new Promise(resolve => {
        const {overlay} = uiBuildModal({title, message, showCancel: false, confirmText: '知道了'});
        overlay.querySelector('#ui-close').onclick = () => { document.body.removeChild(overlay); resolve(); };
        overlay.querySelector('#ui-ok').onclick = () => { document.body.removeChild(overlay); resolve(); };
        document.body.appendChild(overlay);
    });
}
function uiConfirm(message, title = '确认') {
    return new Promise(resolve => {
        const {overlay} = uiBuildModal({title, message, showCancel: true, confirmText: '确定', cancelText: '取消'});
        overlay.querySelector('#ui-close').onclick = () => { document.body.removeChild(overlay); resolve(false); };
        overlay.querySelector('#ui-cancel').onclick = () => { document.body.removeChild(overlay); resolve(false); };
        overlay.querySelector('#ui-ok').onclick = () => { document.body.removeChild(overlay); resolve(true); };
        document.body.appendChild(overlay);
    });
}
function uiToast(message, type = 'info') {
    const bar = document.createElement('div');
    const bg = type === 'success' ? '#059669' : (type === 'error' ? '#ef4444' : '#334155');
    bar.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; max-width: 360px; z-index: 9999;
      background: ${bg}; color: #fff; border-radius: 12px; padding: 12px 14px; box-shadow: 0 10px 30px rgba(2,6,23,.2);
      font-size: 14px; line-height: 1.6;
      transform: translateY(12px); opacity: 0; transition: all .2s ease-out;
    `;
    bar.textContent = message;
    document.body.appendChild(bar);
    requestAnimationFrame(() => { bar.style.transform = 'translateY(0)'; bar.style.opacity = '1'; });
    setTimeout(() => {
        bar.style.transform = 'translateY(12px)'; bar.style.opacity = '0';
        setTimeout(() => bar.remove(), 200);
    }, 1800);
}
// 创建房间
createBtn = document.getElementById('create-room-btn');
createBtn.onclick = async function() {
    const nick = document.getElementById('create-nickname').value.trim();
    if (!nick) {
        document.getElementById('create-error').textContent = '请填写昵称';
        return;
    }
    const isDefault = document.querySelector('input[name="api-mode"]:checked').value === 'default';
    let body;
    if (isDefault) {
        const model = document.getElementById('create-model-select').value;
        if (!model) {
            document.getElementById('create-error').textContent = '请选择模型';
            return;
        }
        body = JSON.stringify({nickname: nick, use_default: true, model});
    } else {
        const base_url = document.getElementById('create-base-url').value.trim();
        const api_key = document.getElementById('create-api-key').value.trim();
        const model = document.getElementById('create-model').value.trim();
        if (!base_url || !api_key || !model) {
            document.getElementById('create-error').textContent = '请填写完整的 API 配置';
            return;
        }
        body = JSON.stringify({nickname: nick, use_default: false, base_url, api_key, model});
    }
    createBtn.disabled = true;
    document.getElementById('create-error').textContent = '';
    try {
        const res = await fetch('/api/create_room', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body
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
    document.getElementById('chat-box').innerHTML = '<div style="text-align:center;color:#94a3b8;margin-top:2rem;">正在连接...</div>';
    document.getElementById('chat-box-chat').innerHTML = '';
    document.getElementById('story-ops').style.display = isOwner ? '' : 'none';
    setupUploadBtn();
    fetchCurrentStory();
    saveSession();
    // 断开旧 socket
    if (socket) { socket.disconnect(); socket = null; }
    // 建立 WebSocket 连接 - Socket.IO 自动处理 ws/wss 升级
    socket = io({transports: ['websocket', 'polling']});
    socket.on('connect', function() {
        socket.emit('join', {code: roomCode, nickname});
    });
    socket.on('initial_state', function(data) {
        renderMessagesIncremental(data.messages || []);
        if (data.chat_messages) renderChatMessagesIncremental(data.chat_messages);
    });
    socket.on('user_message', function(msg) {
        appendMessage(msg);
    });
    socket.on('ai_reply', function(msg) {
        appendMessage(msg);
    });
    socket.on('chat_message', function(msg) {
        appendChatMessage(msg);
    });
    socket.on('online_users_update', function(data) {
        renderOnlineUsers(data.users || []);
    });
    socket.on('pass', function(data) {
        if (!window._popupPassedFlag) {
            window._popupPassedFlag = true;
            showPopup(data.message || '恭喜过关');
        }
    });
    socket.on('story_update', function() {
        fetchCurrentStory();
    });
    socket.on('room_closed', function(data) {
        uiToast('房间已被关闭', 'error');
        setTimeout(function() { leaveRoom(); }, 1500);
    });
    socket.on('disconnect', function() {
        uiToast('连接已断开，正在重连...', 'error');
    });
    // 心跳
    window._heartbeatInterval = setInterval(function() {
        if (socket && socket.connected) socket.emit('heartbeat');
    }, 30000);
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

// 故事还原按钮绑定
document.getElementById('restore-modal').addEventListener('click', function(e) {
    if (e.target === this) closeRestoreModal();
});
document.getElementById('restore-story-btn').onclick = function() {
    openRestoreModal();
};
document.getElementById('restore-submit-btn').onclick = function() {
    var content = document.getElementById('restore-input').value.trim();
    if (!content) { uiToast('请输入还原的故事内容', 'error'); return; }
    if (!socket || !socket.connected) { uiToast('连接已断开', 'error'); return; }
    socket.emit('restore_story', {content: content});
    closeRestoreModal();
    uiToast('故事还原已提交，请等待 AI 判断...', 'info');
};

document.getElementById('user-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        sendBtn.click();
    }
});

// WebSocket 消息渲染 - 增量追加
function renderMessagesIncremental(msgs) {
    const chatBox = document.getElementById('chat-box');
    chatBox.innerHTML = '';
    for (const msg of msgs) {
        appendMessageTo(chatBox, msg);
    }
    chatBox.scrollTop = chatBox.scrollHeight;
}

function appendMessage(msg) {
    const chatBox = document.getElementById('chat-box');
    const isAtBottom = chatBox.scrollTop + chatBox.clientHeight >= chatBox.scrollHeight - 20;
    appendMessageTo(chatBox, msg);
    if (isAtBottom) {
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

function appendMessageTo(container, msg) {
    if (msg.role === 'system') {
        const div = document.createElement('div');
        div.style.cssText = 'text-align:center;color:#94a3b8;font-size:13px;margin:6px 0;';
        div.innerHTML = escapeHtml(msg.content);
        container.appendChild(div);
        return;
    }
    const div = document.createElement('div');
    div.className = 'bubble ' + (msg.role === 'user' ? 'msg-user' : 'msg-ai');
    div.innerHTML = '<span class="msg-nickname">' + escapeHtml(msg.nickname) + '</span>: ' + escapeHtml(msg.content);
    container.appendChild(div);
}

function renderChatMessagesIncremental(msgs) {
    const box = document.getElementById('chat-box-chat');
    box.innerHTML = '';
    for (const msg of msgs) {
        appendChatMessageTo(box, msg);
    }
    box.scrollTop = box.scrollHeight;
}

function appendChatMessage(msg) {
    const box = document.getElementById('chat-box-chat');
    const isAtBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
    appendChatMessageTo(box, msg);
    if (isAtBottom) {
        box.scrollTop = box.scrollHeight;
    }
}

function appendChatMessageTo(box, msg) {
    let content = escapeHtml(msg.content);
    const users = (currentOnlineUsers || []);
    users.forEach(function(u) {
        if (u && content.indexOf('@' + u) !== -1) {
            content = content.split('@' + u).join('<span style="background:yellow;color:#d97706;padding:1px 4px;border-radius:4px;">@' + u + '</span>');
        }
    });
    const div = document.createElement('div');
    div.style.cssText = 'margin:2px 0;line-height:1.7;';
    div.innerHTML = '<span class="msg-nickname" style="color:#3b82f6;">' + escapeHtml(msg.nickname) + '</span>: ' + content;
    box.appendChild(div);
}

// 删除旧的 renderMessages 和 renderChatMessages 函数（已被上方增量版本替代）
function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, function(c) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    }).replace(/\n/g, '<br>');
}

// 删除房间
const deleteBtn = document.getElementById('delete-room-btn');
deleteBtn.onclick = async function() {
    const ok = await uiConfirm('确定要删除房间吗？', '删除房间');
    if (!ok) return;
    try {
        await fetch('/api/delete_room', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({code: roomCode, nickname})
        });
        uiToast('房间已删除', 'success');
        leaveRoom();
    } catch (e) {}
};

// 退出房间
function leaveRoom() {
    if (window._heartbeatInterval) { clearInterval(window._heartbeatInterval); window._heartbeatInterval = null; }
    if (socket) { socket.disconnect(); socket = null; }
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
        html += '<div style="margin-bottom:8px;font-weight:600;">汤面：</div>';
        html += '<div style="margin-bottom:10px;line-height:1.7;">' + escapeHtml(story.surface || '') + '</div>';
        if (story.answer && story.answer.length > 0) {
            html += '<div style="margin-top:12px;padding:10px;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;line-height:1.8;font-size:0.95rem;color:#92400e;">';
            html += '<div style="font-weight:700;margin-bottom:4px;color:#b45309;">已揭晓答案：</div>';
            html += '<div style="white-space:pre-wrap;">' + escapeHtml(story.answer) + '</div>';
            html += '</div>';
        }
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
                const ok = await uiConfirm('确定要揭晓答案吗？', '揭晓答案');
                if (!ok) return;
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

// 公告渲染
(async function renderAnnouncements(){
    try {
        const resp = await fetch('/api/get_announcements');
        const data = await resp.json();
        const content = (data && data.content) ? data.content : '';
        if (content) {
            const banner = document.getElementById('announcement-banner');
            const text = document.getElementById('announcement-text');
            if (banner && text) {
                text.textContent = content;
                banner.style.display = '';
            }
        }
    } catch (e) {}
})();

(async function initCreateOptions(){
    try {
        const resp = await fetch('/api/get_options');
        const data = await resp.json();
        const opt = data.options || {models:[], base_urls:[], base_urls_masked:[]};

        const modelEl = document.getElementById('create-model-select');
        if (modelEl) {
            modelEl.innerHTML = '<option value="">请选择模型</option>';
            (opt.models || []).forEach(v => {
                const o = document.createElement('option');
                o.value = v;
                o.textContent = v;
                modelEl.appendChild(o);
            });
            if (opt.models && opt.models.length) modelEl.value = opt.models[0];
        }

        if (!window._optionsStored) {
            window._optionsStored = {models: opt.models || [], base_urls: opt.base_urls || []};
        }
    } catch (e) {}
})();

let currentOnlineUsers = [];
function renderOnlineUsers(users) {
    currentOnlineUsers = users;
    const userList = document.getElementById('user-list');
    userList.innerHTML = '';
    users.forEach(function(u) {
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;align-items:center;padding:6px 16px 6px 12px;margin-bottom:2px;border-radius:8px;transition:background 0.2s;cursor:pointer;';
        if (u === nickname) {
            div.style.background = '#dbeafe';
        } else {
            div.onmouseover = function() { div.style.background = '#e0e7ff'; };
            div.onmouseout = function() { div.style.background = ''; };
        }
        const avatar = document.createElement('div');
        avatar.textContent = u[0].toUpperCase();
        avatar.style.cssText = 'width:32px;height:32px;background:#3b82f6;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:18px;margin-right:10px;box-shadow:0 2px 8px 0 rgba(59,130,246,0.08);';
        div.appendChild(avatar);
        const nameSpan = document.createElement('span');
        nameSpan.textContent = u;
        nameSpan.style.cssText = 'font-size:15px;font-weight:500;color:#334155;';
        div.appendChild(nameSpan);
        const tag = document.createElement('span');
        tag.style.cssText = 'margin-left:10px;padding:2px 8px;border-radius:8px;font-size:12px;font-weight:bold;';
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

// 发送无AI群聊消息 - 通过 WebSocket
const chatSendBtn = document.getElementById('chat-send-btn');
chatSendBtn.onclick = async function() {
    const input = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content) return;
    if (!socket || !socket.connected) { uiToast('连接已断开', 'error'); return; }
    chatSendBtn.disabled = true;
    input.disabled = true;
    socket.emit('send_chat_message', {content: content});
    input.value = '';
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

// 发送AI消息 - 通过 WebSocket
let sendBtnOriginal = sendBtn.innerHTML;
async function sendAIMessage(content) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="spinner" style="display:inline-block;width:22px;height:22px;border:3px solid #3b82f6;border-top:3px solid #fff;border-radius:50%;animation:spin 1s linear infinite;vertical-align:middle;"></span>';
    socket.emit('send_ai_message', {content: content});
    // 等待 AI 回复后恢复按钮（通过 ai_reply 事件触发）
    var onReply = function() {
        sendBtn.disabled = false;
        sendBtn.innerHTML = sendBtnOriginal;
        socket.off('ai_reply', onReply);
        socket.off('error', onError);
    };
    var onError = function() {
        sendBtn.disabled = false;
        sendBtn.innerHTML = sendBtnOriginal;
        socket.off('ai_reply', onReply);
        socket.off('error', onError);
    };
    // 设置超时
    var timeout = setTimeout(function() {
        onReply();
        uiToast('AI 响应超时，请重试', 'error');
    }, 35000);
    socket.once('ai_reply', function() { clearTimeout(timeout); onReply(); });
    socket.once('error', function() { clearTimeout(timeout); onError(); });
}
// 加入转圈动画样式
const style = document.createElement('style');
style.innerHTML = `@keyframes spin { 0% { transform: rotate(0deg);} 100% {transform: rotate(360deg);} }`;
document.head.appendChild(style); 
}); 
