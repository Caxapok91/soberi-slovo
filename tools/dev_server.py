# -*- coding: utf-8 -*-
"""
Локальный сервер для разработки: отключает кэширование,
чтобы браузер всегда подгружал свежие файлы.

Запуск:
    python tools/dev_server.py [порт]
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_header(self, key, value):
        if key.lower() in ("last-modified", "etag"):
            return
        super().send_header(key, value)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    import socket

    def local_ip():
        # UDP-«соединение» не требует интернета, только выбора маршрута
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        except Exception:
            return "127.0.0.1"
        finally:
            s.close()

    print("Слушаем все интерфейсы.")
    print("Компьютер: http://127.0.0.1:%d" % PORT)
    print("Телефон:   http://%s:%d" % (local_ip(), PORT))
    ThreadingHTTPServer(("", PORT), NoCacheHandler).serve_forever()