<?php
declare(strict_types=1);

// Заголовки безопасности
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');

// 1. Разрешаем только POST-запросы
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Метод не поддерживается']);
    exit;
}

// 2. Защита от перегрузки сервера (лимит тела запроса — 10 КБ)
$rawInput = file_get_contents('php://input', false, null, 0, 10240);
if (!$rawInput) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Пустой запрос']);
    exit;
}

$payload = json_decode($rawInput, true);
if (!is_array($payload)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Некорректный формат JSON']);
    exit;
}

// 3. Проверка Honeypot (скрытой ловушки для спам-ботов)
if (!empty($payload['hp_field'])) {
    // Имитируем успех для бота, но ничего не отправляем
    echo json_encode(['ok' => true]);
    exit;
}

// Подключаем защищенный конфиг
define('SECURE_ACCESS', true);
$config = require __DIR__ . '/config.php';

/**
 * Криптографическая проверка подписи Telegram WebApp (HMAC-SHA256)
 * Возвращает проверенный массив данных пользователя или false при подделке
 */
function verifyTelegramInitData(string $initData, string $botToken, int $maxAge): array|false {
    if (empty($initData)) {
        return false;
    }

    parse_str($initData, $data);
    if (empty($data['hash'])) {
        return false;
    }

    $receivedHash = $data['hash'];
    unset($data['hash']);

    // Проверка свежести сессии (защита от Replay-атак)
    $authDate = isset($data['auth_date']) ? (int)$data['auth_date'] : 0;
    if ($authDate === 0 || (time() - $authDate) > $maxAge) {
        return false;
    }

    ksort($data);
    $dataCheckArr = [];
    foreach ($data as $key => $value) {
        $dataCheckArr[] = $key . '=' . $value;
    }
    $dataCheckString = implode("\n", $dataCheckArr);

    $secretKey = hash_hmac('sha256', $botToken, 'WebAppData', true);
    $calculatedHash = bin2hex(hash_hmac('sha256', $dataCheckString, $secretKey, true));

    // Сравнение, защищенное от атак по времени (Timing Attack)
    if (!hash_equals($calculatedHash, $receivedHash)) {
        return false;
    }

    $user = !empty($data['user']) ? json_decode($data['user'], true) : [];
    return is_array($user) ? $user : [];
}

/**
 * Файловый Rate Limiter (защита от флуда по IP и User ID)
 */
function checkRateLimit(string $key, int $limitSeconds): bool {
    $dir = sys_get_temp_dir() . '/tg_miniapp_ratelimit';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }

    $file = $dir . '/' . md5($key) . '.lock';
    $now = time();

    if (file_exists($file)) {
        $lastTime = (int)@file_get_contents($file);
        if (($now - $lastTime) < $limitSeconds) {
            return false; // Лимит превышен
        }
    }

    @file_put_contents($file, (string)$now, LOCK_EX);
    return true;
}

// 4. Проверяем подлинность Telegram-сессии
$initData = isset($payload['initData']) ? (string)$payload['initData'] : '';
$verifiedUser = verifyTelegramInitData($initData, $config['bot_token'], $config['max_session_age']);

if ($config['require_tg_auth'] && $verifiedUser === false) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Откройте приложение внутри Telegram (ошибка подписи)']);
    exit;
}

// 5. Проверяем Rate Limit (по IP-адресу и по ID пользователя ТГ)
$clientIp = $_SERVER['REMOTE_ADDR'] ?? 'unknown_ip';
if (!checkRateLimit('ip_' . $clientIp, $config['rate_limit_seconds'])) {
    http_response_code(429);
    echo json_encode(['ok' => false, 'error' => 'Подождите 30 секунд перед следующим заказом']);
    exit;
}

if (!empty($verifiedUser['id'])) {
    if (!checkRateLimit('tg_' . $verifiedUser['id'], $config['rate_limit_seconds'])) {
        http_response_code(429);
        echo json_encode(['ok' => false, 'error' => 'Вы уже отправили заказ. Подождите 30 секунд']);
        exit;
    }
}

// 6. Валидация корзины и строгий пересчет цен по серверному прайсу
$cart = $payload['cart'] ?? null;
if (!is_array($cart) || empty($cart) || count($cart) > 30) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Корзина пуста или некорректна']);
    exit;
}

$productsDb = $config['products'];
$itemsText = '';
$totalPrice = 0;

foreach ($cart as $rawId => $rawQty) {
    $productId = filter_var($rawId, FILTER_VALIDATE_INT);
    $qty = filter_var($rawQty, FILTER_VALIDATE_INT);

    // Игнорируем несуществующие ID или неадекватное количество
    if ($productId === false || $qty === false || !isset($productsDb[$productId])) {
        continue;
    }
    if ($qty < 1 || $qty > 50) {
        continue;
    }

    $productName = htmlspecialchars($productsDb[$productId]['name'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $unitPrice = (int)$productsDb[$productId]['price'];
    $lineCost = $unitPrice * $qty;

    $itemsText .= "• {$productName} × {$qty} шт. = {$lineCost} ₽\n";
    $totalPrice += $lineCost;
}

if ($totalPrice <= 0 || empty($itemsText)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Выбранные товары не найдены']);
    exit;
}

// 7. Безопасное экранирование данных покупателя (защита от HTML-инъекций)
$firstName = htmlspecialchars((string)($verifiedUser['first_name'] ?? 'Гость'), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$username = !empty($verifiedUser['username'])
    ? '@' . htmlspecialchars((string)$verifiedUser['username'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')
    : 'нет юзернейма';
$userId = htmlspecialchars((string)($verifiedUser['id'] ?? 'неизвестно'), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

$message = "🛍 <b>Новый заказ из Mini App!</b>\n\n"
         . "👤 <b>Клиент:</b> {$firstName} ({$username})\n"
         . "🆔 <b>User ID:</b> <code>{$userId}</code>\n\n"
         . "📦 <b>Состав заказа:</b>\n{$itemsText}\n"
         . "💰 <b>Итого к оплате:</b> {$totalPrice} ₽";

// 8. Отправка сообщения в Telegram Bot API
$ch = curl_init("https://api.telegram.org/bot{$config['bot_token']}/sendMessage");
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 10,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS     => json_encode([
        'chat_id'                  => $config['admin_chat_id'],
        'text'                     => $message,
        'parse_mode'               => 'HTML',
        'disable_web_page_preview' => true,
    ]),
]);

$tgResponse = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode === 200) {
    echo json_encode(['ok' => true]);
} else {
    http_response_code(502);
    echo json_encode(['ok' => false, 'error' => 'Ошибка доставки уведомления в Telegram']);
}