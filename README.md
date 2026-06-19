# 海龟汤 AI — 沉浸式推理聊天室
[demo网站(感谢提供汤的人辛勤付出)](https://turtle.vmss.cn/)

基于 Flask + Socket.IO 的在线海龟汤推理游戏，支持 AI 主持、多人实时互动与故事广场。

## 功能模块

### 房间系统
- **创建房间**：填写昵称后可选默认 API 配置（使用服务器预设的 Key 和地址，仅需选模型）或自定义填写
- **加入房间**：输入房主分享的 6 位邀请码即可加入
- **邀请码分享**：进入房间后顶部显示邀请码，发给朋友即可加入
- **删除房间**：房主可随时关闭房间，管理员可后台强制关闭

### AI 主持人
- 基于 OpenAI 兼容 API，支持自定义 Base URL / API Key / 模型
- AI 根据汤底（完整故事真相）回答玩家"是""不是""不重要"
- 支持多轮对话上下文记忆（最近 20 轮）
- 故事还原判断：根据胜利条件中的核心要点，不要求逐字匹配

### 多人互动
- **AI 聊天**：与 AI 主持人进行推理问答（WebSocket 实时推送，无闪烁）
- **房间群聊**：玩家之间无 AI 参与的交流频道
- **在线成员**：实时显示当前房间在线玩家及身份标签（房主/成员）
- **@提及**：群聊中 @用户名 会高亮显示

### 题目管理（房主专属）
- 上传 JSON 格式的题目文件（支持批量，单文件 ≤20MB）
- 从故事广场加载已发布的故事
- 切换题目 / 揭晓答案
- 答案揭晓后，所有成员可在题目面板看到黄底醒目答案框

### 故事广场
- **浏览故事**：查看所有已发布的海龟汤题目，支持搜索
- **发布故事**：在线创作（填写汤面/汤底/胜利条件/补充说明）或上传 JSON 文件
- **管理故事**：根据编号 + 管理密码编辑已发布的故事
- 从广场一键开始游戏（自动创建房间并加载故事）

### 故事还原
- 在 AI 聊天区点击"故事还原"按钮，输入对真相的推测
- AI 根据汤底 + 胜利条件判断：故事还原正确 / 故事还原大致正确 / 故事还原错误
- 判断标准：不要求逐字一致，只需覆盖核心要点

### 管理员后台
- 访问 `/admin` 登录后台
- **房间管理**：查看活跃房间、成员列表、强制关闭
- **故事管理**：查看/搜索/删除已发布故事
- **全局配置**：管理模型列表、代理地址、API Keys（默认遮罩，点击显示）
- **系统公告**：发布首页公告，用户访问时显示可关闭横幅

### 移动端适配
- 768px 以下自动切换移动布局
- 聊天区使用 `dvh` 动态高度适配软键盘
- 侧栏默认折叠，点击按钮展开
- 按钮、气泡、字体大小均针对触屏优化
- PC 端布局不受影响

---

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Flask + Flask-SocketIO + eventlet |
| 实时通信 | WebSocket（Socket.IO 协议，自动 wss 升级） |
| AI | OpenAI 兼容 API |
| 前端 | 原生 HTML5 + CSS3 + JavaScript |
| 存储 | 内存（房间）+ 文件系统（故事 JSON） |

---

## 安装部署

### 环境要求
- Python 3.8+
- 网络连接（访问 AI API）

### 安装步骤

```bash
# 1. 进入项目目录
cd Turtle_Soup

# 2. 创建虚拟环境（推荐）
python3 -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate   # Windows

# 3. 安装依赖
pip install -r requirements.txt

# 4. 配置 config.json（见下方配置说明）

# 5. 运行
python app.py
# 访问 http://localhost:5011
```

---

## 配置说明

### config.json

```json
{
  "preset": "AI 预设提示词（可为空，使用默认）",
  "admin": {
    "username": "mumuemhaha",
    "password_hash": "<SHA-256 哈希值>"
  },
  "story_counter": 1,
  "options": {
    "models": ["deepseek-v4-flash"],
    "base_urls": ["https://api.example.com/v1"],
    "api_keys": ["sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"]
  },
  "announcements": "公告内容"
}
```

### 管理员密码（重要）

密码以 SHA-256 哈希存储，**不存明文**。生成方式：

```python
import hashlib
password = "你的密码"
hash_value = hashlib.sha256(('haigui_salt_' + password).encode('utf-8')).hexdigest()
print(hash_value)  # 将输出的哈希值填入 config.json 的 password_hash 字段
```

或在项目目录执行：

```bash
python3 -c "import hashlib; pw='你的密码'; print(hashlib.sha256(('haigui_salt_'+pw).encode()).hexdigest())"
```

### 选项说明

| 字段 | 说明 |
|---|---|
| `preset` | AI 系统提示词前缀，为空则使用默认海龟汤规则 |
| `admin.username` | 后台登录用户名 |
| `admin.password_hash` | 后台密码的 SHA-256 哈希（盐: `haigui_salt_`） |
| `options.models` | 可供选择的模型列表 |
| `options.base_urls` | API 代理地址列表（取第一个作为默认） |
| `options.api_keys` | API Key 列表（取第一个作为默认；Key 不暴露给前端） |
| `announcements` | 首页公告内容 |

### API 安全

- 公开接口 `GET /api/get_options` **不返回** API Keys
- 管理员专用接口 `GET /api/get_admin_options` 需登录后访问
- 前端"默认模式"下，Key 和 URL 完全在服务端使用，不可见
- 自定义模式下用户需手动填写，无预填下拉框

---

## 环境变量（可选）

| 变量 | 说明 | 默认值 |
|---|---|---|
| `FLASK_SECRET_KEY` | Flask 会话加密密钥 | 随机生成（重启后会话失效） |

---

## 题目格式

海龟汤题目需为 JSON 格式，支持单个或数组批量上传（≤20MB）。

```json
{
  "surface": "一个人走进餐厅，点了一份海龟汤，尝了一口后自杀了。为什么？",
  "answer": "他曾在海上遇难，同伴为救他而牺牲，海龟汤正是用同伴的肉做的。",
  "victory_condition": "猜出这个人自杀的原因",
  "additional": "这个人是海难幸存者"
}
```

---

## 项目结构

```
haigui/
├── app.py                       # Flask 主应用（HTTP 路由 + Socket.IO 事件）
├── config.json                  # 配置文件（管理员、API 选项、公告）
├── requirements.txt             # Python 依赖
├── README.md
├── static/
│   ├── main.js                  # 前端逻辑（WebSocket、UI、游戏流程）
│   └── css/
│       └── style.css            # 全局样式 + 移动端适配
├── templates/
│   ├── index.html               # 主页（首页/创建/加入/聊天）
│   ├── story_plaza.html         # 故事广场（浏览/发布/编辑）
│   ├── admin_login.html         # 管理员登录
│   └── admin_panel.html         # 管理后台（房间/故事/配置/公告）
└── upload/
    └── json/
        ├── norelease/           # 待审核（预留）
        └── release/             # 已发布故事 JSON
```

---

## 注意事项

1. 房间数据存储在**内存**中，服务重启后会清空
2. 每天凌晨 3 点自动清空所有房间
3. 故事广场的故事永久保存在 `upload/json/release/` 目录
4. 如部署 HTTPS，WebSocket 会自动升级为 WSS，无需额外配置
5. 管理员密码哈希盐值为 `haigui_salt_`，请勿泄露

---

**海龟汤 AI** — 与 AI 博弈，还原真相 🐢

## 社区支持

学 AI , 上 L 站：[LinuxDO](https://linux.do)
