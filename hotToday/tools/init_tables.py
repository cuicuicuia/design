"""
初始化PostgreSQL数据库表脚本
根据 hot-rank-web 和 hotToday 项目的需求，创建所有需要的表
"""
import psycopg2
import sys
import os
import io

# 设置标准输出为UTF-8编码（Windows兼容）
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# 添加父目录到路径，以便导入config
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from config import PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DB
except ImportError:
    print("错误: 无法导入config.py，请确保config.py文件存在")
    sys.exit(1)

# 所有需要创建的表名列表（根据 task.py 和 pushSomethings.py）
TABLES = [
    # 主要热榜数据表
    "toutiao_hot",
    "juejin_hot",
    "tieba_topic",
    "wx_read_rank",
    "weibo_hot_search",
    "shaoshupai_hot",
    "douyin_hot",
    "bilibili_hot",
    "zhihu_hot_list",
    
    # 新闻和资讯
    "pengpai",
    "tencent_news",
    "sina",
    "sina_news",
    "wallstreetcn",
    "36kr",
    "huxiu",
    "ithome",
    "needknow",
    
    # 技术社区
    "csdn",
    "github",
    "anquanke",
    "freebuf",
    "kanxue",
    "v2ex",
    "hostloc",
    "nodeseek",
    "linuxdo",
    "hacknews",
    
    # 其他平台
    "acfun",
    "openeye",
    "pmcaff",
    "woshipm",
    "baidu_hot_search",
    "baijingchuhai",
    "dianshangbao",
    "diyicaijing",
    "dongchedi",
    "douban_movie",
    "hupu",
    "kuandaishan",
    "qichezhijia",
    "qidian",
    "shuimu",
    "taipingyang",
    "taptap",
    "yiche",
    "youshedubao",
    "youxiputao",
    "zhanku",
    "zongheng",
    
    # 加密货币和金融
    "crypto_coin",
    "bloomberg",
    "ft",
    
    # 国际新闻
    "yna",
    "asahi",
    "nhk",
    "foxnews",
    "rt",
    "lemonde",
    "dailymail",
    "mumsnet",
    "newsau",
    "fivech",
    "dzenru",
    
    # 其他
    "3dm",
    "52pj",
    "historytoday",
    "readhub",
    "mcpmarket",
    "coolan",
    "xueqiu",
]

def create_tables():
    """创建所有需要的数据库表"""
    print(f"正在连接到PostgreSQL数据库: {PG_HOST}:{PG_PORT}/{PG_DB}")
    print(f"用户: {PG_USER}")
    print("-" * 50)
    
    try:
        # 连接到数据库
        conn = psycopg2.connect(
            host=PG_HOST,
            port=int(PG_PORT) if isinstance(PG_PORT, str) else PG_PORT,
            user=PG_USER,
            password=PG_PASSWORD,
            database=PG_DB
        )
        cursor = conn.cursor()
        print("[OK] 数据库连接成功")
        
        # 创建所有表
        print(f"\n开始创建表（共 {len(TABLES)} 个）...")
        created_count = 0
        existing_count = 0
        
        for table_name in TABLES:
            try:
                # 检查表是否存在
                cursor.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = %s
                    )
                """, (table_name,))
                exists = cursor.fetchone()[0]
                
                if exists:
                    print(f"  [SKIP] 表 '{table_name}' 已存在")
                    existing_count += 1
                else:
                    # 创建表
                    cursor.execute(f"""
                        CREATE TABLE "{table_name}" (
                            id SERIAL PRIMARY KEY,
                            data JSONB,
                            insert_time BIGINT
                        )
                    """)
                    print(f"  [OK] 表 '{table_name}' 创建成功")
                    created_count += 1
            except Exception as e:
                print(f"  [ERROR] 创建表 '{table_name}' 失败: {e}")
        
        # 提交更改
        conn.commit()
        
        print("\n" + "=" * 50)
        print(f"[SUCCESS] 表创建完成！")
        print(f"  新建表: {created_count} 个")
        print(f"  已存在: {existing_count} 个")
        print(f"  总计: {len(TABLES)} 个")
        print("=" * 50)
        
        cursor.close()
        conn.close()
        return True
        
    except psycopg2.OperationalError as e:
        print(f"\n[X] 连接失败: {e}")
        print("\n请检查:")
        print("1. PostgreSQL服务是否正在运行")
        print("2. config.py中的配置是否正确")
        print("3. 数据库 'hotrank' 是否已创建")
        return False
    except Exception as e:
        print(f"\n[X] 发生错误: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = create_tables()
    sys.exit(0 if success else 1)
