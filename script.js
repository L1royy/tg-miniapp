// Инициализация Telegram WebApp
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand(); // Раскрываем на весь экран
}

// Твои данные из BotFather и userinfobot

// Получаем имя пользователя из Telegram
const user = tg?.initDataUnsafe?.user;
const userName = user ? user.first_name || user.username : "Гость";
const userHandle = user?.username ? `@${user.username}` : "нет юзернейма";
document.getElementById("user-greeting").innerText = `Привет, ${userName}!`;

// База товаров
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

// Отрисовка товаров
function renderProducts() {
  const container = document.getElementById("products-list");
  container.innerHTML = products
    .map(
      (p) => `
        <div class="col-6">
          <div class="card h-100">
            <img src="${p.img}" class="card-img-top" alt="${p.name}">
            <div class="card-body p-2 d-flex flex-column justify-content-between">
              <div>
                <h6 class="card-title fs-6 mb-1">${p.name}</h6>
                <div class="fw-bold mb-2">${p.price} ₽</div>
              </div>
              <div class="d-flex align-items-center justify-content-between">
                <button class="btn btn-sm btn-outline-secondary" onclick="changeQty(${p.id}, -1)">-</button>
                <span class="fw-bold" id="qty-${p.id}">0</span>
                <button class="btn btn-sm btn-outline-primary" onclick="changeQty(${p.id}, 1)">+</button>
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
  cart[productId] = (cart[productId] || 0) + delta;
  if (cart[productId] <= 0) delete cart[productId];

  document.getElementById(`qty-${productId}`).innerText = cart[productId] || 0;
  updateTotal();
}

function updateTotal() {
  let total = 0;
  let count = 0;
  for (const [id, qty] of Object.entries(cart)) {
    const product = products.find((p) => p.id == id);
    total += product.price * qty;
    count += qty;
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

// Отправка заказа в Telegram
async function submitOrder() {
  const orderBtn = document.getElementById("order-btn");
  orderBtn.disabled = true;
  orderBtn.innerText = "Отправка...";

  try {
    // Отправляем данные на наш защищенный серверный скрипт /api/order
    const response = await fetch("/api/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cart: cart,
        user: tg?.initDataUnsafe?.user || null,
        initData: tg?.initData || "", // Цифровая подпись от Telegram
      }),
    });

    const result = await response.json();

    if (response.ok && result.ok) {
      if (tg && tg.isVersionAtLeast && tg.isVersionAtLeast("6.2")) {
        tg.showAlert("Заказ успешно отправлен менеджеру!", () => {
          tg.close();
        });
      } else {
        alert("Заказ успешно отправлен менеджеру!");
        if (tg) tg.close();
      }
    } else {
      alert(result.error || "Ошибка при отправке заказа.");
      orderBtn.disabled = false;
      orderBtn.innerText = "Попробовать снова";
    }
  } catch (err) {
    alert("Ошибка сети.");
    orderBtn.disabled = false;
    orderBtn.innerText = "Попробовать снова";
  }
}

renderProducts();
