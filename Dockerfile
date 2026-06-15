FROM node:22-alpine

WORKDIR /app

# 复制依赖文件
COPY server/package*.json ./

# 安装依赖
RUN npm install --production

# 复制服务端代码
COPY server/ ./

# 复制客户端静态文件
COPY client/ ./client/

EXPOSE 3001

CMD ["node", "index.js"]
