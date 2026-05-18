# -*- coding: utf-8 -*-
import asyncio
import datetime
import random
import sqlite3
import re
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, Dict, List
from telethon import TelegramClient
from telethon.tl.functions.account import CheckUsernameRequest
from telethon.errors import UsernameNotOccupiedError, UsernameInvalidError

# ==================== КОНФИГ ====================
API_ID = 34928216
API_HASH = "29f66350a892e8b69a83b50d7e99bd27"
ADMIN_ID = 8727723180
CRYPTO_BOT_TOKEN = "559739:AALFf0i5EFhsnAiXQ2CCrKtWVf2MZFfMmTz"

BASE_SEARCHES = 5
SEARCH_ATTEMPTS = 60

vowels = 'aeiouy'
consonants = 'bcdfghklmnprstvw'
all_letters = 'abcdefghijklmnopqrstuvwxyz'
patterns_5 = ['CVCVC', 'VCVCV', 'CVCCV', 'VCCVC', 'CCVCC', 'CVVCC']
patterns_6 = ['CVCVCV', 'VCVCVC', 'CVCCVC', 'VCCVCC', 'CVCVCC', 'CVVCVC']

PREMIUM_PRICES = {1: 50, 3: 120, 7: 210, 30: 400}

# ==================== БАЗА ДАННЫХ ====================
conn = sqlite3.connect('database.db', check_same_thread=False)
cursor = conn.cursor()

cursor.execute('''
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    username TEXT,
    referrer_id INTEGER,
    referrals_count INTEGER DEFAULT 0,
    subscription_end TEXT,
    searches_today INTEGER DEFAULT 0,
    last_search_date TEXT,
    created_date TEXT,
    total_searches INTEGER DEFAULT 0,
    found_count INTEGER DEFAULT 0,
    banned INTEGER DEFAULT 0
)
''')

cursor.execute('''
CREATE TABLE IF NOT EXISTS found (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    length INTEGER,
    price TEXT,
    found_date TEXT,
    finder_id INTEGER
)
''')

cursor.execute('''
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_name TEXT UNIQUE,
    phone TEXT,
    proxy TEXT,
    status TEXT DEFAULT 'active'
)
''')
conn.commit()

# ==================== СЕССИИ TELEGRAM ====================
sessions_clients: Dict[str, TelegramClient] = {}
available_clients = []
loop = asyncio.new_event_loop()

def parse_proxy(proxy_str: str):
    if not proxy_str or proxy_str == 'нет':
        return None
    try:
        if '@' in proxy_str:
            auth, addr = proxy_str.split('@')
            user, pwd = auth.split(':')
            ip, port = addr.split(':')
            return {'proxy_type': 'socks5', 'addr': ip, 'port': int(port), 'username': user, 'password': pwd}
        else:
            ip, port = proxy_str.split(':')
            return {'proxy_type': 'socks5', 'addr': ip, 'port': int(port)}
    except:
        return None

async def init_sessions():
    global available_clients
    cursor.execute("SELECT session_name, proxy FROM sessions WHERE status = 'active'")
    for name, proxy_str in cursor.fetchall():
        proxy = parse_proxy(proxy_str)
        try:
            client = TelegramClient(name, API_ID, API_HASH, proxy=proxy)
            await client.connect()
            if await client.is_user_authorized():
                sessions_clients[name] = client
                print(f"✅ Session loaded: {name}")
        except Exception as e:
            print(f"❌ Failed {name}: {e}")
    available_clients = list(sessions_clients.values())
    print(f"📊 Active sessions: {len(available_clients)}")

def get_client():
    return random.choice(available_clients) if available_clients else None

async def check_username(client, username: str) -> Optional[bool]:
    try:
        result = await client(CheckUsernameRequest(username=username))
        return result is not False and len(username) >= 5
    except UsernameNotOccupiedError:
        return True
    except (UsernameInvalidError, Exception):
        return False

def check_sync(username: str) -> Optional[bool]:
    client = get_client()
    if not client:
        return None
    try:
        future = asyncio.run_coroutine_threadsafe(check_username(client, username), loop)
        return future.result(timeout=10)
    except:
        return None

# ==================== ФУНКЦИИ ПОЛЬЗОВАТЕЛЕЙ ====================
def get_user(user_id: int):
    cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
    row = cursor.fetchone()
    if row:
        cols = [desc[0] for desc in cursor.description]
        return dict(zip(cols, row))
    return None

def create_user(user_id: int, username: str = None):
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    cursor.execute("INSERT INTO users (user_id, username, created_date) VALUES (?, ?, ?)", (user_id, username, now))
    conn.commit()
    return get_user(user_id)

def update_user(user_id: int, **kwargs):
    for key, val in kwargs.items():
        if val is not None:
            cursor.execute(f"UPDATE users SET {key} = ? WHERE user_id = ?", (val, user_id))
    conn.commit()

def has_premium(user_id: int) -> bool:
    user = get_user(user_id)
    if not user or not user.get('subscription_end'):
        return False
    try:
        return datetime.datetime.now() < datetime.datetime.strptime(user['subscription_end'], '%Y-%m-%d %H:%M:%S')
    except:
        return False

def get_available_searches(user_id: int) -> int:
    user = get_user(user_id)
    if not user:
        return BASE_SEARCHES
    if has_premium(user_id):
        return 999
    today = datetime.datetime.now().strftime('%Y-%m-%d')
    if user.get('last_search_date') != today:
        update_user(user_id, searches_today=0, last_search_date=today)
        return BASE_SEARCHES
    return max(BASE_SEARCHES - (user.get('searches_today', 0)), 0)

def use_search(user_id: int):
    user = get_user(user_id)
    if user:
        update_user(user_id, searches_today=(user.get('searches_today', 0) + 1), total_searches=(user.get('total_searches', 0) + 1))

def add_found(user_id: int):
    user = get_user(user_id)
    if user:
        update_user(user_id, found_count=(user.get('found_count', 0) + 1))

def estimate_price(username: str) -> str:
    name = username.lower()
    score = 0
    if len(name) == 5: score += 80
    elif len(name) == 6: score += 50
    elif len(name) <= 8: score += 30
    if name.isalpha(): score += 40
    if score >= 150: return "🔥 250-500 ⭐"
    elif score >= 120: return "✨ 150-300 ⭐"
    elif score >= 90: return "⭐ 100-200 ⭐"
    elif score >= 60: return "💫 50-100 ⭐"
    else: return "🌟 10-50 ⭐"

def generate_nick(length: int) -> str:
    patterns = patterns_5 if length == 5 else patterns_6
    pattern = random.choice(patterns)
    return ''.join(random.choice(consonants) if ch == 'C' else random.choice(vowels) for ch in pattern)

def generate_word_nick(word: str) -> str:
    suffixes = ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z','io','ai','co','me','sh','ly','app','dev','xyz','hub','lab','box','max','bit']
    prefixes = ['my','mr','dr','dj','the','real','super','pro','ultra','mega','cyber','tech','alpha','beta','prime','elite','crypto','neo','dark','light','fire','ice','star','moon','sun','void','zero']
    if random.choice([True, False]):
        return word + random.choice(suffixes)
    return random.choice(prefixes) + word

def generate_filter_nick(mask: str) -> str:
    result = ""
    for ch in mask:
        if ch == '?':
            result += random.choice(all_letters)
        elif ch.isalpha():
            result += ch
        else:
            return None
    return result if 5 <= len(result) <= 32 else None

# ==================== FASTAPI ====================
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class SearchReq(BaseModel):
    user_id: int
    mode: str
    word: Optional[str] = None
    mask: Optional[str] = None

class PayReq(BaseModel):
    user_id: int
    days: int
    method: str

@app.on_event("startup")
async def startup():
    asyncio.create_task(init_sessions())

@app.get("/api/user/{user_id}")
async def get_profile(user_id: int):
    user = get_user(user_id)
    if not user:
        user = create_user(user_id, None)
    return {
        "user_id": user["user_id"],
        "has_premium": has_premium(user_id),
        "premium_until": user.get("subscription_end"),
        "searches_today": user.get("searches_today", 0),
        "total_searches": user.get("total_searches", 0),
        "found_count": user.get("found_count", 0),
        "referrals_count": user.get("referrals_count", 0),
        "banned": user.get("banned", 0) == 1,
        "available_searches": get_available_searches(user_id),
        "is_premium": has_premium(user_id)
    }

@app.post("/api/search")
async def search(req: SearchReq):
    user_id = req.user_id
    
    if get_available_searches(user_id) <= 0:
        return {"success": False, "message": "Лимит исчерпан"}
    
    for _ in range(SEARCH_ATTEMPTS):
        if req.mode == '5':
            username = generate_nick(5)
        elif req.mode == '6':
            username = generate_nick(6)
        elif req.mode == 'word' and req.word:
            username = generate_word_nick(req.word.lower())
        elif req.mode == 'filter' and req.mask:
            username = generate_filter_nick(req.mask.lower())
            if not username:
                continue
        else:
            continue
        
        is_free = check_sync(username)
        if is_free is True:
            use_search(user_id)
            add_found(user_id)
            price = estimate_price(username)
            try:
                cursor.execute("INSERT INTO found (username, length, price, found_date, finder_id) VALUES (?, ?, ?, datetime('now'), ?)",
                               (username, len(username), price, user_id))
                conn.commit()
            except:
                pass
            return {
                "success": True,
                "username": username,
                "price_range": price,
                "searches_left": get_available_searches(user_id)
            }
        
        await asyncio.sleep(0.03)
    
    return {"success": False, "message": "Ничего не найдено"}

@app.post("/api/payment/invoice")
async def create_invoice(req: PayReq):
    if req.days not in PREMIUM_PRICES:
        raise HTTPException(400, "Invalid days")
    
    if req.method == 'stars':
        return {
            "method": "stars",
            "title": f"Premium {req.days} days",
            "description": f"Premium подписка на {req.days} дней",
            "payload": f"premium_{req.user_id}_{req.days}",
            "currency": "XTR",
            "amount": PREMIUM_PRICES[req.days]
        }
    else:
        crypto_prices = {1: 0.74, 3: 1.80, 7: 3.15, 30: 6.75}
        try:
            r = requests.post(
                "https://pay.crypt.bot/api/createInvoice",
                headers={"Crypto-Pay-API-Token": CRYPTO_BOT_TOKEN},
                json={
                    "amount": crypto_prices[req.days],
                    "currency_type": "fiat",
                    "fiat": "USD",
                    "accepted_assets": "TON",
                    "description": f"Premium {req.days} days",
                    "payload": f"premium_{req.user_id}_{req.days}"
                },
                timeout=10
            )
            data = r.json()
            if data.get('ok'):
                return {"method": "crypto", "invoice_id": data['result']['invoice_id'], "invoice_url": data['result']['bot_invoice_url']}
        except:
            pass
        raise HTTPException(500, "Crypto payment error")

@app.get("/api/top")
async def get_top():
    cursor.execute("SELECT username, user_id, referrals_count FROM users WHERE referrals_count > 0 ORDER BY referrals_count DESC LIMIT 10")
    return [{"username": row[0], "user_id": row[1], "referrals_count": row[2]} for row in cursor.fetchall()]

# Монтируем фронтенд
app.mount("/", StaticFiles(directory=".", html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    print("🚀 Сервер запущен на http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
