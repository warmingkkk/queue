import asyncio
import json
import uuid
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from pathlib import Path
from typing import Dict, List, Any

# ----------------- FastAPI 应用初始化 -----------------
app = FastAPI()

# 构建前端页面的路径
BASE_DIR = Path(__file__).resolve().parent
templates_path = BASE_DIR / "templates"

# ----------------- 内存中的数据存储 -----------------
class AppState:
    def __init__(self):
        self.users: Dict[str, Dict[str, Any]] = {}
        self.devices: Dict[str, Dict[str, Any]] = {}
    
    def to_json(self):
        return {"users": self.users, "devices": self.devices}

state = AppState()

# ----------------- WebSocket 连接管理器 -----------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
    
    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
    
    async def broadcast_state(self, notification_data: Dict = None):
        """广播当前完整状态给所有连接的客户端"""
        current_state = state.to_json()
        if notification_data:
            current_state["notification"] = notification_data
            
        message = json.dumps(current_state)
        for connection in self.active_connections:
            await connection.send_text(message)

manager = ConnectionManager()

# ----------------- 业务逻辑处理函数 -----------------
def handle_add_user(payload: Dict):
    user_name = payload.get("name")
    browser_id = payload.get("browser_id")  # 浏览器标识
    if not user_name or not browser_id:
        return
    
    # 检查在同一浏览器中用户名是否已存在
    if any(u['name'] == user_name and u.get('browser_id') == browser_id 
           for u in state.users.values()):
        return
    
    user_id = str(uuid.uuid4())
    state.users[user_id] = {
        "id": user_id, 
        "name": user_name,
        "browser_id": browser_id  # 记录创建用户的浏览器
    }

def handle_delete_user(payload: Dict):
    user_id = payload.get("id")
    browser_id = payload.get("browser_id")
    if not user_id or user_id not in state.users:
        return
    
    # 只能删除自己浏览器创建的用户
    if state.users[user_id].get("browser_id") != browser_id:
        return
    
    # 从所有设备的使用和排队中移除该用户
    for device_id, device in state.devices.items():
        if device["in_use_by"] == user_id:
            device["in_use_by"] = None
        if user_id in device["queue"]:
            device["queue"].remove(user_id)
    
    del state.users[user_id]

def handle_add_device(payload: Dict):
    device_name = payload.get("name")
    device_details = payload.get("details", "")
    if not device_name:
        return
    
    device_id = str(uuid.uuid4())
    state.devices[device_id] = {
        "id": device_id,
        "name": device_name,
        "details": device_details,
        "in_use_by": None,
        "queue": [],
    }

def handle_edit_device(payload: Dict):
    device_id = payload.get("id")
    device = state.devices.get(device_id)
    if not device:
        return
    
    device["name"] = payload.get("name", device["name"])
    device["details"] = payload.get("details", device["details"])

def handle_delete_device(payload: Dict):
    device_id = payload.get("id")
    if device_id in state.devices:
        del state.devices[device_id]

def handle_use_device(payload: Dict):
    user_id = payload.get("userId")
    device_id = payload.get("deviceId")
    device = state.devices.get(device_id)
    if not user_id or not device or device["in_use_by"] is not None:
        return
    
    device["in_use_by"] = user_id

def handle_queue_device(payload: Dict):
    user_id = payload.get("userId")
    device_id = payload.get("deviceId")
    device = state.devices.get(device_id)
    if not user_id or not device:
        return
    
    # 防止重复排队
    if user_id not in device["queue"] and device["in_use_by"] != user_id:
        device["queue"].append(user_id)

def handle_preempt_device(payload: Dict):
    user_id = payload.get("userId")
    device_id = payload.get("deviceId")
    device = state.devices.get(device_id)
    if not user_id or not device:
        return
    
    preempted_user = device.get("in_use_by")
    if preempted_user:
        # 如果被抢占的用户不在队列中，则加入队列头部
        if preempted_user not in device["queue"]:
            device["queue"].insert(0, preempted_user)
            
    device["in_use_by"] = user_id
    # 如果抢占者在队列中，将他从队列移除
    if user_id in device["queue"]:
        device["queue"].remove(user_id)

def handle_release_device(payload: Dict):
    user_id = payload.get("userId")
    device_id = payload.get("deviceId")
    device = state.devices.get(device_id)
    if not device or device["in_use_by"] != user_id:
        return None
    
    notification_data = None
    if device["queue"]:
        next_user_id = device["queue"].pop(0)
        device["in_use_by"] = next_user_id
        # 创建通知数据
        notification_data = {
            "type": "device_available",
            "user_id": next_user_id,
            "device_name": device["name"],
            "device_id": device_id
        }
    else:
        device["in_use_by"] = None
        
    return notification_data

# 新增：处理用户退出排队
def handle_leave_queue(payload: Dict):
    user_id = payload.get("userId")
    device_id = payload.get("deviceId")
    device = state.devices.get(device_id)
    
    if not user_id or not device:
        return
    
    # 从队列中移除用户
    if user_id in device["queue"]:
        device["queue"].remove(user_id)

# ----------------- API Endpoints -----------------
@app.get("/", response_class=HTMLResponse)
async def get():
    with open(templates_path / "index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read(), status_code=200)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    # 新用户连接时，立即发送当前状态
    await manager.broadcast_state()
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            action = message.get("action")
            payload = message.get("payload", {})
            
            notification_data = None
            if action == "addUser":
                handle_add_user(payload)
            elif action == "deleteUser":
                handle_delete_user(payload)
            elif action == "addDevice":
                handle_add_device(payload)
            elif action == "editDevice":
                handle_edit_device(payload)
            elif action == "deleteDevice":
                handle_delete_device(payload)
            elif action == "useDevice":
                handle_use_device(payload)
            elif action == "queueDevice":
                handle_queue_device(payload)
            elif action == "preemptDevice":
                handle_preempt_device(payload)
            elif action == "releaseDevice":
                notification_data = handle_release_device(payload)
            elif action == "leaveQueue":  # 新增：处理退出排队
                handle_leave_queue(payload)
            
            # 任何状态变更后，向所有客户端广播最新状态
            await manager.broadcast_state(notification_data)
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)
