// Инициализация Telegram WebApp
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

// Данные пользователя используются ТОЛЬКО для приветствия в интерфейсе
const user = tg?.initDataUnsafe?.user;
const userName = user ? user.first_name || user.username : "Гость";
document.getElementById("user-greeting").innerText = `Привет, ${userName}!`;

// Витрина товаров для отображения (эталонные цены проверяются на сервере в config.php)
const products = [
  {
    id: 1,
    name: "Пепперони Фреш",
    price: 499,
    img: "https://images.unsplash.com/photo-1628840042765-356cda07504e?w=500",
  },
  {
    id: 2,
    name: "Бургер BBQ Двойной",
    price: 380,
    img: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500",
  },
  {
    id: 3,
    name: "Картофель по-деревенски",
    price: 190,
    img: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=500",
  },
  {
    id: 4,
    name: "Морс клюквенный 0.5",
    price: 130,
    img: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500",
  },
];

let cart = {};
let isSubmitting = false; // Флаг защиты от двойного нажатия

// Безопасное экранирование текста при рендере на клиенте
function escapeClientHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Отрисовка товаров
function renderProducts() {
  const container = document.getElementById("products-list");
  container.innerHTML = products
    .map(
      (p) => `
        <div class="col-6">
          <div class="card h-100">
            <img src="${encodeURI(p.img)}" class="card-img-top" alt="${escapeClientHtml(p.name)}" loading="lazy">
            <div class="card-body p-2 d-flex flex-column justify-content-between">
              <div>
                <h6 class="card-title fs-6 mb-1">${escapeClientHtml(p.name)}</h6>
                <div class="fw-bold mb-2">${Number(p.price)} ₽</div>
              </div>
              <div class="d-flex align-items-center justify-content-between">
                <button class="btn btn-sm btn-outline-secondary" onclick="changeQty(${Number(p.id)}, -1)">-</button>
                <span class="fw-bold" id="qty-${Number(p.id)}">0</span>
                <button class="btn btn-sm btn-outline-primary" onclick="changeQty(${Number(p.id)}, 1)">+</button>
              </div>
            </div>
          </div>
        </div>
      `,
    )
    .join("");
}

// Логика корзины
function changeQty(productId, delta) {
  if (isSubmitting) return;

  const nextQty = (cart[productId] || 0) + delta;
  if (nextQty <= 0) {
    delete cart[productId];
  } else if (nextQty <= 50) {
    cart[productId] = nextQty;
  }

  const qtyEl = document.getElementById(`qty-${productId}`);
  if (qtyEl) qtyEl.innerText = cart[productId] || 0;
  updateTotal();
}

function updateTotal() {
  let total = 0;
  let count = 0;

  for (const [id, qty] of Object.entries(cart)) {
    const product = products.find((p) => p.id === Number(id));
    if (product) {
      total += product.price * qty;
      count += qty;
    }
  }

  document.getElementById("total-price").innerText = `${total} ₽`;
  const orderBtn = document.getElementById("order-btn");

  if (count > 0) {
    orderBtn.disabled = false;
    orderBtn.innerText = `Оформить заказ (${count})`;
  } else {
    orderBtn.disabled = true;
    orderBtn.innerText = "Выберите блюда";
  }
}

// Уведомление пользователя с учетом версии Telegram WebApp
function notifyUser(message, closeAfter = false) {
  if (tg && tg.isVersionAtLeast && tg.isVersionAtLeast("6.2")) {
    tg.showAlert(message, () => {
      if (closeAfter) tg.close();
    });
  } else {
    alert(message);
    if (closeAfter && tg) tg.close();
  }
}

// Отправка заказа на защищенный серверный обработчик send.php
async function submitOrder() {
  if (isSubmitting || Object.keys(cart).length === 0) return;

  isSubmitting = true;
  const orderBtn = document.getElementById("order-btn");
  orderBtn.disabled = true;
  orderBtn.innerText = "Проверка и отправка...";

  try {
    const response = await fetch("send.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({
        cart: cart, // Только ID и количество
        initData: tg?.initData || "", // Криптографическая подпись Telegram
        hp_field: "", // Поле-ловушка (Honeypot) от спам-ботов
      }),
    });

    const result = await response.json();

    if (response.ok && result.ok) {
      cart = {};
      updateTotal();
      notifyUser("Заказ успешно отправлен менеджеру!", true);
    } else {
      notifyUser(result.error || "Ошибка при отправке заказа.");
      orderBtn.disabled = false;
      orderBtn.innerText = "Попробовать снова";
    }
  } catch (err) {
    notifyUser("Ошибка сети. Проверьте подключение к интернету.");
    orderBtn.disabled = false;
    orderBtn.innerText = "Попробовать снова";
  } finally {
    isSubmitting = false;
  }
}

renderProducts();
