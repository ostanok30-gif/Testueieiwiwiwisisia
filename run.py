import threading
import subprocess
import os

# Запускаем веб-сервер в отдельном потоке
def run_web():
    os.system("python server.py")

# Запускаем бота в отдельном потоке
def run_bot():
    os.system("python Main.py")

if __name__ == "__main__":
    # Запускаем оба сервера
    web_thread = threading.Thread(target=run_web)
    bot_thread = threading.Thread(target=run_bot)
    
    web_thread.start()
    bot_thread.start()
    
    web_thread.join()
    bot_thread.join()
