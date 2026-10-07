"""开发服务器入口：python main.py"""

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.server:app", host="127.0.0.1", port=8000, reload=True)
