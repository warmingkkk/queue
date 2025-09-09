// Socket.IO 连接
const socket = io('http://localhost:3001');

// 全局变量
let devices = [];
let currentUser = '';
let users = JSON.parse(localStorage.getItem('users') || '[]');

// DOM 元素
const userSelect = document.getElementById('userSelect');
const addUserBtn = document.getElementById('addUserBtn');
const deviceNameInput = document.getElementById('deviceNameInput');
const addDeviceBtn = document.getElementById('addDeviceBtn');
const devicesList = document.getElementById('devicesList');
const usernameModal = document.getElementById('usernameModal');
const newUsernameInput = document.getElementById('newUsernameInput');
const confirmUsername = document.getElementById('confirmUsername');
const cancelUsername = document.getElementById('cancelUsername');

// 初始化
window.addEventListener('DOMContentLoaded', () => {
    loadUsers();
    requestNotificationPermission();
});

// 请求通知权限
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// 加载用户列表
function loadUsers() {
    userSelect.innerHTML = '<option value="">请选择用户</option>';
    users.forEach(user => {
        const option = document.createElement('option');
        option.value = user;
        option.textContent = user;
        userSelect.appendChild(option);
    });
    
    // 恢复上次选择的用户
    const lastUser = localStorage.getItem('currentUser');
    if (lastUser && users.includes(lastUser)) {
        userSelect.value = lastUser;
        currentUser = lastUser;
    }
}

// 显示通知
function showNotification(title, message) {
    // 页面内通知
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.innerHTML = `<strong>${title}</strong><br>${message}`;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 5000);
    
    // 系统通知
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body: message });
    }
}

// 渲染设备列表
function renderDevices() {
    devicesList.innerHTML = '';
    
    devices.forEach(device => {
        const deviceCard = document.createElement('div');
        deviceCard.className = 'device-card';
        
        const isCurrentUserUsing = device.currentUser === currentUser;
        const isInQueue = device.queue.includes(currentUser);
        const queuePosition = device.queue.indexOf(currentUser) + 1;
        
        let statusHTML = '';
        if (device.currentUser) {
            statusHTML = `<div class="status-item current-user">使用中: ${device.currentUser}</div>`;
        } else {
            statusHTML = `<div class="status-item">状态: 空闲</div>`;
        }
        
        let queueHTML = '';
        if (device.queue.length > 0) {
            queueHTML = `
                <div class="queue-list">
                    <h4>排队列表 (${device.queue.length}人):</h4>
                    ${device.queue.map((user, index) => `
                        <div class="queue-user">
                            <span>${index + 1}. ${user}</span>
                            ${user === currentUser ? '<span class="queue-position">(您的位置)</span>' : ''}
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        let actionsHTML = '';
        if (currentUser) {
            if (isCurrentUserUsing) {
                actionsHTML = `<button class="btn-release" onclick="releaseDevice('${device.id}')">释放设备</button>`;
            } else if (isInQueue) {
                actionsHTML = `<button class="btn-leave" onclick="leaveQueue('${device.id}')">退出排队</button>`;
            } else if (!device.currentUser || (device.currentUser && device.currentUser !== currentUser)) {
                actionsHTML = `<button class="btn-join" onclick="joinQueue('${device.id}')">加入排队</button>`;
            }
        }
        
        deviceCard.innerHTML = `
            <div class="device-header">${device.name}</div>
            <div class="device-status">
                ${statusHTML}
                ${queueHTML}
            </div>
            <div class="device-actions">
                ${actionsHTML}
            </div>
        `;
        
        devicesList.appendChild(deviceCard);
    });
}

// 事件监听器
userSelect.addEventListener('change', (e) => {
    currentUser = e.target.value;
    localStorage.setItem('currentUser', currentUser);
    renderDevices();
});

addUserBtn.addEventListener('click', () => {
    usernameModal.style.display = 'block';
    newUsernameInput.value = '';
    newUsernameInput.focus();
});

confirmUsername.addEventListener('click', () => {
    const username = newUsernameInput.value.trim();
    if (username && !users.includes(username)) {
        users.push(username);
        localStorage.setItem('users', JSON.stringify(users));
        loadUsers();
        userSelect.value = username;
        currentUser = username;
        localStorage.setItem('currentUser', currentUser);
        renderDevices();
    }
    usernameModal.style.display = 'none';
});

cancelUsername.addEventListener('click', () => {
    usernameModal.style.display = 'none';
});

addDeviceBtn.addEventListener('click', () => {
    const deviceName = deviceNameInput.value.trim();
    if (deviceName && currentUser) {
        socket.emit('add-device', { deviceName, username: currentUser });
        deviceNameInput.value = '';
    } else if (!currentUser) {
        alert('请先选择用户');
    }
});

// 设备操作函数
function joinQueue(deviceId) {
    if (!currentUser) {
        alert('请先选择用户');
        return;
    }
    socket.emit('join-queue', { deviceId, username: currentUser });
}

function leaveQueue(deviceId) {
    socket.emit('leave-queue', { deviceId, username: currentUser });
}

function releaseDevice(deviceId) {
    socket.emit('release-device', { deviceId, username: currentUser });
}

// Socket.IO 事件监听
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('devices-update', (updatedDevices) => {
    devices = updatedDevices;
    renderDevices();
});

socket.on('device-available', (data) => {
    showNotification('设备可用', `设备 "${data.deviceName}" 现在可以使用了！`);
    // 播放提示音（可选）
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmFgU7k9n1unEiBC13yO/eizEIHWq+8+OWT');
    audio.play().catch(e => console.log('Could not play audio:', e));
});

// 点击模态框外部关闭
window.addEventListener('click', (e) => {
    if (e.target === usernameModal) {
        usernameModal.style.display = 'none';
    }
});