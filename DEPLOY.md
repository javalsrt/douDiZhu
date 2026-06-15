# 斗地主游戏 - 部署指南

## 本地开发

```bash
cd server
npm install
npm start
```

访问: http://localhost:3001

## 服务器部署

### 1. 上传项目到服务器
将整个 `doudizhu` 文件夹上传到服务器

### 2. 安装依赖并启动
```bash
cd doudizhu/server
npm install --production
nohup node index.js > app.log 2>&1 &
```

### 3. Nginx 反向代理（推荐）
```nginx
# 在现有 Nginx 配置中添加
server {
    listen 80;
    server_name doudizhu.yourdomain.com;  # 或 yourdomain.com

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 4. 使用 PM2 守护进程（推荐）
```bash
npm install -g pm2
pm2 start index.js --name doudizhu
pm2 save
pm2 startup
```

## 端口说明
- 默认端口: 3001
- 可通过环境变量修改: `PORT=8080 node index.js`
- WebSocket 和 HTTP 共用同一端口

## 手机访问
- 局域网: `http://服务器IP:3001`
- 公网: `http://你的域名`
- 3人自动匹配，无需手动创建房间
