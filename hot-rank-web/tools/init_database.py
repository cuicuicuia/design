"""
初始化PostgreSQL数据库脚本
用于检查和创建hotrank数据库
"""
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
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

def check_and_create_database():
    """检查并创建数据库"""
    print(f"正在连接到PostgreSQL服务器: {PG_HOST}:{PG_PORT}")
    print(f"用户: {PG_USER}")
    print(f"目标数据库: {PG_DB}")
    print("-" * 50)
    
    try:
        # 先连接到默认的postgres数据库
        print("步骤1: 连接到默认的postgres数据库...")
        conn = psycopg2.connect(
            host=PG_HOST,
            port=int(PG_PORT) if isinstance(PG_PORT, str) else PG_PORT,
            user=PG_USER,
            password=PG_PASSWORD,
            database='postgres'  # 连接到默认数据库
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        print("[OK] 连接成功")
        
        # 检查数据库是否存在
        print(f"\n步骤2: 检查数据库 '{PG_DB}' 是否存在...")
        cursor.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s",
            (PG_DB,)
        )
        exists = cursor.fetchone()
        
        if exists:
            print(f"[OK] 数据库 '{PG_DB}' 已存在")
        else:
            print(f"[X] 数据库 '{PG_DB}' 不存在")
            print(f"\n步骤3: 创建数据库 '{PG_DB}'...")
            cursor.execute(f'CREATE DATABASE "{PG_DB}"')
            print(f"[OK] 数据库 '{PG_DB}' 创建成功")
        
        # 测试连接到新数据库
        print(f"\n步骤4: 测试连接到数据库 '{PG_DB}'...")
        cursor.close()
        conn.close()
        
        test_conn = psycopg2.connect(
            host=PG_HOST,
            port=int(PG_PORT) if isinstance(PG_PORT, str) else PG_PORT,
            user=PG_USER,
            password=PG_PASSWORD,
            database=PG_DB
        )
        test_cursor = test_conn.cursor()
        test_cursor.execute('SELECT version()')
        version = test_cursor.fetchone()[0]
        print(f"[OK] 连接测试成功")
        print(f"  PostgreSQL版本: {version.split(',')[0]}")
        
        test_cursor.close()
        test_conn.close()
        
        print("\n" + "=" * 50)
        print("[OK] 数据库初始化完成！")
        print("=" * 50)
        return True
        
    except psycopg2.OperationalError as e:
        print(f"\n[X] 连接失败: {e}")
        print("\n请检查:")
        print("1. PostgreSQL服务是否正在运行")
        print("2. config.py中的配置是否正确:")
        print(f"   - PG_HOST = '{PG_HOST}'")
        print(f"   - PG_PORT = {PG_PORT}")
        print(f"   - PG_USER = '{PG_USER}'")
        print(f"   - PG_PASSWORD = '{PG_PASSWORD}'")
        print("3. 用户名和密码是否正确")
        return False
    except Exception as e:
        print(f"\n[X] 发生错误: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = check_and_create_database()
    sys.exit(0 if success else 1)
