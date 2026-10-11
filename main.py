"""开发服务器入口：python main.py"""

import uvicorn

if __name__ == "__main__":
    # 热重载只盯 app/：临时的 scripts/、tests/ 文件增删曾两次触发 WatchFiles 在 Windows 上卡死
    # （检测到变更后不再拉起新 worker），静态资源本就从磁盘直接读取、无需重启。
    uvicorn.run("app.server:app", host="127.0.0.1", port=8000, reload=True, reload_dirs=["app"]) 
