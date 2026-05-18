// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const tg = window.Telegram.WebApp;
tg.expand();
tg.enableClosingConfirmation();

let currentUser = null;
let currentMode = '5';
let selectedDays = 1;
let isSearching = false;
let searchCanceled = false;

const userId = tg.initDataUnsafe?.user?.id || 8727723180;
const isAdmin = userId === 8727723180;

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function haptic(type = 'light') {
    if (tg.HapticFeedback) {
        if (type === 'light') tg.HapticFeedback.impactOccurred('light');
        else if (type === 'medium') tg.HapticFeedback.impactOccurred('medium');
        else if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
        else if (type === 'error') tg.HapticFeedback.notificationOccurred('error');
    }
}

function showToast(message, isError = false) {
    let toast = document.querySelector('.toast');
    if (toast) toast.remove();
    toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 20px;
        right: 20px;
        background: ${isError ? 'rgba(255, 68, 68, 0.9)' : 'rgba(0, 0, 0, 0.9)'};
        border-radius: 15px;
        padding: 15px;
        text-align: center;
        z-index: 400;
        animation: fadeIn 0.3s;
        border-left: 3px solid ${isError ? '#ff4444' : '#00ff88'};
    `;
    toast.innerHTML = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

// ==================== API ЗАПРОСЫ ====================
async function apiCall(endpoint, method = 'GET', data = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Init-Data': tg.initData
        }
    };
    if (data) options.body = JSON.stringify(data);
    
    const response = await fetch(`http://localhost:8000${endpoint}`, options);
    return response.json();
}

async function loadUserProfile() {
    try {
        const user = await apiCall(`/api/user/${userId}`);
        currentUser = user;
        
        const badge = document.getElementById('limit-badge');
        if (user.is_premium) {
            badge.innerHTML = '<span class="limit-icon">💎</span><span class="limit-text">БЕЗЛИМИТ</span>';
            badge.classList.add('premium');
            // Разблокируем премиум-режимы
            document.querySelectorAll('.mode-item.premium-locked').forEach(item => {
                item.classList.remove('premium-locked');
                const desc = item.querySelector('.mode-desc');
                if (desc) desc.textContent = '';
            });
        } else {
            badge.innerHTML = `<span class="limit-icon">📊</span><span class="limit-text">Доступно: ${user.available_searches}</span>`;
            badge.classList.remove('premium');
        }
        return user;
    } catch (e) {
        console.error(e);
        return null;
    }
}

// ==================== ПОИСК С АНИМАЦИЕЙ ====================
async function startSearch() {
    if (isSearching) return;
    
    if (!currentUser) await loadUserProfile();
    
    if (!currentUser?.is_premium && currentUser?.available_searches <= 0) {
        showToast('❌ Лимит исчерпан! Купите Premium', true);
        haptic('error');
        return;
    }
    
    let word = null;
    let mask = null;
    
    if (currentMode === 'word') {
        word = document.getElementById('word-input')?.value;
        if (!word || word.length < 3) {
            showToast('❌ Введите слово (минимум 3 буквы)', true);
            haptic('error');
            return;
        }
    }
    
    if (currentMode === 'filter') {
        mask = document.getElementById('filter-input')?.value;
        if (!mask || mask.length < 5) {
            showToast('❌ Введите маску (минимум 5 символов, используйте ?)', true);
            haptic('error');
            return;
        }
    }
    
    isSearching = true;
    searchCanceled = false;
    haptic('medium');
    
    // Показываем радар
    document.getElementById('search-screen').style.display = 'none';
    document.getElementById('radar-screen').style.display = 'flex';
    
    // Запускаем матричные буквы
    startMatrixRain();
    
    let attempts = 0;
    const counterElement = document.getElementById('counter-value');
    const interval = setInterval(() => {
        if (!searchCanceled) {
            attempts++;
            counterElement.textContent = attempts;
        }
    }, 100);
    
    try {
        const result = await apiCall('/api/search', 'POST', {
            user_id: userId,
            mode: currentMode,
            word: word,
            mask: mask
        });
        
        clearInterval(interval);
        stopMatrixRain();
        
        if (result.success) {
            haptic('success');
            showResultModal(result.username, result.price_range);
        } else {
            haptic('error');
            showToast(result.message || '❌ Ничего не найдено. Попробуйте другой режим!', true);
            setTimeout(() => {
                document.getElementById('radar-screen').style.display = 'none';
                document.getElementById('search-screen').style.display = 'flex';
                loadUserProfile();
            }, 1500);
        }
    } catch (e) {
        clearInterval(interval);
        stopMatrixRain();
        showToast('❌ Ошибка сервера', true);
        haptic('error');
        setTimeout(() => {
            document.getElementById('radar-screen').style.display = 'none';
            document.getElementById('search-screen').style.display = 'flex';
        }, 1500);
    }
    
    isSearching = false;
}

function startMatrixRain() {
    const container = document.getElementById('matrix-letters');
    container.innerHTML = '';
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%';
    
    window.matrixInterval = setInterval(() => {
        if (searchCanceled) return;
        const letter = document.createElement('div');
        letter.className = 'matrix-letter';
        letter.textContent = letters[Math.floor(Math.random() * letters.length)];
        letter.style.left = Math.random() * 100 + '%';
        letter.style.animationDuration = 0.3 + Math.random() * 0.5 + 's';
        container.appendChild(letter);
        setTimeout(() => letter.remove(), 500);
    }, 50);
}

function stopMatrixRain() {
    if (window.matrixInterval) clearInterval(window.matrixInterval);
}

function showResultModal(username, priceRange) {
    document.getElementById('radar-screen').style.display = 'none';
    document.getElementById('result-username').textContent = `@${username}`;
    document.getElementById('result-price').textContent = `🔥 Ценность: ${priceRange}`;
    document.getElementById('result-modal').style.display = 'flex';
    
    // Сохраняем username для кнопок
    window.lastFoundUsername = username;
}

function closeModal() {
    document.getElementById('result-modal').style.display = 'none';
    document.getElementById('search-screen').style.display = 'flex';
    loadUserProfile();
}

// Кнопки модалки
document.getElementById('result-open')?.addEventListener('click', () => {
    if (window.lastFoundUsername) {
        tg.openTelegramLink(`https://t.me/${window.lastFoundUsername}`);
    }
});

document.getElementById('result-copy')?.addEventListener('click', () => {
    if (window.lastFoundUsername) {
        navigator.clipboard.writeText(window.lastFoundUsername);
        showToast('✅ Скопировано: @' + window.lastFoundUsername);
        haptic('light');
    }
});

document.getElementById('result-again')?.addEventListener('click', () => {
    closeModal();
    setTimeout(() => startSearch(), 300);
});

document.getElementById('cancel-search')?.addEventListener('click', () => {
    searchCanceled = true;
    isSearching = false;
    document.getElementById('radar-screen').style.display = 'none';
    document.getElementById('search-screen').style.display = 'flex';
    showToast('Поиск отменён');
});

// ==================== РЕЖИМЫ (СЛАЙДЕР) ====================
function initModeSlider() {
    const items = document.querySelectorAll('.mode-item');
    items.forEach(item => {
        item.addEventListener('click', () => {
            if (item.classList.contains('premium-locked') && !currentUser?.is_premium) {
                showToast('🔒 Этот режим доступен только с Premium!', true);
                haptic('error');
                return;
            }
            
            items.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            currentMode = item.dataset.mode;
            haptic('light');
            
            // Показываем нужное поле ввода
            document.getElementById('word-field').style.display = currentMode === 'word' ? 'block' : 'none';
            document.getElementById('filter-field').style.display = currentMode === 'filter' ? 'block' : 'none';
        });
    });
}

// ==================== НАВИГАЦИЯ ====================
async function switchTab(tabId) {
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.nav-item[data-tab="${tabId}"]`).classList.add('active');
    
    if (tabId === 'search') {
        document.getElementById('search-screen').style.display = 'flex';
        document.getElementById('profile-screen')?.remove();
        document.getElementById('premium-screen')?.remove();
        document.getElementById('admin-screen')?.remove();
        await loadUserProfile();
    } else if (tabId === 'profile') {
        document.getElementById('search-screen').style.display = 'none';
        await renderProfileScreen();
    } else if (tabId === 'premium') {
        document.getElementById('search-screen').style.display = 'none';
        renderPremiumScreen();
    } else if (tabId === 'admin' && isAdmin) {
        document.getElementById('search-screen').style.display = 'none';
        renderAdminScreen();
    }
}

async function renderProfileScreen() {
    if (!currentUser) await loadUserProfile();
    
    const container = document.getElementById('dynamic-screens');
    container.innerHTML = `
        <div class="profile-screen" id="profile-screen">
            <div class="profile-card">
                <div class="avatar">👤</div>
                <div class="status-badge ${currentUser?.is_premium ? 'premium' : 'free'}">
                    ${currentUser?.is_premium ? '💎 PREMIUM ПОДПИСКА' : '🔓 Обычный аккаунт'}
                </div>
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value">${currentUser?.total_searches || 0}</div>
                        <div class="stat-label">Всего поисков</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${currentUser?.found_count || 0}</div>
                        <div class="stat-label">Найдено ников</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${currentUser?.referrals_count || 0}</div>
                        <div class="stat-label">Приглашено друзей</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${currentUser?.searches_today || 0}</div>
                        <div class="stat-label">Поисков сегодня</div>
                    </div>
                </div>
            </div>
            <div class="referral-section">
                <div class="ref-title">🌟 ПРИГЛАШАЙ ДРУЗЕЙ И ПОЛУЧАЙ PREMIUM БЕСПЛАТНО!</div>
                <div class="ref-link-box">
                    <input type="text" id="ref-link-input" value="https://t.me/krestbl_bot?start=${userId}" readonly>
                    <button class="copy-btn" id="copy-ref-link">📋</button>
                </div>
                <button class="search-btn" id="show-top-btn" style="margin: 0; padding: 12px;">🏆 ТОП пригласителей</button>
            </div>
        </div>
    `;
    
    document.getElementById('copy-ref-link')?.addEventListener('click', () => {
        const input = document.getElementById('ref-link-input');
        input.select();
        navigator.clipboard.writeText(input.value);
        showToast('✅ Реферальная ссылка скопирована!');
        haptic('light');
    });
    
    document.getElementById('show-top-btn')?.addEventListener('click', async () => {
        const top = await apiCall('/api/top');
        let msg = '🏆 ТОП 10 ПРИГЛАСИТЕЛЕЙ 🏆\n\n';
        top.forEach((u, i) => {
            msg += `${i+1}. ${u.username || 'User ' + u.user_id} — ${u.referrals_count} реф.\n`;
        });
        alert(msg);
    });
}

function renderPremiumScreen() {
    const container = document.getElementById('dynamic-screens');
    container.innerHTML = `
        <div class="premium-screen" id="premium-screen">
            <div class="premium-header">
                <h2>💎 PREMIUM</h2>
                <p>Повысь свои возможности</p>
            </div>
            <div class="features-list">
                <div class="feature-item"><span class="feature-check">✓</span> Полный безлимит на генерацию</div>
                <div class="feature-item"><span class="feature-check">✓</span> Доступ к умному поиску по Фильтру (Маске)</div>
                <div class="feature-item"><span class="feature-check">✓</span> Максимальная скорость брутфорса без задержек</div>
            </div>
            <div class="plans-grid" id="plans-grid">
                <div class="plan-card" data-days="1"><div class="plan-days">1 день</div><div class="plan-price">50 ⭐</div></div>
                <div class="plan-card" data-days="3"><div class="plan-days">3 дня</div><div class="plan-price">120 ⭐</div></div>
                <div class="plan-card" data-days="7"><div class="plan-days">7 дней</div><div class="plan-price">210 ⭐</div></div>
                <div class="plan-card" data-days="30"><div class="plan-days">30 дней</div><div class="plan-price">400 ⭐</div></div>
            </div>
            <div class="pay-buttons">
                <button class="pay-btn stars" id="pay-stars">⭐ Оплатить через Telegram Stars</button>
                <button class="pay-btn crypto" id="pay-crypto">💎 Оплатить через CryptoBot (TON/USDT)</button>
            </div>
        </div>
    `;
    
    // Выбор тарифа
    document.querySelectorAll('.plan-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.plan-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            selectedDays = parseInt(card.dataset.days);
            haptic('light');
        });
    });
    document.querySelector('.plan-card')?.classList.add('selected');
    
    document.getElementById('pay-stars')?.addEventListener('click', () => buyWithStars());
    document.getElementById('pay-crypto')?.addEventListener('click', () => buyWithCrypto());
}

async function buyWithStars() {
    try {
        const invoice = await apiCall('/api/payment/invoice', 'POST', {
            user_id: userId,
            days: selectedDays,
            method: 'stars'
        });
        
        tg.showInvoice({
            title: invoice.title,
            description: invoice.description,
            payload: invoice.payload,
            provider_token: '',
            currency: invoice.currency,
            prices: [{ label: `Premium ${selectedDays} дн`, amount: invoice.amount }]
        }, (status) => {
            if (status === 'paid') {
                showToast(`✅ Premium на ${selectedDays} дней активирован!`);
                haptic('success');
                loadUserProfile();
            }
        });
    } catch(e) {
        showToast('❌ Ошибка создания платежа', true);
    }
}

async function buyWithCrypto() {
    try {
        const invoice = await apiCall('/api/payment/invoice', 'POST', {
            user_id: userId,
            days: selectedDays,
            method: 'ton'
        });
        
        tg.openTelegramLink(`https://t.me/CryptoBot?start=${invoice.invoice_id}`);
        showToast('💰 Оплатите в CryptoBot и вернитесь для проверки');
        
        setTimeout(async () => {
            const verify = await apiCall(`/api/payment/verify?invoice_id=${invoice.invoice_id}&user_id=${userId}&days=${selectedDays}`, 'GET');
            if (verify.success) {
                showToast(verify.message);
                loadUserProfile();
            }
        }, 15000);
    } catch(e) {
        showToast('❌ Ошибка', true);
    }
}

function renderAdminScreen() {
    const container = document.getElementById('dynamic-screens');
    container.innerHTML = `
        <div class="profile-screen" id="admin-screen">
            <div class="profile-card">
                <h3 style="color: #00ff88;">⚙️ АДМИН-ПАНЕЛЬ</h3>
                <button class="search-btn" id="admin-stats-btn" style="margin: 10px 0;">📊 Статистика</button>
                <button class="search-btn" id="admin-sessions-btn" style="margin: 10px 0;">🔄 Управление сессиями</button>
                <button class="search-btn" id="admin-ban-btn" style="margin: 10px 0;">🚫 Забанить ID</button>
                <button class="search-btn" id="admin-broadcast-btn" style="margin: 10px 0;">📣 Рассылка</button>
            </div>
        </div>
    `;
}

// ==================== ЗАПУСК ====================
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        switchTab(tab);
        haptic('light');
    });
});

document.getElementById('search-btn')?.addEventListener('click', startSearch);
initModeSlider();
loadUserProfile();

// Анимированный фон
function initCyberBackground() {
    const canvas = document.getElementById('cyber-bg');
    const ctx = canvas.getContext('2d');
    
    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);
    
    const nodes = [];
    const nodeCount = 60;
    for (let i = 0; i < nodeCount; i++) {
        nodes.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5
        });
    }
    
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        for (let node of nodes) {
            node.x += node.vx;
            node.y += node.vy;
            if (node.x < 0) node.x = canvas.width;
            if (node.x > canvas.width) node.x = 0;
            if (node.y < 0) node.y = canvas.height;
            if (node.y > canvas.height) node.y = 0;
        }
        
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const dx = nodes[i].x - nodes[j].x;
                const dy = nodes[i].y - nodes[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 100) {
                    ctx.beginPath();
                    ctx.moveTo(nodes[i].x, nodes[i].y);
                    ctx.lineTo(nodes[j].x, nodes[j].y);
                    ctx.strokeStyle = `rgba(0, 255, 136, ${0.2 * (1 - dist / 100)})`;
                    ctx.stroke();
                }
            }
        }
        
        for (let node of nodes) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, 2, 0, Math.PI * 2);
            ctx.fillStyle = '#00ff88';
            ctx.shadowBlur = 5;
            ctx.shadowColor = '#00ff88';
            ctx.fill();
        }
        ctx.shadowBlur = 0;
        
        requestAnimationFrame(animate);
    }
    
    animate();
}

initCyberBackground();
