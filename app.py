from flask import Flask, render_template, request, jsonify, session, redirect
from openai import OpenAI
from flask_cors import CORS
import random, string, threading, json, time
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
import uuid

app = Flask(__name__)
CORS(app)
app.secret_key = 'haiguitang-secret-key'  # 用于session

# 加载config.json
with open('config.json', 'r', encoding='utf-8') as f:
    config = json.load(f)
PRESET = config.get('preset', None)
ADMIN_USERNAME = config.get('admin', {}).get('username', 'admin')
ADMIN_PASSWORD = config.get('admin', {}).get('password', 'admin123')
STORY_COUNTER = config.get('story_counter', 1)

# 保存config.json计数
def save_story_counter(counter):
    with open('config.json', 'r', encoding='utf-8') as f:
        config = json.load(f)
    config['story_counter'] = counter
    with open('config.json', 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

CUSTOM_STORY_RESTORE_GUIDE = (
    "【重要规则补充】\n"
    "1. 当玩家的提问以‘开始故事还原：’开头时，只能回复：故事还原错误、故事还原正确、故事还原大致正确三种标签，回复内容只能是这三个标签之一，不能有其他内容、提示、解释或标点，用户会自行揭晓谜底或继续提问。\n"
    "- 绝对不能给出任何提示、解释或标点。\n"
    "2. 当玩家回复‘整理线索’时，请你整理之前所有AI回答中有用的线索和不重要的线索：\n"
    "- 只总结AI已经明确回答过的有用线索和不重要的线索，绝对不要展开联想，绝对不要根据汤底推测未被问到的内容。\n"
    "- ‘是’或‘不是’的问题，如果无法确定线索可输出‘不确定’。\n"
    "- ‘不重要’的信息要单独整理和汇报。\n"
    "- 整理时要简明扼要，避免剧透和过度推理。\n"
    "其余时间请严格按照海龟汤规则进行推理问答。"
)

# 故事广场相关目录
STORY_UPLOAD_DIR = 'upload/json/norelease'
STORY_RELEASE_DIR = 'upload/json/release'
os.makedirs(STORY_UPLOAD_DIR, exist_ok=True)
os.makedirs(STORY_RELEASE_DIR, exist_ok=True)

# 内存房间存储
rooms = {}
rooms_lock = threading.Lock()

# 全局线程池
ai_executor = ThreadPoolExecutor(max_workers=8)
# 存储AI异步任务结果
ai_tasks = {}

def gen_code(length=6):
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/create_room', methods=['POST'])
def create_room():
    data = request.json
    nickname = data.get('nickname')
    base_url = data.get('base_url')
    api_key = data.get('api_key')
    model = data.get('model')
    if not (nickname and base_url and api_key and model):
        return jsonify({'error': '参数不完整'}), 400
    code = gen_code()
    with rooms_lock:
        while code in rooms:
            code = gen_code()
        rooms[code] = {
            'owner': nickname,
            'base_url': base_url,
            'api_key': api_key,
            'model': model,
            'messages': [],
            'members': {nickname: {'nickname': nickname}}
        }
    session['nickname'] = nickname
    session['room_code'] = code
    return jsonify({'code': code})

@app.route('/api/join_room', methods=['POST'])
def join_room():
    data = request.json
    nickname = data.get('nickname')
    code = data.get('code')
    if not (nickname and code):
        return jsonify({'error': '参数不完整'}), 400
    with rooms_lock:
        room = rooms.get(code)
        if not room:
            return jsonify({'error': '房间不存在'}), 404
        if nickname in room['members']:
            return jsonify({'error': '昵称已存在'}), 400
        room['members'][nickname] = {'nickname': nickname}
        # 新增：加入在线用户
        if 'online_users' not in room:
            room['online_users'] = {}
        room['online_users'][nickname] = time.time()
        # 新增：初始化无AI群聊消息
        if 'chat_messages' not in room:
            room['chat_messages'] = []
    session['nickname'] = nickname
    session['room_code'] = code
    return jsonify({'success': True, 'room': {'owner': room['owner'], 'model': room['model']}})

@app.route('/api/heartbeat', methods=['POST'])
def heartbeat():
    data = request.json
    code = data.get('code')
    nickname = data.get('nickname')
    if not (code and nickname):
        return jsonify({'error': '参数不完整'}), 400
    with rooms_lock:
        room = rooms.get(code)
        if not room or nickname not in room['members']:
            return jsonify({'error': '房间或用户不存在'}), 404
        if 'online_users' not in room:
            room['online_users'] = {}
        room['online_users'][nickname] = time.time()
    return jsonify({'success': True})

@app.route('/api/get_online_users', methods=['POST'])
def get_online_users():
    data = request.json
    code = data.get('code')
    if not code:
        return jsonify({'error': '参数不完整'}), 400
    now = time.time()
    with rooms_lock:
        room = rooms.get(code)
        if not room or 'online_users' not in room:
            return jsonify({'users': []})
        # 1分钟无心跳视为下线
        users = [u for u, t in room['online_users'].items() if now - t < 60]
    return jsonify({'users': users})

@app.route('/api/send_chat_message', methods=['POST'])
def send_chat_message():
    data = request.json
    code = data.get('code')
    nickname = data.get('nickname')
    content = data.get('content')
    if not (code and nickname and content):
        return jsonify({'error': '参数不完整'}), 400
    with rooms_lock:
        room = rooms.get(code)
        if not room or nickname not in room['members']:
            return jsonify({'error': '房间或用户不存在'}), 404
        if 'chat_messages' not in room:
            room['chat_messages'] = []
        room['chat_messages'].append({'nickname': nickname, 'content': content, 'time': int(time.time())})
        # 只保留最新100条
        if len(room['chat_messages']) > 100:
            room['chat_messages'] = room['chat_messages'][-100:]
    return jsonify({'success': True})

@app.route('/api/get_chat_messages', methods=['POST'])
def get_chat_messages():
    data = request.json
    code = data.get('code')
    if not code:
        return jsonify({'error': '参数不完整'}), 400
    with rooms_lock:
        room = rooms.get(code)
        if not room or 'chat_messages' not in room:
            return jsonify({'messages': []})
        return jsonify({'messages': room['chat_messages']})

@app.route('/api/send_message', methods=['POST'])
def send_message():
    data = request.json
    code = data.get('code')
    nickname = data.get('nickname')
    content = data.get('content')
    if not (code and nickname and content):
        return jsonify({'error': '参数不完整'}), 400
    # 1. 先加锁写入用户消息，复制room和messages
    with rooms_lock:
        room = rooms.get(code)
        if not room:
            return jsonify({'error': '房间不存在'}), 404
        if nickname not in room['members']:
            return jsonify({'error': '未加入房间'}), 403
        room['messages'].append({'role': 'user', 'content': content, 'nickname': nickname})
        room_copy = {
            'base_url': room['base_url'],
            'api_key': room['api_key'],
            'model': room['model'],
            'stories': room.get('stories'),
            'current_story': room.get('current_story'),
        }
        messages_copy = list(room['messages'])
    # 2. 生成唯一消息ID
    msg_id = str(uuid.uuid4())
    # 3. 在线程池中异步执行AI调用
    def ai_task():
        preset = ''
        if room_copy['stories'] and room_copy.get('current_story') is not None:
            story = room_copy['stories'][room_copy['current_story']]
            additional = story.get('additional', '')
            victory_condition = story.get('victory_condition', '')
            if PRESET and PRESET.strip():
                preset = PRESET + '\n' + CUSTOM_STORY_RESTORE_GUIDE
            else:
                preset = f"你现在是海龟汤推理游戏的主持人。当前题目如下：\n\n汤面：{story.get('surface', '')}\n\n游戏规则：出题者先给出不完整的'汤面'（题目），让猜题者提出各种可能性的问题，而出题者只能回答'是'、'不是'或'不重要'。猜题者在有限的线索中推理出事件的始末，拼出故事的全貌，凑出一个'汤底'（答案）。你只需根据规则回答问题，不要直接给出答案。同时会给出胜利条件，由你来决定是否过关。\n\n补充说明（仅供AI参考）：{additional}\n\n胜利条件：{victory_condition}\n" + CUSTOM_STORY_RESTORE_GUIDE
        else:
            preset = (PRESET + '\n' + CUSTOM_STORY_RESTORE_GUIDE) if PRESET and PRESET.strip() else "当前房间还没有上传题目，请房主上传海龟汤题目（json文件）。"
        messages = [
            {'role': 'system', 'content': preset}
        ]
        for msg in messages_copy:
            if msg['role'] == 'user':
                messages.append({'role': 'user', 'content': f"{msg['nickname']}: {msg['content']}"})
            elif msg['role'] == 'assistant':
                messages.append({'role': 'assistant', 'content': msg['content']})
        try:
            client = OpenAI(base_url=room_copy['base_url'], api_key=room_copy['api_key'])
            completion = client.chat.completions.create(
                model=room_copy['model'],
                messages=messages
            )
            reply = completion.choices[0].message.content
        except Exception as e:
            reply = f'[AI错误]{str(e)}'
        popup = None
        with rooms_lock:
            room = rooms.get(code)
            if not room:
                return {'error': '房间不存在'}
            room['messages'].append({'role': 'assistant', 'content': reply, 'nickname': 'AI'})
            if '故事还原正确' in reply or '故事还原大致正确' in reply:
                popup = '恭喜过关'
                room['passed'] = True
        return {'reply': reply, 'popup': popup}
    future = ai_executor.submit(ai_task)
    ai_tasks[msg_id] = future
    return jsonify({'msg_id': msg_id, 'status': 'pending'})

@app.route('/api/get_ai_reply', methods=['POST'])
def get_ai_reply():
    data = request.json
    msg_id = data.get('msg_id')
    if not msg_id or msg_id not in ai_tasks:
        return jsonify({'error': '无效的消息ID'}), 400
    future = ai_tasks[msg_id]
    if future.done():
        result = future.result()
        del ai_tasks[msg_id]
        return jsonify(result)
    else:
        return jsonify({'status': 'pending'})

@app.route('/api/get_messages', methods=['POST'])
def get_messages():
    data = request.json
    code = data.get('code')
    if not code:
        return jsonify({'error': '参数不完整'}), 400
    with rooms_lock:
        room = rooms.get(code)
        if not room:
            return jsonify({'error': '房间不存在'}), 404
        return jsonify({'messages': room['messages'], 'passed': room.get('passed', False)})

@app.route('/api/delete_room', methods=['POST'])
def delete_room():
    data = request.json
    code = data.get('code')
    nickname = data.get('nickname')
    if not (code and nickname):
        return jsonify({'error': '参数不完整'}), 400
    with rooms_lock:
        room = rooms.get(code)
        if not room:
            return jsonify({'error': '房间不存在'}), 404
        if room['owner'] != nickname:
            return jsonify({'error': '只有房主可以删除房间'}), 403
        del rooms[code]
    return jsonify({'success': True})

# 保留单人对话接口
@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    base_url = data.get('base_url')
    api_key = data.get('api_key')
    model = data.get('model')
    messages = data.get('messages')
    if not (base_url and api_key and model and messages):
        return jsonify({'error': '参数不完整'}), 400
    try:
        client = OpenAI(base_url=base_url, api_key=api_key)
        completion = client.chat.completions.create(
            model=model,
            messages=messages
        )
        reply = completion.choices[0].message.content
        return jsonify({'reply': reply})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/upload_story', methods=['POST'])
def upload_story():
    code = request.form.get('code')
    nickname = request.form.get('nickname')
    if not (code and nickname):
        return jsonify({'error': '参数不完整'}), 400
    with rooms_lock:
        room = rooms.get(code)
        if not room:
            return jsonify({'error': '房间不存在'}), 404
        if room['owner'] != nickname:
            return jsonify({'error': '只有房主可以上传题目'}), 403
        if 'stories' not in room:
            room['stories'] = []
        files = request.files.getlist('file')
        for file in files:
            try:
                story = json.load(file)
                if isinstance(story, list):
                    room['stories'].extend(story)
                else:
                    room['stories'].append(story)
            except Exception as e:
                return jsonify({'error': f'文件解析失败: {str(e)}'}), 400
        # 默认切换到最新上传的题目
        room['current_story'] = len(room['stories']) - 1 if room['stories'] else None
        # 初始化揭晓标志
        if room['current_story'] is not None:
            room['reveal_answer_flag'] = False
    return jsonify({'success': True, 'count': len(room['stories'])})

@app.route('/api/set_story', methods=['POST'])
def set_story():
    data = request.json
    code = data.get('code')
    nickname = data.get('nickname')
    idx = data.get('index')
    if not (code and nickname and isinstance(idx, int)):
        return jsonify({'error': '参数不完整'}), 400
    with rooms_lock:
        room = rooms.get(code)
        if not room:
            return jsonify({'error': '房间不存在'}), 404
        if room['owner'] != nickname:
            return jsonify({'error': '只有房主可以切换题目'}), 403
        if 'stories' not in room or not room['stories']:
            return jsonify({'error': '题库为空'}), 400
        if not (0 <= idx < len(room['stories'])):
            return jsonify({'error': '题目索引超出范围'}), 400
        room['current_story'] = idx
        # 插入系统消息
        room['messages'].append({'role': 'system', 'content': '房主已切换其他题目', 'nickname': '系统'})
        # 初始化揭晓标志
        room['reveal_answer_flag'] = False
    return jsonify({'success': True})

@app.route('/api/get_current_story', methods=['POST'])
def get_current_story():
    data = request.json
    code = data.get('code')
    if not code:
        return jsonify({'error': '参数不完整'}), 400
    with rooms_lock:
        room = rooms.get(code)
        if not room or 'stories' not in room or room.get('current_story') is None:
            return jsonify({'error': '暂无题目'}), 404
        story = room['stories'][room['current_story']]
        victory_condition = story.get('victory_condition', '')
        answer = story.get('answer', '') if room.get('reveal_answer_flag') else ''
        return jsonify({
            'surface': story.get('surface', ''),
            'victory_condition': victory_condition,
            'answer': answer
        })

@app.route('/api/reveal_answer', methods=['POST'])
def reveal_answer():
    data = request.json
    code = data.get('code')
    nickname = data.get('nickname')
    if not (code and nickname):
        return jsonify({'error': '参数不完整'}), 400
    with rooms_lock:
        room = rooms.get(code)
        if not room:
            return jsonify({'error': '房间不存在'}), 404
        if room['owner'] != nickname:
            return jsonify({'error': '只有房主可以揭晓答案'}), 403
        room['reveal_answer_flag'] = True
        # 插入系统消息
        story = room['stories'][room['current_story']]
        room['messages'].append({'role': 'system', 'content': f"房主已揭晓答案：{story.get('answer', '')}", 'nickname': '系统'})
    return jsonify({'success': True})

@app.route('/story_plaza')
def story_plaza():
    """故事广场页面"""
    return render_template('story_plaza.html')

@app.route('/api/upload_to_plaza', methods=['POST'])
def upload_to_plaza():
    """上传故事到广场"""
    name = request.form.get('name')
    if not name:
        return jsonify({'error': '请填写故事名称'}), 400
    if 'file' not in request.files:
        return jsonify({'error': '没有选择文件'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '没有选择文件'}), 400
    if not file.filename.endswith('.json'):
        return jsonify({'error': '只支持JSON文件'}), 400
    try:
        # 读取文件内容
        content = file.read().decode('utf-8')
        story_data = json.loads(content)
        # 生成唯一编号
        global STORY_COUNTER
        story_id = f"#{STORY_COUNTER:05d}"
        STORY_COUNTER += 1
        save_story_counter(STORY_COUNTER)
        # 包装故事数据
        plaza_story = {
            'name': name,
            'id': story_id,
            'surface': story_data.get('surface', ''),
            'data': story_data
        }
        # 生成唯一文件名
        import uuid
        filename = f"{uuid.uuid4()}.json"
        filepath = os.path.join(STORY_UPLOAD_DIR, filename)
        # 保存文件
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(plaza_story, f, ensure_ascii=False, indent=2)
        return jsonify({'success': True, 'message': '故事已上传，等待管理员审核'})
    except Exception as e:
        return jsonify({'error': f'文件解析失败: {str(e)}'}), 400

@app.route('/api/get_plaza_stories', methods=['GET'])
def get_plaza_stories():
    """获取故事广场列表"""
    stories = []
    # 获取已发布的故事
    for filename in os.listdir(STORY_RELEASE_DIR):
        if filename.endswith('.json'):
            try:
                with open(os.path.join(STORY_RELEASE_DIR, filename), 'r', encoding='utf-8') as f:
                    story_data = json.load(f)
                    # 只显示名称和编号和汤面
                    stories.append({
                        'name': story_data.get('name', ''),
                        'id': story_data.get('id', ''),
                        'surface': story_data.get('surface', ''),
                        'filename': filename
                    })
            except Exception as e:
                print(f"Error reading {filename}: {e}")
    return jsonify({'stories': stories})

@app.route('/api/get_pending_stories', methods=['GET'])
def get_pending_stories():
    """获取待审核故事列表（管理员专用）"""
    if not session.get('admin_logged_in'):
        return jsonify({'error': '未登录'}), 403
    stories = []
    for filename in os.listdir(STORY_UPLOAD_DIR):
        if filename.endswith('.json'):
            try:
                with open(os.path.join(STORY_UPLOAD_DIR, filename), 'r', encoding='utf-8') as f:
                    story_data = json.load(f)
                    stories.append({
                        'name': story_data.get('name', ''),
                        'id': story_data.get('id', ''),
                        'surface': story_data.get('surface', ''),
                        'filename': filename
                    })
            except Exception as e:
                print(f"Error reading {filename}: {e}")
    return jsonify({'stories': stories})

@app.route('/api/approve_story', methods=['POST'])
def approve_story():
    """审核通过故事"""
    if not session.get('admin_logged_in'):
        return jsonify({'error': '未登录'}), 403
    filename = request.form.get('filename')
    if not filename:
        return jsonify({'error': '参数不完整'}), 400
    source_path = os.path.join(STORY_UPLOAD_DIR, filename)
    target_path = os.path.join(STORY_RELEASE_DIR, filename)
    if not os.path.exists(source_path):
        return jsonify({'error': '文件不存在'}), 404
    try:
        # 直接移动文件，保留编号和名称
        import shutil
        shutil.move(source_path, target_path)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': f'操作失败: {str(e)}'}), 500

@app.route('/api/reject_story', methods=['POST'])
def reject_story():
    """拒绝故事"""
    if not session.get('admin_logged_in'):
        return jsonify({'error': '未登录'}), 403
    filename = request.form.get('filename')
    if not filename:
        return jsonify({'error': '参数不完整'}), 400
    filepath = os.path.join(STORY_UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': '文件不存在'}), 404
    try:
        os.remove(filepath)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': f'操作失败: {str(e)}'}), 500

@app.route('/api/load_story_from_plaza', methods=['POST'])
def load_story_from_plaza():
    """从故事广场加载故事到房间"""
    data = request.json
    code = data.get('code')
    nickname = data.get('nickname')
    filename = data.get('filename')
    if not (code and nickname and filename):
        return jsonify({'error': '参数不完整'}), 400
    with rooms_lock:
        room = rooms.get(code)
        if not room:
            return jsonify({'error': '房间不存在'}), 404
        if room['owner'] != nickname:
            return jsonify({'error': '只有房主可以加载故事'}), 403
        filepath = os.path.join(STORY_RELEASE_DIR, filename)
        if not os.path.exists(filepath):
            return jsonify({'error': '故事不存在'}), 404
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                plaza_story = json.load(f)
            if 'stories' not in room:
                room['stories'] = []
            # 只导入data字段
            room['stories'].append(plaza_story['data'])
            room['current_story'] = len(room['stories']) - 1
            room['reveal_answer_flag'] = False
            return jsonify({'success': True, 'count': len(room['stories'])})
        except Exception as e:
            return jsonify({'error': f'加载失败: {str(e)}'}), 500

@app.route('/admin', methods=['GET', 'POST'])
def admin_panel():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
            session['admin_logged_in'] = True
            return redirect('/admin')
        else:
            return render_template('admin_login.html', error='账号或密码错误')
    if not session.get('admin_logged_in'):
        return render_template('admin_login.html')
    # 展示房间信息
    room_list = []
    with rooms_lock:
        for code, room in rooms.items():
            room_list.append({
                'code': code,
                'owner': room['owner'],
                'members': list(room['members'].keys()),
                'invite_code': code
            })
    return render_template('admin_panel.html', rooms=room_list)

@app.route('/admin/delete_room', methods=['POST'])
def admin_delete_room():
    if not session.get('admin_logged_in'):
        return jsonify({'error': '未登录'}), 403
    code = request.form.get('code')
    with rooms_lock:
        if code in rooms:
            del rooms[code]
            return jsonify({'success': True})
        else:
            return jsonify({'error': '房间不存在'}), 404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True) 