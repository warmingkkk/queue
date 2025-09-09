const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// 数据存储
const devices = new Map(); // deviceId -> { name, currentUser, queue: [] }
const userSockets = new Map(); // username -> socketId

// API路由
app.get('/api/devices', (req, res) => {
    const devicesArray = Array.from(devices.entries()).map(([id, device]) => ({
        id,
        ...device
    }));
    res.json(devicesArray);
});

// Socket.IO连接处理
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // 发送当前设备状态
    socket.emit('devices-update', Array.from(devices.entries()).map(([id, device]) => ({
        id,
        ...device
    })));

    // 添加设备
    socket.on('add-device', (data) => {
        const { deviceName, username } = data;
        const deviceId = Date.now().toString();
        
        devices.set(deviceId, {
            name: deviceName,
            currentUser: null,
            queue: []
        });

        // 广播更新
        io.emit('devices-update', Array.from(devices.entries()).map(([id, device]) => ({
            id,
            ...device
        })));
    });

    // 用户加入队列
    socket.on('join-queue', (data) => {
        const { deviceId, username } = data;
        const device = devices.get(deviceId);
        
        if (device) {
            // 存储用户的socket ID
            userSockets.set(username, socket.id);
            
            // 检查用户是否已在队列中
            const existingIndex = device.queue.indexOf(username);
            
            if (device.currentUser === null && device.queue.length === 0) {
                // 设备空闲，直接使用
                device.currentUser = username;
            } else if (existingIndex === -1 && device.currentUser !== username) {
                // 加入队列
                device.queue.push(username);
            }

            // 广播更新
            io.emit('devices-update', Array.from(devices.entries()).map(([id, device]) => ({
                id,
                ...device
            })));
        }
    });

    // 用户离开队列
    socket.on('leave-queue', (data) => {
        const { deviceId, username } = data;
        const device = devices.get(deviceId);
        
        if (device) {
            device.queue = device.queue.filter(user => user !== username);
            
            // 广播更新
            io.emit('devices-update', Array.from(devices.entries()).map(([id, device]) => ({
                id,
                ...device
            })));
        }
    });

    // 释放设备
    socket.on('release-device', (data) => {
        const { deviceId, username } = data;
        const device = devices.get(deviceId);
        
        if (device && device.currentUser === username) {
            device.currentUser = null;
            
            // 如果有人在排队，通知下一个用户
            if (device.queue.length > 0) {
                const nextUser = device.queue.shift();
                device.currentUser = nextUser;
                
                // 通知下一个用户
                const nextUserSocketId = userSockets.get(nextUser);
                if (nextUserSocketId) {
                    io.to(nextUserSocketId).emit('device-available', {
                        deviceId,
                        deviceName: device.name
                    });
                }
            }

            // 广播更新
            io.emit('devices-update', Array.from(devices.entries()).map(([id, device]) => ({
                id,
                ...device
            })));
        }
    });

    // 断开连接
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        // 清理断开连接的用户
        for (const [username, socketId] of userSockets.entries()) {
            if (socketId === socket.id) {
                userSockets.delete(username);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
