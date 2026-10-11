"""开发服务器入口：python main.py"""

import uvicorn

if __name__ == "__main__":
    # 本机 Windows+F盘环境下 WatchFiles 热重载会静默卡死（检测到变更后不再拉起新 worker，
    # 代码改动静默失效、极难察觉），已三次复现。改为不热重载：改完代码手动重启本进程。
    uvicorn.run("app.server:app", host="127.0.0.1", port=8000, reload=False) 
