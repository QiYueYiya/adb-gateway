FROM node:26-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends android-tools-adb curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装生产环境依赖
RUN npm ci --omit=dev

# 复制应用代码
COPY . .

# 暴露端口
EXPOSE 3000

# 启动应用
CMD ["node", "index.js"]
