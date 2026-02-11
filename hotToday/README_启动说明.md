# hotToday 爬虫项目 - 启动说明

## 📋 项目说明

`hotToday` 是一个爬虫项目，负责从各个网站拉取热榜数据并存储到 PostgreSQL 数据库中。

## 🚀 快速开始

### 方法一：使用 PowerShell 脚本（推荐）

```powershell
cd "C:\Users\ClamSeas\Desktop\毕设\hotToday"
.\拉取所有数据.ps1
```

这个脚本会自动：
- ✅ 检查配置文件
- ✅ 创建虚拟环境（如果需要）
- ✅ 安装依赖
- ✅ 运行主任务（`task.py`）
- ✅ 运行补充任务（`sometask.py`）

---

### 方法二：手动执行

#### 步骤 1：检查配置

确保 `config.py` 文件存在且配置正确：

```python
PG_HOST = "localhost"      # 或 "127.0.0.1"
PG_PORT = 5432
PG_DB = "hotrank"          # 数据库名
PG_USER = "postgres"        # 数据库用户名
PG_PASSWORD = "123456"      # 数据库密码
```

**重要**：确保这个配置和 `hot-rank-web\config.py` 中的 PostgreSQL 配置**完全一致**！

---

#### 步骤 2：创建虚拟环境并安装依赖

```powershell
cd "C:\Users\ClamSeas\Desktop\毕设\hotToday"

# 创建虚拟环境（第一次需要）
python -m venv .venv

# 激活虚拟环境
.\.venv\Scripts\Activate.ps1

# 升级 pip
python -m pip install --upgrade pip

# 安装依赖
pip install -r requirements.txt
```

---

#### 步骤 3：运行爬虫任务

**主任务（拉取大部分数据）：**

```powershell
python task.py
```

这个脚本会拉取以下数据源：
- 头条热榜、掘金热榜、贴吧热议、微信阅读排行榜
- 微博热搜、少数派热榜、抖音热搜、B站热榜
- 澎湃新闻、加密货币、3DM、36氪、52破解
- AcFun、安全客、百度热搜、白鲸出海、CSDN
- 电商报、第一财经、懂车帝、豆瓣电影、FreeBuf
- GitHub、虎扑、虎嗅、IT之家、开眼、看雪
- 宽带山、PMCAFF、汽车之家、起点、水木社区
- 新浪、太平洋汽车、TapTap、腾讯新闻
- 人人都是产品经理、易车、优设读报、游戏葡萄
- 站酷、纵横、hacknews、历史上的今天
- 华尔街见闻、要知、v2ex、nodeseek、hostloc
- linuxdo、彭博、金融时报、YNA、朝日新闻
- NHK、Fox News、RT、Le Monde、Daily Mail
- Mumsnet、News.com.au、5Channel、Дзен
- MCP-MARKET

**补充任务（拉取虎嗅数据）：**

```powershell
python sometask.py
```

---

## ⏱️ 执行时间

- **主任务**：约 5-15 分钟（取决于网络速度和数据源响应）
- **补充任务**：约 1-2 分钟

---

## 📝 日志文件

执行过程中会生成日志文件：

```
hotToday/logs/hot_log_YYYY-MM-DD_HH-MM-SS.log
```

日志文件会记录：
- ✅ 每个数据源的拉取状态
- ✅ 数据插入到数据库的时间
- ❌ 错误信息和异常堆栈

---

## ⚠️ 常见问题

### 问题 1：连接数据库失败

**错误信息**：
```
psycopg2.OperationalError: could not connect to server
```

**解决方案**：
1. 检查 PostgreSQL 服务是否在运行：
   ```powershell
   Get-Service | Where-Object { $_.DisplayName -like "*PostgreSQL*" }
   ```
2. 检查 `config.py` 中的数据库配置是否正确
3. 确保数据库 `hotrank` 已创建：
   ```sql
   CREATE DATABASE hotrank;
   ```

---

### 问题 2：某些数据源拉取失败

**原因**：
- 网络问题
- 目标网站反爬虫机制
- API 接口变更

**解决方案**：
- 查看日志文件了解具体错误
- 某些数据源失败不影响其他数据源
- 可以稍后重试

---

### 问题 3：表不存在错误

**错误信息**：
```
relation "xxx" does not exist
```

**原因**：数据库表还没有创建

**解决方案**：
1. 第一次运行时会自动创建表（通过 `INSERT` 语句）
2. 如果遇到此错误，可以手动创建表：
   ```sql
   CREATE TABLE IF NOT EXISTS "表名" (
       id SERIAL PRIMARY KEY,
       data JSONB,
       insert_time BIGINT
   );
   ```

---

## 🔄 定期运行

建议设置定时任务（如每天凌晨 2 点）自动运行：

**Windows 任务计划程序**：
1. 打开“任务计划程序”
2. 创建基本任务
3. 触发器：每天 2:00
4. 操作：启动程序
5. 程序：`C:\Users\ClamSeas\Desktop\毕设\hotToday\.venv\Scripts\python.exe`
6. 参数：`task.py`
7. 起始于：`C:\Users\ClamSeas\Desktop\毕设\hotToday`

---

## 📊 数据查看

拉取完成后，可以在 PostgreSQL 中查看数据：

```sql
-- 查看所有表
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- 查看某个表的最新数据
SELECT * FROM "bilibili_hot" ORDER BY insert_time DESC LIMIT 1;

-- 查看数据总数
SELECT COUNT(*) FROM "bilibili_hot";
```

---

## 🔗 相关项目

- **前端/后端项目**：`C:\Users\ClamSeas\Desktop\毕设\hot-rank-web`
- **爬虫项目**：`C:\Users\ClamSeas\Desktop\毕设\hotToday`（当前项目）

---

祝你数据拉取顺利！🎉
