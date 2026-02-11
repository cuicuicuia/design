# 今日热榜项目

这是一个聚合各大平台热榜数据的全栈项目，包含爬虫、后端API和前端展示。

## 项目结构

```
毕设/
├── hotToday/              # 后端项目（爬虫 + API服务器）
│   ├── api_server.py      # FastAPI服务器
│   ├── task.py            # 爬虫任务脚本
│   ├── config.py          # 数据库配置
│   └── ...                # 各平台爬虫脚本
│
└── hotToday-frontend/      # 前端项目（Vue3）
    ├── src/
    │   ├── views/         # 页面组件
    │   ├── api/           # API接口
    │   └── ...
    └── package.json
```

## 快速开始

### 1. 后端设置

#### 1.1 安装Python依赖

```bash
cd hotToday
pip install -r requirements.txt
```

#### 1.2 配置数据库

编辑 `hotToday/config.py`，配置PostgreSQL数据库连接：

```python
PG_HOST = "localhost"
PG_PORT = 5432
PG_DB = "hotrank"
PG_USER = "postgres"
PG_PASSWORD = "your_password"
```

#### 1.3 运行爬虫（可选）

如果需要更新数据，运行爬虫任务：

```bash
python task.py
```

#### 1.4 启动API服务器

```bash
python api_server.py
```

或者使用批处理文件：

```bash
start_api.bat
```

API服务器将在 http://localhost:8000 启动

### 2. 前端设置

#### 2.1 安装依赖

```bash
cd hotToday-frontend
npm install
```

#### 2.2 启动开发服务器

```bash
npm run dev
```

或者使用批处理文件：

```bash
start_frontend.bat
```

前端将在 http://localhost:3000 启动

## 功能特性

- ✅ 支持70+个平台的热榜数据采集
- ✅ RESTful API接口
- ✅ 现代化的Vue3前端界面
- ✅ 响应式设计，支持移动端
- ✅ 实时数据展示
- ✅ 自动数据标准化处理

## 支持的平台

详见 `hotToday/readme.md` 中的平台列表

## API文档

启动后端服务后，访问：
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## 注意事项

1. 确保PostgreSQL数据库已安装并运行
2. 确保数据库中存在相应的表结构
3. 前端通过代理访问后端，配置在 `vite.config.ts` 中
4. 如果后端运行在不同端口，需要修改前端的代理配置

## 开发说明

### 后端开发

- API服务器：`hotToday/api_server.py`
- 爬虫脚本：`hotToday/task.py` 及各平台目录下的脚本
- 数据库配置：`hotToday/config.py`

### 前端开发

- 主页面：`hotToday-frontend/src/views/Home.vue`
- API接口：`hotToday-frontend/src/api/index.ts`
- 路由配置：`hotToday-frontend/src/router/index.ts`

## 许可证

MIT
