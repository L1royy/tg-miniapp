import crypto from 'crypto';

// Память для защиты от спама (хранит время последнего заказа по IP)
const rateLimitMap = new Map();

// Эталонная база цен на сервере (клиент не может её подделать)
const PRODUCTS_DB = {
  1: { name: "Пепперони Фреш", price: 499 },
  2: { name: "Бургер BBQ Двойной", price: 380 },
  3: { name: "Картофель по-деревенски", price: 190 },
  4: { name: "Морс клюквенный 0.5", price: 130 },
};

// Функция защиты от HTML-инъекций в имени пользователя
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Криптографическая проверка, что запрос реально пришел из Telegram Mini App
function verifyTelegramWebAppData(telegramInitData, botToken) {
  if (!telegramInitData) return false;
  const encoded = decodeURIComponent(telegramInitData);
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const arr = encoded.split('&');
  const hashIndex = arr.findIndex(str => str.startsWith('hash='));
  const hash = arr.splice(hashIndex, 1)[0].split('=')[1];
  arr.sort((a, b) => a.localeCompare(b));
  const dataCheckString = arr.join('\n');
  const _hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return _hash === hash;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Метод не разрешен" });
  }

  // 1. Защита от спама (не чаще 1 заказа в 30 секунд с одного IP)
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  if (rateLimitMap.has(ip) && now - rateLimitMap.get(ip) < 30000) {
    return res.status(429).json({ error: "Подождите 30 секунд перед следующим заказом." });
  }
  rateLimitMap.set(ip, now);

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

  const { cart, user, initData } = req.body;

  // 2. Проверка подлинности Telegram (если открыто внутри ТГ)
  if (initData && !verifyTelegramWebAppData(initData, BOT_TOKEN)) {
    return res.status(403).json({ error: "Подделка данных Telegram!" });
  }

  // 3. Проверка корзины и безопасный пересчет цены на сервере
  if (!cart || typeof cart !== "object" || Object.keys(cart).length === 0) {
    return res.status(400).json({ error: "Корзина пуста" });
  }

  let itemsText = "";
  let total = 0;

  for (const [id, qty] of Object.entries(cart)) {
    const product = PRODUCTS_DB[id];
    const quantity = parseInt(qty, 10);
    if (!product || isNaN(quantity) || quantity <= 0 || quantity > 50) continue;

    const sum = product.price * quantity;
    itemsText += `• ${product.name} × ${quantity} шт. = ${sum} ₽\n`;
    total += sum;
  }

  if (total === 0) {
    return res.status(400).json({ error: "Некорректный состав заказа" });
  }

  // 4. Безопасная сборка сообщения с экранированием имени
  const safeName = escapeHtml(user?.first_name || user?.username || "Гость");
  const safeHandle = user?.username ? `@${escapeHtml(user.username)}` : "нет юзернейма";
  const safeId = escapeHtml(user?.id || "неизвестно");

  const message =
    `🛍 <b>Новый заказ из Mini App!</b>\n\n` +
    `👤 <b>Клиент:</b> ${safeName} (${safeHandle})\n` +
    `🆔 <b>User ID:</b> <code>${safeId}</code>\n\n` +
    `📦 <b>Состав заказа:</b>\n${itemsText}\n` +
    `💰 <b>Итого к оплате:</b> ${total} ₽`;

  // 5. Отправка в Telegram
  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text: message,
        parse_mode: "HTML",
      }),
    });

    if (tgRes.ok) {
      return res.status(200).json({ ok: true });
    } else {
      return res.status(500).json({ error: "Ошибка сервера Telegram" });
    }
  } catch (e) {
    return res.status(500).json({ error: "Ошибка соединения" });
  }
}